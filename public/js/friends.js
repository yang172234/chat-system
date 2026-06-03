// ==================== Friends Module ====================

let contextMenu = null;

// ==================== Default Group Names (non-deletable/renamable) ====================
const DEFAULT_GROUPS = ['我的好友', '同事', '家人', '同学'];

// ==================== Render Friend Groups ====================
function renderFriendGroups() {
  const groups = App.friends;
  if (!groups || Object.keys(groups).length === 0) {
    DOM.friendGroupsContainer.innerHTML = '<div class="empty-state">👥<br>暂无好友<br><small>在顶部搜索框搜索用户并添加好友</small><br><button class="btn btn-sm btn-primary" style="margin-top:10px;" onclick="document.getElementById(\'search-input\').focus()">🔍 搜索用户</button></div>';
    return;
  }

  let html = '';
  for (const [groupName, friends] of Object.entries(groups)) {
    const isDefault = DEFAULT_GROUPS.includes(groupName);
    const isAIGroup = groupName === 'AI 助手';
    const groupIcon = isAIGroup ? '🤖' : '📁';
    html += `
      <div class="friend-group-header ${isAIGroup ? 'bot-group-header' : ''}" data-group-name="${groupName}" data-is-default="${isDefault || isAIGroup}">
        <span>${groupIcon} ${groupName}</span>
        <span class="friend-group-count">${friends.length}</span>
      </div>
    `;
    for (const f of friends) {
      const active = App.activeChat?.type === 'private' && App.activeChat?.id === f.friend_id;
      const isBot = f.is_bot === 1;
      html += `
        <div class="friend-item ${active ? 'active' : ''} ${isBot ? 'bot-friend-item' : ''}" data-friend-id="${f.friend_id}" data-friendship-id="${f.friendship_id}" data-username="${f.username}" data-group="${groupName}">
          ${getAvatarHtml({ id: f.friend_id, username: isBot ? 'AI' : f.username })}
          <div class="contact-info">
            <div class="contact-name">${isBot ? 'AI 助手' : f.username}${isBot ? ' 🤖' : ''}</div>
          </div>
          <div class="friend-item-actions">
            ${!isBot ? `
              <button class="btn-icon move-friend-btn" title="移动分组" data-friendship-id="${f.friendship_id}" data-username="${f.username}" data-is-bot="false">📂</button>
              <button class="btn-icon delete-friend-btn" title="删除好友" data-friendship-id="${f.friendship_id}" data-username="${f.username}" data-is-bot="false">🗑</button>
            ` : ''}
          </div>
        </div>
      `;
    }
  }

  DOM.friendGroupsContainer.innerHTML = html;

  // Click on friend to open chat
  DOM.friendGroupsContainer.querySelectorAll('.friend-item').forEach(item => {
    item.addEventListener('click', (e) => {
      if (e.target.closest('.friend-item-actions')) return;
      const friendId = parseInt(item.dataset.friendId);
      const username = item.dataset.username;
      openPrivateChat(friendId, username);
    });
  });

  // Right-click on group header for rename/delete
  DOM.friendGroupsContainer.querySelectorAll('.friend-group-header').forEach(header => {
    header.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      const groupName = header.dataset.groupName;
      const isDefault = header.dataset.isDefault === 'true';
      showGroupHeaderMenu(e, groupName, isDefault);
    });
  });

  // Move friend button
  DOM.friendGroupsContainer.querySelectorAll('.move-friend-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (btn.dataset.isBot === 'true') return;
      const friendshipId = parseInt(btn.dataset.friendshipId);
      const username = btn.dataset.username;
      showMoveFriendMenu(e, friendshipId, username);
    });
  });

  // Delete friend button
  DOM.friendGroupsContainer.querySelectorAll('.delete-friend-btn').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      if (btn.dataset.isBot === 'true') return;
      if (confirm(`确定要删除好友 ${btn.dataset.username} 吗？`)) {
        const res = await api(`/api/friends/${btn.dataset.friendshipId}`, { method: 'DELETE' });
        if (res.error) { alert(res.error); return; }
        await loadFriends();
        await loadContacts();
      }
    });
  });
}

// ==================== Context Menu for Moving Friends ====================
function showMoveFriendMenu(e, friendshipId, username) {
  // Remove existing
  if (contextMenu) contextMenu.remove();

  contextMenu = document.createElement('div');
  contextMenu.className = 'context-menu';
  contextMenu.style.left = e.clientX + 'px';
  contextMenu.style.top = e.clientY + 'px';

  // Get all friend groups
  const allGroups = Object.keys(App.friends);

  contextMenu.innerHTML = `
    <div style="padding:6px 16px;font-size:11px;color:var(--text-light);border-bottom:1px solid var(--border);">移动 "${username}" 到:</div>
    ${allGroups.map(g => `
      <button class="context-menu-item" data-group="${g}">📁 ${g}</button>
    `).join('')}
  `;

  contextMenu.querySelectorAll('.context-menu-item').forEach(item => {
    item.addEventListener('click', async () => {
      const groupName = item.dataset.group;
      await api(`/api/friends/${friendshipId}/group`, {
        method: 'PUT',
        body: JSON.stringify({ groupName }),
      });
      await loadFriends();
      contextMenu.remove();
      contextMenu = null;
    });
  });

  document.body.appendChild(contextMenu);

  // Close on outside click
  setTimeout(() => {
    document.addEventListener('click', function closeMenu() {
      if (contextMenu) { contextMenu.remove(); contextMenu = null; }
      document.removeEventListener('click', closeMenu);
    });
  }, 0);
}

// ==================== Group Header Context Menu (Rename / Delete) ====================
function showGroupHeaderMenu(e, groupName, isDefault) {
  if (contextMenu) contextMenu.remove();

  contextMenu = document.createElement('div');
  contextMenu.className = 'context-menu';
  contextMenu.style.left = e.clientX + 'px';
  contextMenu.style.top = e.clientY + 'px';

  let menuItems = '';
  if (!isDefault) {
    menuItems += `<button class="context-menu-item" data-action="rename">✏️ 重命名分组</button>`;
    menuItems += `<button class="context-menu-item danger" data-action="delete">🗑 删除分组</button>`;
  } else {
    menuItems += `<div style="padding:8px 16px;font-size:12px;color:var(--text-dim);">默认分组不可修改</div>`;
  }

  contextMenu.innerHTML = `
    <div style="padding:6px 16px;font-size:11px;color:var(--text-light);border-bottom:1px solid var(--border);">分组: ${groupName}</div>
    ${menuItems}
  `;

  contextMenu.querySelectorAll('.context-menu-item').forEach(item => {
    item.addEventListener('click', async () => {
      const action = item.dataset.action;
      contextMenu.remove();
      contextMenu = null;
      if (action === 'rename') {
        showRenameGroupModal(groupName);
      } else if (action === 'delete') {
        await doDeleteGroup(groupName);
      }
    });
  });

  document.body.appendChild(contextMenu);

  setTimeout(() => {
    document.addEventListener('click', function closeMenu() {
      if (contextMenu) { contextMenu.remove(); contextMenu = null; }
      document.removeEventListener('click', closeMenu);
    });
  }, 0);
}

// ==================== Create Friend Group ====================
function showCreateFriendGroupModal() {
  showModal('新建好友分组',
    `<div class="form-group">
      <label>分组名称</label>
      <input type="text" id="new-friend-group-name" placeholder="输入分组名称（最多20字）" maxlength="20" style="width:100%;padding:10px;border:1px solid var(--border);border-radius:8px;background:var(--bg-input);color:var(--text);">
    </div>`,
    `<button class="btn btn-primary" onclick="doCreateFriendGroup()">创建</button>
     <button class="btn" onclick="closeModal()" style="background:#ccc;">取消</button>`
  );
  setTimeout(() => document.getElementById('new-friend-group-name')?.focus(), 100);
}

async function doCreateFriendGroup() {
  const name = document.getElementById('new-friend-group-name')?.value.trim();
  if (!name) return alert('请输入分组名称');

  const res = await api('/api/friends/groups', {
    method: 'POST',
    body: JSON.stringify({ name }),
  });

  if (res.success) {
    closeModal();
    await loadFriends();
  } else {
    alert(res.error || '创建失败');
  }
}

// ==================== Rename Friend Group ====================
function showRenameGroupModal(oldName) {
  showModal('重命名分组',
    `<div class="form-group">
      <label>将 "<b>${oldName}</b>" 重命名为</label>
      <input type="text" id="rename-group-input" value="${oldName}" maxlength="20" style="width:100%;padding:10px;border:1px solid var(--border);border-radius:8px;background:var(--bg-input);color:var(--text);">
    </div>`,
    `<button class="btn btn-primary" onclick="doRenameGroup('${oldName}')">保存</button>
     <button class="btn" onclick="closeModal()" style="background:#ccc;">取消</button>`
  );
  setTimeout(() => {
    const input = document.getElementById('rename-group-input');
    if (input) { input.focus(); input.select(); }
  }, 100);
}

async function doRenameGroup(oldName) {
  const newName = document.getElementById('rename-group-input')?.value.trim();
  if (!newName) return alert('请输入新分组名称');
  if (newName === oldName) { closeModal(); return; }

  // Find the group ID from App.friends
  const groupsRes = await api('/api/friends/groups');
  const group = groupsRes.groups?.find(g => g.name === oldName);
  if (!group) return alert('分组不存在');

  const res = await api(`/api/friends/groups/${group.id}`, {
    method: 'PUT',
    body: JSON.stringify({ name: newName }),
  });

  if (res.success) {
    closeModal();
    await loadFriends();
  } else {
    alert(res.error || '重命名失败');
  }
}

// ==================== Delete Friend Group ====================
async function doDeleteGroup(groupName) {
  if (!confirm(`确定要删除分组 "${groupName}" 吗？\n\n该分组下的好友将自动移至"我的好友"。`)) return;

  // Find the group ID from API
  const groupsRes = await api('/api/friends/groups');
  const group = groupsRes.groups?.find(g => g.name === groupName);
  if (!group) return alert('分组不存在');

  const res = await api(`/api/friends/groups/${group.id}`, { method: 'DELETE' });

  if (res.success) {
    await loadFriends();
  } else {
    alert(res.error || '删除失败');
  }
}

// ==================== Render Group List ====================
function renderGroupList() {
  if (!App.groups || App.groups.length === 0) {
    DOM.groupList.innerHTML = '<div class="empty-state">👪<br>暂无群聊<br><small>在好友列表中添加好友后即可创建群聊</small></div>';
  } else {
    DOM.groupList.innerHTML = App.groups.map(g => {
      const active = App.activeChat?.type === 'group' && App.activeChat?.id === g.id;
      return `
        <div class="group-item ${active ? 'active' : ''}" data-group-id="${g.id}" data-group-name="${g.name}">
          <span class="avatar" style="background:#9B59B6;">👥</span>
          <div class="contact-info">
            <div class="contact-name">${g.name}</div>
            <div class="contact-last-msg">${g.role === 'owner' ? '群主' : '成员'}</div>
          </div>
        </div>
      `;
    }).join('');
  }

  // Click handlers
  DOM.groupList.querySelectorAll('.group-item').forEach(item => {
    item.addEventListener('click', () => {
      const groupId = parseInt(item.dataset.groupId);
      const groupName = item.dataset.groupName;
      openGroupChat(groupId, groupName);
    });
    item.addEventListener('contextmenu', async (e) => {
      e.preventDefault();
      showGroupContextMenu(e, parseInt(item.dataset.groupId), item.dataset.groupName);
    });
  });
}

// ==================== Create Group ====================
document.getElementById('btn-create-group').addEventListener('click', () => {
  // Get all friends as potential members
  const allFriends = [];
  for (const group of Object.values(App.friends)) {
    for (const f of group) {
      allFriends.push(f);
    }
  }

  showModal('创建群聊',
    `<div class="form-group">
      <label>群聊名称</label>
      <input type="text" id="new-group-name" placeholder="输入群聊名称" style="width:100%;padding:10px;border:1px solid var(--border);border-radius:8px;">
    </div>
    <div class="form-group">
      <label>选择成员</label>
      <div id="member-select-list" style="max-height:200px;overflow-y:auto;border:1px solid var(--border);border-radius:8px;padding:8px;">
        ${allFriends.map(f => `
          <label style="display:flex;align-items:center;gap:8px;padding:6px 8px;cursor:pointer;border-radius:4px;">
            <input type="checkbox" value="${f.friend_id}" class="member-checkbox">
            ${getAvatarHtml({ id: f.friend_id, username: f.username })}
            <span style="font-size:14px;">${f.username}</span>
          </label>
        `).join('')}
        ${allFriends.length === 0 ? '<div style="padding:10px;color:#999;text-align:center;">暂无好友可添加</div>' : ''}
      </div>
    </div>`,
    `<button class="btn btn-primary" onclick="createGroupFromModal()">创建</button>
     <button class="btn" onclick="closeModal()" style="background:#ccc;">取消</button>`
  );
});

async function createGroupFromModal() {
  const name = document.getElementById('new-group-name')?.value.trim();
  if (!name) return alert('请输入群聊名称');

  const checkboxes = document.querySelectorAll('.member-checkbox:checked');
  const members = Array.from(checkboxes).map(cb => parseInt(cb.value));

  const res = await api('/api/groups', {
    method: 'POST',
    body: JSON.stringify({ name, members }),
  });

  if (res.success) {
    closeModal();
    await loadGroups();
    openGroupChat(res.group.id, res.group.name);
  } else {
    alert(res.error || '创建失败');
  }
}

window.createGroupFromModal = createGroupFromModal;

// ==================== Group Context Menu ====================
async function showGroupContextMenu(e, groupId, groupName) {
  if (contextMenu) contextMenu.remove();

  // Fetch group details
  const res = await api(`/api/groups/${groupId}`);
  const members = res.members || [];

  showRightPanel(`群聊: ${groupName}`,
    `<div>
      <h4 style="margin-bottom:12px;font-size:14px;">群成员 (${members.length})</h4>
      ${members.map(m => `
        <div class="member-item">
          ${getAvatarHtml({ id: m.id, username: m.username })}
          <span>${m.username}</span>
          <span class="member-role">${m.role === 'owner' ? '👑 群主' : '成员'}</span>
          ${m.id !== App.currentUser?.id ? `
            <button class="btn btn-sm btn-danger" onclick="removeGroupMember(${groupId}, ${m.id}, '${m.username}')" style="margin-left:auto;">移除</button>
          ` : ''}
        </div>
      `).join('')}
      <hr style="margin:16px 0;border-color:var(--border);">
      <h4 style="margin-bottom:12px;font-size:14px;">邀请好友</h4>
      <div id="invite-friend-list">
        ${getInviteFriendList(groupId)}
      </div>
    </div>`
  );
}

function getInviteFriendList(groupId) {
  const allFriends = [];
  for (const group of Object.values(App.friends)) {
    for (const f of group) allFriends.push(f);
  }

  if (allFriends.length === 0) return '<div style="color:#999;">暂无好友</div>';

  return allFriends.map(f => `
    <div class="member-item">
      ${getAvatarHtml({ id: f.friend_id, username: f.username })}
      <span>${f.username}</span>
      <button class="btn btn-sm btn-primary" onclick="inviteToGroup(${groupId}, ${f.friend_id})" style="margin-left:auto;">邀请</button>
    </div>
  `).join('');
}

async function inviteToGroup(groupId, userId) {
  const res = await api(`/api/groups/${groupId}/members`, {
    method: 'POST',
    body: JSON.stringify({ userId }),
  });
  if (res.success) {
    alert('邀请成功！');
    // Refresh right panel
    const groupRes = await api(`/api/groups/${groupId}`);
    showGroupContextMenu({}, groupId, groupRes.group?.name || '');
  } else {
    alert(res.error || '邀请失败');
  }
}

async function removeGroupMember(groupId, userId, username) {
  if (!confirm(`确定要将 ${username} 移出群聊？`)) return;
  await api(`/api/groups/${groupId}/members/${userId}`, { method: 'DELETE' });
  // Refresh
  const groupRes = await api(`/api/groups/${groupId}`);
  showRightPanel(`群聊: ${groupRes.group?.name || ''}`,
    `<div>${(groupRes.members || []).map(m => `
      <div class="member-item">
        ${getAvatarHtml({ id: m.id, username: m.username })}
        <span>${m.username}</span>
        <span class="member-role">${m.role === 'owner' ? '👑 群主' : '成员'}</span>
        ${m.id !== App.currentUser?.id ? `
          <button class="btn btn-sm btn-danger" onclick="removeGroupMember(${groupId}, ${m.id}, '${m.username}')" style="margin-left:auto;">移除</button>
        ` : ''}
      </div>
    `).join('')}</div>`
  );
  await loadGroups();
}

window.inviteToGroup = inviteToGroup;
window.removeGroupMember = removeGroupMember;

// ==================== Friend Requests Panel ====================
async function showFriendRequests() {
  const [received, sent] = await Promise.all([
    api('/api/friends/requests'),
    api('/api/friends/requests/sent'),
  ]);

  let html = '';

  // Received requests
  html += '<h4 style="margin-bottom:10px;">收到的请求</h4>';
  if (received.requests && received.requests.length > 0) {
    html += received.requests.map(r => `
      <div class="request-item">
        ${getAvatarHtml({ id: r.from_user_id, username: r.from_username })}
        <div class="request-info">
          <div class="request-username">${r.from_username}</div>
          <div class="request-message">${r.message || '无验证信息'}</div>
        </div>
        <div class="request-actions">
          <button class="btn btn-sm btn-primary" onclick="acceptRequest(${r.id})">接受</button>
          <button class="btn btn-sm" onclick="rejectRequest(${r.id})" style="background:#ccc;">拒绝</button>
        </div>
      </div>
    `).join('');
  } else {
    html += '<div style="color:#999;margin-bottom:16px;">暂无收到的请求</div>';
  }

  // Sent requests
  html += '<h4 style="margin:16px 0 10px;">发出的请求</h4>';
  if (sent.requests && sent.requests.length > 0) {
    html += sent.requests.map(r => `
      <div class="request-item">
        ${getAvatarHtml({ id: r.to_user_id, username: r.to_username })}
        <div class="request-info">
          <div class="request-username">${r.to_username}</div>
          <div class="request-message">${r.message || '无验证信息'} · ${timeAgo(r.created_at)}</div>
        </div>
        <button class="btn btn-sm btn-primary" onclick="resendRequest(${r.id}, ${r.to_user_id}, '${r.to_username}')">重新发送</button>
      </div>
    `).join('');
  } else {
    html += '<div style="color:#999;">暂无发出的请求</div>';
  }

  // Add friend requests button to the friends tab
  html = `
    <div style="padding:10px;">
      <button class="btn btn-primary" style="width:100%;margin-bottom:16px;" onclick="showFriendRequests()">📨 好友请求</button>
    </div>
    ${html}
  `;

  showRightPanel('好友请求', html);
}

async function acceptRequest(requestId) {
  const res = await api(`/api/friends/requests/${requestId}/accept`, { method: 'POST' });
  if (res.success) {
    await loadFriends();
    await loadContacts();
    showFriendRequests(); // Refresh panel
  }
}

async function rejectRequest(requestId) {
  await api(`/api/friends/requests/${requestId}/reject`, { method: 'POST' });
  showFriendRequests();
}

async function resendRequest(requestId, toUserId, toUsername) {
  showModal(`重新发送验证: ${toUsername}`,
    `<div class="form-group">
      <label>验证信息</label>
      <textarea id="resend-request-msg" style="width:100%;padding:10px;border:1px solid var(--border);border-radius:8px;resize:vertical;font-family:inherit;" rows="3" placeholder="输入新的验证信息"></textarea>
    </div>`,
    `<button class="btn btn-primary" onclick="doResendRequest(${requestId})">重新发送</button>
     <button class="btn" onclick="closeModal()" style="background:#ccc;">取消</button>`
  );
}

async function doResendRequest(requestId) {
  const msg = document.getElementById('resend-request-msg')?.value || '';
  const res = await api(`/api/friends/requests/${requestId}/resend`, {
    method: 'POST',
    body: JSON.stringify({ message: msg }),
  });
  if (res.success) {
    closeModal();
    alert('已重新发送好友请求！');
  } else {
    alert(res.error || '发送失败');
  }
}

window.showFriendRequests = showFriendRequests;
window.acceptRequest = acceptRequest;
window.rejectRequest = rejectRequest;
window.resendRequest = resendRequest;
window.doResendRequest = doResendRequest;
window.showCreateFriendGroupModal = showCreateFriendGroupModal;
window.doCreateFriendGroup = doCreateFriendGroup;
window.doRenameGroup = doRenameGroup;
window.doDeleteGroup = doDeleteGroup;

// Add request button to friends tab
const friendsTab = document.getElementById('tab-friends-tab');
const requestBtn = document.createElement('button');
requestBtn.className = 'btn btn-primary btn-sm';
requestBtn.style.cssText = 'margin:10px;';
requestBtn.textContent = '📨 好友请求';
requestBtn.addEventListener('click', showFriendRequests);
friendsTab.insertBefore(requestBtn, friendsTab.firstChild);

// Create friend group button
document.getElementById('btn-create-friend-group')?.addEventListener('click', showCreateFriendGroupModal);
