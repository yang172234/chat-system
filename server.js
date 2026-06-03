require('dotenv').config();

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');

const {
  initDatabase,
  createUser, getUserByUsername, getUserById, searchUsers,
  sendFriendRequest, getPendingRequests, getSentRequests, respondToRequest, resendFriendRequest,
  getFriends, getFriendsByGroup, removeFriend, moveFriendToGroup,
  getFriendGroups, createFriendGroup, renameFriendGroup, deleteFriendGroup,
  createChatGroup, addGroupMember, removeGroupMember, getUserGroups, getGroupMembers, getGroupById,
  saveMessage, getPrivateMessages, getGroupMessages, getAllPrivateMessages, getAllGroupMessages, getRecentContacts,
  isBotUser, getBotForUser, getOwnerForBot, createBotForUser, isBotFriendship, getBotConversationContext, updateMessageContent,
  saveDatabase,
} = require('./database');

const { streamChat } = require('./bot');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  maxHttpBufferSize: 10 * 1024 * 1024, // 10MB for voice messages
});

const PORT = process.env.PORT || 3000;

// Ensure uploads directory exists
const uploadsDir = process.env.UPLOADS_DIR || path.join(__dirname, 'public', 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

// ==================== Session Middleware ====================

const sessionMiddleware = session({
  secret: process.env.SESSION_SECRET || 'chat-system-secret-key-2024',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 24 * 60 * 60 * 1000 }, // 24 hours
});

app.use(sessionMiddleware);

// Share session with Socket.IO
io.use((socket, next) => {
  sessionMiddleware(socket.request, {}, next);
});

// ==================== Auth Middleware ====================

function requireAuth(req, res, next) {
  if (!req.session.userId) {
    return res.status(401).json({ error: '请先登录' });
  }
  next();
}

// ==================== Body Parsing ====================

app.use(express.json());

// Serve static files
app.use(express.static(path.join(__dirname, 'public')));

// ==================== Auth Routes ====================

app.post('/api/register', (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: '用户名和密码不能为空' });
  }
  if (username.length < 2 || username.length > 20) {
    return res.status(400).json({ error: '用户名长度需要2-20个字符' });
  }
  if (password.length < 4) {
    return res.status(400).json({ error: '密码长度至少4个字符' });
  }

  const existing = getUserByUsername(username);
  if (existing) {
    return res.status(400).json({ error: '用户名已存在' });
  }

  const hash = bcrypt.hashSync(password, 10);
  const userId = createUser(username, hash);

  // Auto-create AI bot friend for new user
  try {
    createBotForUser(userId);
    console.log(`Bot created for user ${userId}`);
  } catch (e) {
    console.error(`Failed to create bot for user ${userId}:`, e.message);
  }

  req.session.userId = userId;
  res.json({ success: true, user: { id: userId, username } });
});

app.post('/api/login', (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: '用户名和密码不能为空' });
  }

  const user = getUserByUsername(username);
  if (!user || !bcrypt.compareSync(password, user.password)) {
    return res.status(400).json({ error: '用户名或密码错误' });
  }

  req.session.userId = user.id;
  res.json({ success: true, user: { id: user.id, username: user.username } });
});

app.post('/api/logout', (req, res) => {
  req.session.destroy();
  res.json({ success: true });
});

app.get('/api/me', (req, res) => {
  if (!req.session.userId) {
    return res.status(401).json({ error: '未登录' });
  }
  const user = getUserById(req.session.userId);
  if (!user) {
    return res.status(401).json({ error: '用户不存在' });
  }
  res.json({ user });
});

// ==================== User Routes ====================

app.get('/api/users/search', requireAuth, (req, res) => {
  const { q } = req.query;
  if (!q) return res.json({ users: [] });
  const users = searchUsers(q, req.session.userId);
  res.json({ users });
});

app.get('/api/users/:id', requireAuth, (req, res) => {
  const user = getUserById(parseInt(req.params.id));
  if (!user) return res.status(404).json({ error: '用户不存在' });
  res.json({ user });
});

// ==================== Friend Request Routes ====================

app.post('/api/friends/request', requireAuth, (req, res) => {
  const { toUserId, message } = req.body;
  if (!toUserId) return res.status(400).json({ error: '缺少目标用户ID' });
  if (toUserId == req.session.userId) return res.status(400).json({ error: '不能添加自己为好友' });

  const result = sendFriendRequest(req.session.userId, parseInt(toUserId), message);
  if (!result) return res.status(400).json({ error: '已发送过好友请求，请等待对方处理' });

  // Notify recipient in real-time
  const sender = getUserById(req.session.userId);
  io.to(`user:${toUserId}`).emit('friend-request-received', {
    id: result.id,
    from_user_id: req.session.userId,
    from_username: sender.username,
    message: message || '',
  });

  res.json({ success: true, requestId: result.id });
});

app.get('/api/friends/requests', requireAuth, (req, res) => {
  const requests = getPendingRequests(req.session.userId);
  res.json({ requests });
});

app.get('/api/friends/requests/sent', requireAuth, (req, res) => {
  const requests = getSentRequests(req.session.userId);
  res.json({ requests });
});

app.post('/api/friends/requests/:id/accept', requireAuth, (req, res) => {
  const result = respondToRequest(parseInt(req.params.id), req.session.userId, 'accept');
  if (!result) return res.status(400).json({ error: '请求不存在或已处理' });

  // Notify the sender
  const acceptor = getUserById(req.session.userId);
  io.to(`user:${result.fromUserId}`).emit('friend-request-accepted', {
    userId: req.session.userId,
    username: acceptor.username,
  });

  // Also refresh friend lists for both users
  io.to(`user:${result.fromUserId}`).emit('friends-updated');
  io.to(`user:${req.session.userId}`).emit('friends-updated');

  res.json({ success: true });
});

app.post('/api/friends/requests/:id/reject', requireAuth, (req, res) => {
  const result = respondToRequest(parseInt(req.params.id), req.session.userId, 'reject');
  if (!result) return res.status(400).json({ error: '请求不存在或已处理' });
  res.json({ success: true });
});

app.post('/api/friends/requests/:id/resend', requireAuth, (req, res) => {
  const { message } = req.body;
  const result = resendFriendRequest(parseInt(req.params.id), req.session.userId, message);
  if (!result) return res.status(400).json({ error: '请求不存在' });

  // Re-notify recipient
  const sender = getUserById(req.session.userId);
  io.to(`user:${result.to_user_id}`).emit('friend-request-received', {
    id: result.id,
    from_user_id: req.session.userId,
    from_username: sender.username,
    message: message || '',
  });

  res.json({ success: true });
});

// ==================== Friendship Routes ====================

app.get('/api/friends', requireAuth, (req, res) => {
  const groups = getFriendsByGroup(req.session.userId);
  res.json({ groups });
});

app.delete('/api/friends/:friendshipId', requireAuth, (req, res) => {
  const result = removeFriend(req.session.userId, parseInt(req.params.friendshipId));
  if (!result) return res.status(400).json({ error: '好友关系不存在' });
  if (result.error) return res.status(400).json({ error: result.error });

  io.to(`user:${req.session.userId}`).emit('friends-updated');
  io.to(`user:${result.friend_id}`).emit('friends-updated');

  res.json({ success: true });
});

app.put('/api/friends/:friendshipId/group', requireAuth, (req, res) => {
  const { groupName } = req.body;
  if (!groupName) return res.status(400).json({ error: '缺少分组名称' });

  const result = moveFriendToGroup(req.session.userId, parseInt(req.params.friendshipId), groupName);
  if (!result) return res.status(400).json({ error: '好友关系不存在' });
  if (result.error) return res.status(400).json({ error: result.error });

  io.to(`user:${req.session.userId}`).emit('friends-updated');

  res.json({ success: true });
});

// ==================== Friend Group Routes ====================

app.get('/api/friends/groups', requireAuth, (req, res) => {
  const groups = getFriendGroups(req.session.userId);
  res.json({ groups });
});

app.post('/api/friends/groups', requireAuth, (req, res) => {
  const { name } = req.body;
  if (!name) return res.status(400).json({ error: '缺少分组名称' });
  const result = createFriendGroup(req.session.userId, name);
  if (!result) return res.status(400).json({ error: '分组已存在' });
  res.json({ success: true, group: result });
});

app.delete('/api/friends/groups/:groupId', requireAuth, (req, res) => {
  const result = deleteFriendGroup(req.session.userId, parseInt(req.params.groupId));
  if (!result) return res.status(400).json({ error: '分组不存在或不可删除' });
  res.json({ success: true });
});

// AI Bot management
app.post('/api/ai-bot/create', requireAuth, (req, res) => {
  const result = createBotForUser(req.session.userId);
  if (!result) return res.status(400).json({ error: '创建 AI 助手失败' });
  io.to(`user:${req.session.userId}`).emit('friends-updated');
  res.json({ success: true, bot: result });
});

app.put('/api/friends/groups/:groupId', requireAuth, (req, res) => {
  const { name } = req.body;
  if (!name || name.trim().length === 0) return res.status(400).json({ error: '缺少分组名称' });
  if (name.trim().length > 20) return res.status(400).json({ error: '分组名称不能超过20个字符' });
  const result = renameFriendGroup(req.session.userId, parseInt(req.params.groupId), name.trim());
  if (!result) return res.status(400).json({ error: '分组不存在或不可重命名' });
  if (result.error) return res.status(400).json({ error: result.error });
  res.json({ success: true, group: result });
});

// ==================== Chat Group Routes ====================

app.post('/api/groups', requireAuth, (req, res) => {
  const { name, members } = req.body;
  if (!name) return res.status(400).json({ error: '缺少群聊名称' });

  const groupId = createChatGroup(name, req.session.userId);

  if (members && Array.isArray(members)) {
    for (const memberId of members) {
      if (memberId != req.session.userId) {
        addGroupMember(groupId, memberId);
        io.to(`user:${memberId}`).emit('group-added', { groupId, name });
      }
    }
  }

  const group = getGroupById(groupId);
  io.to(`user:${req.session.userId}`).emit('groups-updated');
  res.json({ success: true, group });
});

app.get('/api/groups', requireAuth, (req, res) => {
  const groups = getUserGroups(req.session.userId);
  res.json({ groups });
});

app.get('/api/groups/:id', requireAuth, (req, res) => {
  const group = getGroupById(parseInt(req.params.id));
  if (!group) return res.status(404).json({ error: '群聊不存在' });
  const members = getGroupMembers(parseInt(req.params.id));
  res.json({ group, members });
});

app.post('/api/groups/:id/members', requireAuth, (req, res) => {
  const { userId } = req.body;
  if (!userId) return res.status(400).json({ error: '缺少用户ID' });

  const success = addGroupMember(parseInt(req.params.id), parseInt(userId));
  if (!success) return res.status(400).json({ error: '添加失败，用户可能已在群中' });

  const group = getGroupById(parseInt(req.params.id));
  io.to(`user:${userId}`).emit('group-added', { groupId: group.id, name: group.name });
  io.to(`group:${req.params.id}`).emit('group-members-updated');

  res.json({ success: true });
});

app.delete('/api/groups/:id/members/:userId', requireAuth, (req, res) => {
  removeGroupMember(parseInt(req.params.id), parseInt(req.params.userId));
  io.to(`user:${req.params.userId}`).emit('removed-from-group', { groupId: parseInt(req.params.id) });
  io.to(`group:${req.params.id}`).emit('group-members-updated');
  res.json({ success: true });
});

// ==================== Message Routes ====================

app.get('/api/messages/private/:userId', requireAuth, (req, res) => {
  const { before } = req.query;
  const messages = getPrivateMessages(
    req.session.userId,
    parseInt(req.params.userId),
    50,
    before ? parseInt(before) : null
  );
  res.json({ messages });
});

app.get('/api/messages/group/:groupId', requireAuth, (req, res) => {
  const { before } = req.query;
  const messages = getGroupMessages(
    parseInt(req.params.groupId),
    50,
    before ? parseInt(before) : null
  );
  res.json({ messages });
});

app.get('/api/messages/export/private/:userId', requireAuth, (req, res) => {
  const messages = getAllPrivateMessages(req.session.userId, parseInt(req.params.userId));
  const otherUser = getUserById(parseInt(req.params.userId));
  const exportData = {
    type: 'private',
    participants: [
      { id: req.session.userId },
      { id: parseInt(req.params.userId), username: otherUser?.username }
    ],
    exportedAt: new Date().toISOString(),
    messageCount: messages.length,
    messages: messages.map(m => ({
      sender: m.sender_name,
      content: m.content,
      type: m.message_type,
      time: m.created_at,
    })),
  };
  res.setHeader('Content-Disposition', `attachment; filename=chat-${otherUser?.username || 'user'}.json`);
  res.json(exportData);
});

app.get('/api/messages/export/group/:groupId', requireAuth, (req, res) => {
  const messages = getAllGroupMessages(parseInt(req.params.groupId));
  const group = getGroupById(parseInt(req.params.groupId));
  const exportData = {
    type: 'group',
    groupName: group?.name,
    exportedAt: new Date().toISOString(),
    messageCount: messages.length,
    messages: messages.map(m => ({
      sender: m.sender_name,
      senderId: m.sender_id,
      content: m.content,
      type: m.message_type,
      time: m.created_at,
    })),
  };
  res.setHeader('Content-Disposition', `attachment; filename=group-${group?.name || 'chat'}.json`);
  res.json(exportData);
});

// ==================== Contacts (Recent) ====================

app.get('/api/contacts', requireAuth, (req, res) => {
  const contacts = getRecentContacts(req.session.userId);
  res.json({ contacts });
});

// Serve index.html for all other routes (SPA)
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ==================== Socket.IO ====================

// Track online users: userId -> Set of socket IDs
const onlineUsers = new Map();

io.on('connection', (socket) => {
  const userId = socket.request.session?.userId;
  if (!userId) {
    socket.emit('auth-required');
    return;
  }

  // Track online status
  if (!onlineUsers.has(userId)) {
    onlineUsers.set(userId, new Set());
  }
  onlineUsers.get(userId).add(socket.id);

  // Join personal room
  socket.join(`user:${userId}`);

  // Notify friends that user is online
  socket.broadcast.emit('user-online', { userId });

  // Also emit online for user's bot (always online)
  const bot = getBotForUser(userId);
  if (bot) {
    socket.emit('user-online', { userId: bot.bot_user_id, isBot: true });
  }

  console.log(`User ${userId} connected (${socket.id})`);

  // ===== Private Chat =====
  socket.on('private-message', (data) => {
    const { toUserId, content, messageType = 'text' } = data;
    if (!toUserId || !content) return;

    const msg = saveMessage(userId, toUserId, null, content, messageType);

    const messageData = {
      id: msg.id,
      sender_id: userId,
      sender_name: msg.sender_name,
      sender_avatar: msg.sender_avatar,
      receiver_id: toUserId,
      content,
      message_type: messageType,
      created_at: msg.created_at,
    };

    // Send to recipient
    io.to(`user:${toUserId}`).emit('private-message', messageData);
    // Send back to sender
    socket.emit('private-message', messageData);

    // ---- Bot interception ----
    if (isBotUser(toUserId)) {
      const owner = getOwnerForBot(toUserId);
      // Only respond to the bot's owner
      if (!owner || owner.owner_user_id !== userId) return;

      // Handle voice messages sent to bot
      if (messageType === 'voice') {
        const voiceReply = saveMessage(toUserId, userId, null, '抱歉，我现在只能处理文字消息~', 'text');
        const voiceReplyData = {
          id: voiceReply.id,
          sender_id: toUserId,
          sender_name: 'AI 助手',
          sender_avatar: undefined,
          receiver_id: userId,
          content: '抱歉，我现在只能处理文字消息~',
          message_type: 'text',
          created_at: voiceReply.created_at,
        };
        setTimeout(() => {
          io.to(`user:${userId}`).emit('private-message', voiceReplyData);
        }, 500);
        return;
      }

      // Get conversation context
      const contextMessages = getBotConversationContext(userId, toUserId, 10);

      // Build system prompt with context
      const messages = [
        {
          role: 'system',
          content: '你是一个友好的 AI 助手，名叫"AI 助手"。你正在和用户进行私聊。请用简洁、自然的中文回复。回复不要过长，尽量控制在 200 字以内。保持友好、有帮助的态度。'
        },
        ...contextMessages,
      ];

      // Emit typing start
      socket.emit('typing-start', { userId: toUserId, chatType: 'private', isBot: true });

      let botMsgId = null;
      let firstChunk = true;

      streamChat(
        messages,
        // onChunk
        (delta) => {
          if (firstChunk) {
            // Stop typing on first chunk
            socket.emit('typing-stop', { userId: toUserId, chatType: 'private', isBot: true });
            firstChunk = false;
            // Save initial message and emit stream start
            const botMsg = saveMessage(toUserId, userId, null, delta, 'text');
            botMsgId = botMsg.id;
            socket.emit('bot-message-stream', {
              id: botMsgId,
              sender_id: toUserId,
              sender_name: 'AI 助手',
              receiver_id: userId,
              content: delta,
              message_type: 'text',
              isStreaming: true,
              created_at: botMsg.created_at,
            });
          } else {
            // Emit delta
            socket.emit('bot-message-delta', {
              id: botMsgId,
              delta,
            });
          }
        },
        // onDone
        (fullText) => {
          socket.emit('typing-stop', { userId: toUserId, chatType: 'private', isBot: true });
          if (botMsgId && fullText) {
            updateMessageContent(botMsgId, fullText);
            socket.emit('bot-message-done', {
              id: botMsgId,
              finalContent: fullText,
            });
          }
        },
        // onError
        (error) => {
          socket.emit('typing-stop', { userId: toUserId, chatType: 'private', isBot: true });
          console.error('Bot error:', error.message);
          const errorContent = error.message === 'DEEPSEEK_API_KEY not configured'
            ? '抱歉，AI 服务暂未配置，请联系管理员设置 DEEPSEEK_API_KEY。'
            : `抱歉，我暂时无法回复（${error.message}），请稍后再试。`;
          const errorMsg = saveMessage(toUserId, userId, null, errorContent, 'text');
          socket.emit('private-message', {
            id: errorMsg.id,
            sender_id: toUserId,
            sender_name: 'AI 助手',
            receiver_id: userId,
            content: errorContent,
            message_type: 'text',
            created_at: errorMsg.created_at,
          });
        }
      );
    }
  });

  // ===== Voice Message =====
  socket.on('voice-message', (data, callback) => {
    const { toUserId, audioData, duration } = data;
    if (!toUserId || !audioData) return;

    // Save audio file
    const filename = `${uuidv4()}.webm`;
    const filePath = path.join(uploadsDir, filename);
    const buffer = Buffer.from(audioData, 'base64');
    fs.writeFileSync(filePath, buffer);

    const msg = saveMessage(userId, toUserId, null, '[语音消息]', 'voice', `/uploads/${filename}`, duration);

    const messageData = {
      id: msg.id,
      sender_id: userId,
      sender_name: msg.sender_name,
      sender_avatar: msg.sender_avatar,
      receiver_id: toUserId,
      content: '[语音消息]',
      message_type: 'voice',
      file_path: `/uploads/${filename}`,
      file_duration: duration,
      created_at: msg.created_at,
    };

    io.to(`user:${toUserId}`).emit('private-message', messageData);
    socket.emit('private-message', messageData);

    if (callback) callback({ success: true, messageId: msg.id });
  });

  // ===== Group Chat =====
  socket.on('join-group', (groupId) => {
    socket.join(`group:${groupId}`);
    socket.currentGroup = groupId;
  });

  socket.on('leave-group', (groupId) => {
    socket.leave(`group:${groupId}`);
  });

  socket.on('group-message', (data) => {
    const { groupId, content, messageType = 'text' } = data;
    if (!groupId || !content) return;

    const msg = saveMessage(userId, null, groupId, content, messageType);

    const messageData = {
      id: msg.id,
      sender_id: userId,
      sender_name: msg.sender_name,
      sender_avatar: msg.sender_avatar,
      group_id: groupId,
      content,
      message_type: messageType,
      created_at: msg.created_at,
    };

    io.to(`group:${groupId}`).emit('group-message', messageData);
  });

  socket.on('group-voice-message', (data, callback) => {
    const { groupId, audioData, duration } = data;
    if (!groupId || !audioData) return;

    const filename = `${uuidv4()}.webm`;
    const filePath = path.join(uploadsDir, filename);
    const buffer = Buffer.from(audioData, 'base64');
    fs.writeFileSync(filePath, buffer);

    const msg = saveMessage(userId, null, groupId, '[语音消息]', 'voice', `/uploads/${filename}`, duration);

    const messageData = {
      id: msg.id,
      sender_id: userId,
      sender_name: msg.sender_name,
      sender_avatar: msg.sender_avatar,
      group_id: groupId,
      content: '[语音消息]',
      message_type: 'voice',
      file_path: `/uploads/${filename}`,
      file_duration: duration,
      created_at: msg.created_at,
    };

    io.to(`group:${groupId}`).emit('group-message', messageData);
    if (callback) callback({ success: true, messageId: msg.id });
  });

  // ===== Typing Indicators =====
  socket.on('typing-start', (data) => {
    if (data.toUserId) {
      io.to(`user:${data.toUserId}`).emit('typing-start', { userId, chatType: 'private' });
    }
    if (data.groupId) {
      socket.to(`group:${data.groupId}`).emit('typing-start', { userId, username: data.username, chatType: 'group' });
    }
  });

  socket.on('typing-stop', (data) => {
    if (data.toUserId) {
      io.to(`user:${data.toUserId}`).emit('typing-stop', { userId, chatType: 'private' });
    }
    if (data.groupId) {
      socket.to(`group:${data.groupId}`).emit('typing-stop', { userId, chatType: 'group' });
    }
  });

  // ===== Disconnect =====
  socket.on('disconnect', () => {
    if (onlineUsers.has(userId)) {
      onlineUsers.get(userId).delete(socket.id);
      if (onlineUsers.get(userId).size === 0) {
        onlineUsers.delete(userId);
        // Don't emit offline for bot users (they're always online)
        if (!isBotUser(userId)) {
          socket.broadcast.emit('user-offline', { userId });
        }
      }
    }
    console.log(`User ${userId} disconnected (${socket.id})`);
  });
});

// ==================== Start Server ====================

async function start() {
  await initDatabase();
  server.listen(PORT, () => {
    console.log(`Chat server running at http://localhost:${PORT}`);
  });
}

// Graceful shutdown — save database before exit
function gracefulShutdown(signal) {
  console.log(`\nReceived ${signal}, shutting down gracefully...`);
  server.close(() => {
    console.log('HTTP server closed.');
    if (typeof saveDatabase === 'function') {
      saveDatabase();
      console.log('Database saved.');
    }
    process.exit(0);
  });
  // Force exit after 5s
  setTimeout(() => {
    console.error('Forced shutdown after timeout.');
    process.exit(1);
  }, 5000);
}

process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));

start();
