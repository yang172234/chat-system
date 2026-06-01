const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'chat.db');
const UPLOADS_DIR = process.env.UPLOADS_DIR || path.join(__dirname, 'public', 'uploads');

let db = null;

// ==================== Database Initialization ====================

async function initDatabase() {
  const SQL = await initSqlJs();

  if (fs.existsSync(DB_PATH)) {
    const buffer = fs.readFileSync(DB_PATH);
    db = new SQL.Database(buffer);
  } else {
    db = new SQL.Database();
  }

  db.run('PRAGMA foreign_keys = ON');

  // Create tables
  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      avatar TEXT DEFAULT '#4A90D9',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS friend_requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      from_user_id INTEGER NOT NULL,
      to_user_id INTEGER NOT NULL,
      message TEXT DEFAULT '',
      status TEXT DEFAULT 'pending',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (from_user_id) REFERENCES users(id),
      FOREIGN KEY (to_user_id) REFERENCES users(id)
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS friendships (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      friend_id INTEGER NOT NULL,
      group_name TEXT DEFAULT '我的好友',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id),
      FOREIGN KEY (friend_id) REFERENCES users(id),
      UNIQUE(user_id, friend_id)
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS friend_groups (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id),
      UNIQUE(user_id, name)
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS chat_groups (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      creator_id INTEGER NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (creator_id) REFERENCES users(id)
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS group_members (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      group_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      role TEXT DEFAULT 'member',
      joined_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (group_id) REFERENCES chat_groups(id),
      FOREIGN KEY (user_id) REFERENCES users(id),
      UNIQUE(group_id, user_id)
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sender_id INTEGER NOT NULL,
      receiver_id INTEGER,
      group_id INTEGER,
      content TEXT DEFAULT '',
      message_type TEXT DEFAULT 'text',
      file_path TEXT,
      file_duration REAL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (sender_id) REFERENCES users(id)
    )
  `);

  // Indexes
  db.run('CREATE INDEX IF NOT EXISTS idx_msg_private ON messages(sender_id, receiver_id, created_at)');
  db.run('CREATE INDEX IF NOT EXISTS idx_msg_group ON messages(group_id, created_at)');
  db.run('CREATE INDEX IF NOT EXISTS idx_friend_user ON friendships(user_id)');
  db.run('CREATE INDEX IF NOT EXISTS idx_fr_to ON friend_requests(to_user_id, status)');

  saveDatabase();
  return db;
}

function saveDatabase() {
  const data = db.export();
  const buffer = Buffer.from(data);
  fs.writeFileSync(DB_PATH, buffer);
}

// ==================== Query Helpers ====================

function run(sql, params = []) {
  db.run(sql, params);
  saveDatabase();
}

function runAndGetId(sql, params = []) {
  db.run(sql, params);
  const result = db.exec('SELECT last_insert_rowid() as id');
  const id = result[0].values[0][0];
  saveDatabase();
  return id;
}

function get(sql, params = []) {
  const stmt = db.prepare(sql);
  stmt.bind(params);
  let row = null;
  if (stmt.step()) {
    row = stmt.getAsObject();
  }
  stmt.free();
  return row;
}

function all(sql, params = []) {
  const stmt = db.prepare(sql);
  if (params.length > 0) stmt.bind(params);
  const rows = [];
  while (stmt.step()) {
    rows.push(stmt.getAsObject());
  }
  stmt.free();
  return rows;
}

// ==================== Default Groups ====================

const DEFAULT_GROUPS = ['我的好友', '同事', '家人', '同学'];

function ensureDefaultGroups(userId) {
  for (const name of DEFAULT_GROUPS) {
    try { run('INSERT INTO friend_groups (user_id, name) VALUES (?, ?)', [userId, name]); } catch (e) { /* ignore duplicates */ }
  }
}

// ==================== User Operations ====================

function createUser(username, passwordHash) {
  const id = runAndGetId('INSERT INTO users (username, password) VALUES (?, ?)', [username, passwordHash]);
  ensureDefaultGroups(id);
  return id;
}

function getUserByUsername(username) {
  return get('SELECT * FROM users WHERE username = ?', [username]);
}

function getUserById(id) {
  return get('SELECT id, username, avatar, created_at FROM users WHERE id = ?', [id]);
}

function searchUsers(query, excludeId) {
  return all('SELECT id, username, avatar FROM users WHERE username LIKE ? AND id != ? LIMIT 20', [`%${query}%`, excludeId]);
}

// ==================== Friend Request Operations ====================

function sendFriendRequest(fromUserId, toUserId, message) {
  const existing = get(
    'SELECT * FROM friend_requests WHERE from_user_id = ? AND to_user_id = ? AND status = ?',
    [fromUserId, toUserId, 'pending']
  );
  if (existing) return null;

  const id = runAndGetId(
    'INSERT INTO friend_requests (from_user_id, to_user_id, message) VALUES (?, ?, ?)',
    [fromUserId, toUserId, message || '']
  );
  return { id, from_user_id: fromUserId, to_user_id: toUserId };
}

function getPendingRequests(userId) {
  return all(`
    SELECT fr.*, u.username as from_username, u.avatar as from_avatar
    FROM friend_requests fr
    JOIN users u ON fr.from_user_id = u.id
    WHERE fr.to_user_id = ? AND fr.status = 'pending'
    ORDER BY fr.created_at DESC
  `, [userId]);
}

function getSentRequests(userId) {
  return all(`
    SELECT fr.*, u.username as to_username, u.avatar as to_avatar
    FROM friend_requests fr
    JOIN users u ON fr.to_user_id = u.id
    WHERE fr.from_user_id = ? AND fr.status = 'pending'
    ORDER BY fr.created_at DESC
  `, [userId]);
}

function respondToRequest(requestId, userId, action) {
  const request = get('SELECT * FROM friend_requests WHERE id = ? AND to_user_id = ?', [requestId, userId]);
  if (!request) return null;

  if (action === 'accept') {
    run('UPDATE friend_requests SET status = ? WHERE id = ?', ['accepted', requestId]);
    try { run('INSERT INTO friendships (user_id, friend_id, group_name) VALUES (?, ?, ?)', [request.from_user_id, request.to_user_id, '我的好友']); } catch (e) {}
    try { run('INSERT INTO friendships (user_id, friend_id, group_name) VALUES (?, ?, ?)', [request.to_user_id, request.from_user_id, '我的好友']); } catch (e) {}
    return { fromUserId: request.from_user_id, toUserId: request.to_user_id };
  } else {
    run('UPDATE friend_requests SET status = ? WHERE id = ?', ['rejected', requestId]);
    return { rejected: true };
  }
}

function resendFriendRequest(requestId, userId, message) {
  const request = get('SELECT * FROM friend_requests WHERE id = ? AND from_user_id = ?', [requestId, userId]);
  if (!request) return null;
  run('UPDATE friend_requests SET message = ?, status = ?, created_at = CURRENT_TIMESTAMP WHERE id = ?',
    [message || '', 'pending', requestId]);
  return request;
}

// ==================== Friendship Operations ====================

function getFriends(userId) {
  return all(`
    SELECT f.id as friendship_id, f.group_name, u.id as friend_id, u.username, u.avatar
    FROM friendships f
    JOIN users u ON f.friend_id = u.id
    WHERE f.user_id = ?
    ORDER BY f.group_name, u.username
  `, [userId]);
}

function getFriendsByGroup(userId) {
  const friends = getFriends(userId);
  const groups = {};
  for (const f of friends) {
    if (!groups[f.group_name]) groups[f.group_name] = [];
    groups[f.group_name].push(f);
  }
  return groups;
}

function removeFriend(userId, friendshipId) {
  const friendship = get('SELECT * FROM friendships WHERE id = ? AND user_id = ?', [friendshipId, userId]);
  if (!friendship) return null;
  run('DELETE FROM friendships WHERE id = ?', [friendshipId]);
  run('DELETE FROM friendships WHERE user_id = ? AND friend_id = ?', [friendship.friend_id, userId]);
  return friendship;
}

function moveFriendToGroup(userId, friendshipId, groupName) {
  const friendship = get('SELECT * FROM friendships WHERE id = ? AND user_id = ?', [friendshipId, userId]);
  if (!friendship) return null;
  run('UPDATE friendships SET group_name = ? WHERE id = ?', [groupName, friendshipId]);
  return friendship;
}

// ==================== Friend Group Operations ====================

function getFriendGroups(userId) {
  return all('SELECT * FROM friend_groups WHERE user_id = ? ORDER BY id', [userId]);
}

function createFriendGroup(userId, name) {
  try {
    const id = runAndGetId('INSERT INTO friend_groups (user_id, name) VALUES (?, ?)', [userId, name]);
    return { id, name };
  } catch (e) {
    return null;
  }
}

function deleteFriendGroup(userId, groupId) {
  const group = get('SELECT * FROM friend_groups WHERE id = ? AND user_id = ?', [groupId, userId]);
  if (!group) return null;
  if (DEFAULT_GROUPS.includes(group.name)) return null;
  run('UPDATE friendships SET group_name = ? WHERE user_id = ? AND group_name = ?', ['我的好友', userId, group.name]);
  run('DELETE FROM friend_groups WHERE id = ?', [groupId]);
  return group;
}

// ==================== Chat Group Operations ====================

function createChatGroup(name, creatorId) {
  const groupId = runAndGetId('INSERT INTO chat_groups (name, creator_id) VALUES (?, ?)', [name, creatorId]);
  run('INSERT INTO group_members (group_id, user_id, role) VALUES (?, ?, ?)', [groupId, creatorId, 'owner']);
  return groupId;
}

function addGroupMember(groupId, userId, role = 'member') {
  try {
    run('INSERT INTO group_members (group_id, user_id, role) VALUES (?, ?, ?)', [groupId, userId, role]);
    return true;
  } catch (e) {
    return false;
  }
}

function removeGroupMember(groupId, userId) {
  run('DELETE FROM group_members WHERE group_id = ? AND user_id = ?', [groupId, userId]);
}

function getUserGroups(userId) {
  return all(`
    SELECT cg.*, gm.role
    FROM chat_groups cg
    JOIN group_members gm ON cg.id = gm.group_id
    WHERE gm.user_id = ?
    ORDER BY cg.created_at DESC
  `, [userId]);
}

function getGroupMembers(groupId) {
  return all(`
    SELECT u.id, u.username, u.avatar, gm.role
    FROM group_members gm
    JOIN users u ON gm.user_id = u.id
    WHERE gm.group_id = ?
  `, [groupId]);
}

function getGroupById(groupId) {
  return get('SELECT * FROM chat_groups WHERE id = ?', [groupId]);
}

// ==================== Message Operations ====================

function saveMessage(senderId, receiverId, groupId, content, messageType, filePath, fileDuration) {
  const msgId = runAndGetId(
    `INSERT INTO messages (sender_id, receiver_id, group_id, content, message_type, file_path, file_duration)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [senderId, receiverId || null, groupId || null, content, messageType, filePath || null, fileDuration || null]
  );
  return get(
    `SELECT m.*, u.username as sender_name, u.avatar as sender_avatar
     FROM messages m JOIN users u ON m.sender_id = u.id WHERE m.id = ?`,
    [msgId]
  );
}

function getPrivateMessages(userId1, userId2, limit = 50, beforeId = null) {
  let sql = `
    SELECT m.*, u.username as sender_name, u.avatar as sender_avatar
    FROM messages m JOIN users u ON m.sender_id = u.id
    WHERE m.group_id IS NULL
    AND ((m.sender_id = ? AND m.receiver_id = ?) OR (m.sender_id = ? AND m.receiver_id = ?))
  `;
  const params = [userId1, userId2, userId2, userId1];
  if (beforeId) { sql += ' AND m.id < ?'; params.push(beforeId); }
  sql += ' ORDER BY m.created_at DESC LIMIT ?';
  params.push(limit);
  return all(sql, params).reverse();
}

function getGroupMessages(groupId, limit = 50, beforeId = null) {
  let sql = `
    SELECT m.*, u.username as sender_name, u.avatar as sender_avatar
    FROM messages m JOIN users u ON m.sender_id = u.id
    WHERE m.group_id = ?
  `;
  const params = [groupId];
  if (beforeId) { sql += ' AND m.id < ?'; params.push(beforeId); }
  sql += ' ORDER BY m.created_at DESC LIMIT ?';
  params.push(limit);
  return all(sql, params).reverse();
}

function getAllPrivateMessages(userId1, userId2) {
  return all(`
    SELECT m.*, u.username as sender_name, u.avatar as sender_avatar
    FROM messages m JOIN users u ON m.sender_id = u.id
    WHERE m.group_id IS NULL
    AND ((m.sender_id = ? AND m.receiver_id = ?) OR (m.sender_id = ? AND m.receiver_id = ?))
    ORDER BY m.created_at ASC
  `, [userId1, userId2, userId2, userId1]);
}

function getAllGroupMessages(groupId) {
  return all(`
    SELECT m.*, u.username as sender_name, u.avatar as sender_avatar
    FROM messages m JOIN users u ON m.sender_id = u.id
    WHERE m.group_id = ?
    ORDER BY m.created_at ASC
  `, [groupId]);
}

function getRecentContacts(userId) {
  return all(`
    SELECT DISTINCT
      CASE WHEN m.sender_id = ? THEN m.receiver_id ELSE m.sender_id END as contact_id,
      u.username, u.avatar,
      MAX(m.created_at) as last_time
    FROM messages m
    JOIN users u ON u.id = CASE WHEN m.sender_id = ? THEN m.receiver_id ELSE m.sender_id END
    WHERE m.group_id IS NULL AND (m.sender_id = ? OR m.receiver_id = ?)
    GROUP BY contact_id
    ORDER BY last_time DESC
  `, [userId, userId, userId, userId]);
}

module.exports = {
  initDatabase,
  saveDatabase,
  // Users
  createUser, getUserByUsername, getUserById, searchUsers,
  // Friend Requests
  sendFriendRequest, getPendingRequests, getSentRequests, respondToRequest, resendFriendRequest,
  // Friendships
  getFriends, getFriendsByGroup, removeFriend, moveFriendToGroup,
  // Friend Groups
  getFriendGroups, createFriendGroup, deleteFriendGroup,
  // Chat Groups
  createChatGroup, addGroupMember, removeGroupMember, getUserGroups, getGroupMembers, getGroupById,
  // Messages
  saveMessage, getPrivateMessages, getGroupMessages, getAllPrivateMessages, getAllGroupMessages, getRecentContacts,
};
