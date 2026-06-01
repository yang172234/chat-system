// ==================== App State ====================
const App = {
  currentUser: null,
  socket: null,
  activeChat: null, // { type: 'private'|'group', id: number }
  friends: {},
  groups: [],
  contacts: [],
  pendingRequests: [],
};

// ==================== DOM Elements ====================
const DOM = {
  loginPanel: document.getElementById('login-panel'),
  registerPanel: document.getElementById('register-panel'),
  appPanel: document.getElementById('app-panel'),
  currentUsername: document.getElementById('current-username'),
  currentAvatar: document.getElementById('current-avatar'),
  contactList: document.getElementById('contact-list'),
  friendGroupsContainer: document.getElementById('friend-groups-container'),
  groupList: document.getElementById('group-list'),
  searchInput: document.getElementById('search-input'),
  searchResults: document.getElementById('search-results'),
  rightPanel: document.getElementById('right-panel'),
  rightPanelTitle: document.getElementById('right-panel-title'),
  rightPanelContent: document.getElementById('right-panel-content'),
  btnCloseRight: document.getElementById('btn-close-right'),
  modalOverlay: document.getElementById('modal-overlay'),
  modalTitle: document.getElementById('modal-title'),
  modalBody: document.getElementById('modal-body'),
  modalFooter: document.getElementById('modal-footer'),
  btnCloseModal: document.getElementById('btn-close-modal'),
  chatPlaceholder: document.getElementById('chat-placeholder'),
  chatActive: document.getElementById('chat-active'),
};

// ==================== Utility Functions ====================

function api(path, options = {}) {
  return fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  }).then(r => r.json());
}

function getAvatarHtml(user, size = '') {
  const colors = ['#4A90D9', '#E74C3C', '#27AE60', '#F39C12', '#9B59B6', '#1ABC9C', '#E67E22', '#2ECC71'];
  const hash = (user.username || user.id || '').split('').reduce((a, c) => a + c.charCodeAt(0), 0);
  const color = colors[hash % colors.length];
  const initial = (user.username || '?')[0].toUpperCase();
  return `<span class="avatar" style="background:${color};${size}">${initial}</span>`;
}

function timeAgo(dateStr) {
  const now = new Date();
  const date = new Date(dateStr + (dateStr.includes('Z') ? '' : 'Z'));
  const diff = now - date;
  if (diff < 60000) return '刚刚';
  if (diff < 3600000) return `${Math.floor(diff / 60000)}分钟前`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}小时前`;
  const d = new Date(dateStr);
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function showModal(title, bodyHtml, footerHtml = '') {
  DOM.modalTitle.textContent = title;
  DOM.modalBody.innerHTML = bodyHtml;
  DOM.modalFooter.innerHTML = footerHtml;
  DOM.modalOverlay.style.display = 'flex';
}

function closeModal() {
  DOM.modalOverlay.style.display = 'none';
}

function showRightPanel(title, contentHtml) {
  DOM.rightPanelTitle.textContent = title;
  DOM.rightPanelContent.innerHTML = contentHtml;
  DOM.rightPanel.style.display = 'flex';
}

function closeRightPanel() {
  DOM.rightPanel.style.display = 'none';
}

// ==================== Sidebar Tabs ====================
document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById(`tab-${btn.dataset.tab}`).classList.add('active');
  });
});

// ==================== Modal Close ====================
DOM.btnCloseModal.addEventListener('click', closeModal);
DOM.modalOverlay.addEventListener('click', (e) => {
  if (e.target === DOM.modalOverlay) closeModal();
});

// ==================== Right Panel Close ====================
DOM.btnCloseRight.addEventListener('click', closeRightPanel);

// ==================== Search Users ====================
let searchTimeout;
DOM.searchInput.addEventListener('input', () => {
  clearTimeout(searchTimeout);
  const q = DOM.searchInput.value.trim();
  if (!q) {
    DOM.searchResults.style.display = 'none';
    return;
  }
  searchTimeout = setTimeout(async () => {
    const res = await api(`/api/users/search?q=${encodeURIComponent(q)}`);
    if (res.users && res.users.length > 0) {
      DOM.searchResults.innerHTML = res.users.map(u => `
        <div class="search-result-item" data-user-id="${u.id}">
          ${getAvatarHtml(u)}
          <span>${u.username}</span>
          <button class="btn btn-sm btn-primary add-friend-btn" data-user-id="${u.id}" data-username="${u.username}">添加</button>
        </div>
      `).join('');
      DOM.searchResults.style.display = 'block';

      // Add friend button handlers
      DOM.searchResults.querySelectorAll('.add-friend-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          const uid = parseInt(btn.dataset.userId);
          const uname = btn.dataset.username;
          showAddFriendModal(uid, uname);
        });
      });
    } else {
      DOM.searchResults.innerHTML = '<div style="padding:12px;color:#999;font-size:13px;">未找到用户</div>';
      DOM.searchResults.style.display = 'block';
    }
  }, 300);
});

document.addEventListener('click', (e) => {
  if (!DOM.searchResults.contains(e.target) && e.target !== DOM.searchInput) {
    DOM.searchResults.style.display = 'none';
  }
});

// ==================== Add Friend Modal ====================
function showAddFriendModal(userId, username) {
  showModal(`添加好友: ${username}`,
    `<div class="form-group">
      <label>验证信息</label>
      <textarea id="friend-request-msg" style="width:100%;padding:10px;border:1px solid var(--border);border-radius:8px;resize:vertical;font-family:inherit;" rows="3" placeholder="我是 ${App.currentUser?.username || ''}"></textarea>
    </div>`,
    `<button class="btn btn-primary" onclick="sendFriendRequestFromModal(${userId})">发送好友请求</button>
     <button class="btn" onclick="closeModal()" style="background:#ccc;">取消</button>`
  );
}

async function sendFriendRequestFromModal(userId) {
  const msg = document.getElementById('friend-request-msg')?.value || '';
  const res = await api('/api/friends/request', {
    method: 'POST',
    body: JSON.stringify({ toUserId: userId, message: msg }),
  });
  if (res.success) {
    closeModal();
    alert('好友请求已发送！');
  } else {
    alert(res.error || '发送失败');
  }
}

// Make it globally accessible for inline onclick
window.sendFriendRequestFromModal = sendFriendRequestFromModal;

// ==================== Logout ====================
document.getElementById('btn-logout').addEventListener('click', async () => {
  await api('/api/logout', { method: 'POST' });
  if (App.socket) App.socket.disconnect();
  App.currentUser = null;
  DOM.appPanel.style.display = 'none';
  DOM.loginPanel.style.display = 'flex';
  DOM.registerPanel.style.display = 'none';
});

// ==================== Init ====================
async function initApp() {
  const res = await api('/api/me');
  if (res.user) {
    App.currentUser = res.user;
    showMainApp();
    await loadAllData();
    initSocket();
  } else {
    DOM.loginPanel.style.display = 'flex';
  }
}

function showMainApp() {
  DOM.loginPanel.style.display = 'none';
  DOM.registerPanel.style.display = 'none';
  DOM.appPanel.style.display = 'flex';
  DOM.currentUsername.textContent = App.currentUser.username;
  DOM.currentAvatar.innerHTML = getAvatarHtml(App.currentUser);
}

async function loadAllData() {
  await Promise.all([
    loadFriends(),
    loadGroups(),
    loadContacts(),
  ]);
}

async function loadFriends() {
  const res = await api('/api/friends');
  if (res.groups) App.friends = res.groups;
  renderFriendGroups();
}

async function loadGroups() {
  const res = await api('/api/groups');
  if (res.groups) App.groups = res.groups;
  renderGroupList();
}

async function loadContacts() {
  const res = await api('/api/contacts');
  if (res.contacts) App.contacts = res.contacts;
  renderContactList();
}

// ==================== Socket.IO ====================
function initSocket() {
  App.socket = io();

  App.socket.on('connect', () => {
    console.log('Socket connected');
    // Re-join active chat room
    if (App.activeChat?.type === 'group') {
      App.socket.emit('join-group', App.activeChat.id);
    }
  });

  App.socket.on('auth-required', () => {
    alert('登录已过期，请重新登录');
    location.reload();
  });

  App.socket.on('private-message', handlePrivateMessage);
  App.socket.on('group-message', handleGroupMessage);
  App.socket.on('typing-start', handleTypingStart);
  App.socket.on('typing-stop', handleTypingStop);
  App.socket.on('friend-request-received', handleNewRequest);
  App.socket.on('friend-request-accepted', handleRequestAccepted);
  App.socket.on('friends-updated', loadFriends);
  App.socket.on('groups-updated', loadGroups);
  App.socket.on('group-added', loadGroups);
  App.socket.on('user-online', () => {});
  App.socket.on('user-offline', () => {});
}

// ==================== Help Button ====================
function showHelp() {
  const overlay = document.createElement('div');
  overlay.className = 'help-overlay';
  overlay.innerHTML = `
    <div class="help-card">
      <h3>❓ 使用帮助</h3>
      <p class="help-subtitle">快速上手 Chat System</p>
      <div class="help-section">
        <h4>🔍 搜索添加好友</h4>
        <p>在左侧搜索框输入用户名搜索，点击 <b>"添加"</b> 发送好友请求。对方接受后即可聊天。</p>
      </div>
      <div class="help-section">
        <h4>💬 发送消息</h4>
        <p>点击联系人或好友即可进入聊天。<span class="help-shortcut">Enter</span> 发送消息，<span class="help-shortcut">Shift+Enter</span> 换行。</p>
      </div>
      <div class="help-section">
        <h4>🎤 语音消息</h4>
        <p>点击输入框左侧 🎤 按钮切换到语音模式，按住录音按钮说话，松开自动发送。</p>
      </div>
      <div class="help-section">
        <h4>👥 好友管理</h4>
        <p>在 "好友" 标签可以管理好友分组：移动分组、删除好友。右键点击群聊可查看成员。</p>
      </div>
      <div class="help-section">
        <h4>📥 导出聊天记录</h4>
        <p>在聊天窗口右上角点击 📥 按钮，下载 JSON 格式的聊天记录。</p>
      </div>
      <div class="help-section">
        <h4>🔄 多账号测试</h4>
        <p>使用浏览器的 <b>无痕模式</b> 或同时打开多个浏览器窗口，可以登录不同账号互相聊天测试。</p>
      </div>
      <button class="btn btn-primary" style="width:100%;margin-top:8px;">知道了</button>
    </div>
  `;
  document.body.appendChild(overlay);

  overlay.querySelector('.btn').addEventListener('click', () => overlay.remove());
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) overlay.remove();
  });
}

document.getElementById('btn-help').addEventListener('click', showHelp);

// ==================== Start ====================
document.addEventListener('DOMContentLoaded', initApp);
