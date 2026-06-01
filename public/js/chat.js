// ==================== Chat Module ====================

const messageList = document.getElementById('message-list');
const messageInput = document.getElementById('message-input');
const btnSend = document.getElementById('btn-send');
const typingIndicator = document.getElementById('typing-indicator');
const chatTitle = document.getElementById('chat-title');
const chatSubtitle = document.getElementById('chat-subtitle');
const chatAvatar = document.getElementById('chat-avatar');
const btnExportChat = document.getElementById('btn-export-chat');

let currentConversation = null; // { type: 'private'|'group', id, name, members? }
let typingTimer = null;
let isTyping = false;

// ==================== Contact List ====================
function renderContactList() {
  if (!App.contacts || App.contacts.length === 0) {
    DOM.contactList.innerHTML = '<div class="empty-state">\u{1f4ac}<br>暂无最近联系人<br><small>从左侧 "好友" 标签开始聊天！</small></div>';
    return;
  }

  DOM.contactList.innerHTML = App.contacts.map(c => {
    const lastMsg = c.last_message || '';
    const active = App.activeChat?.type === 'private' && App.activeChat?.id === c.contact_id;
    return `
      <div class="contact-item ${active ? 'active' : ''}" data-contact-id="${c.contact_id}" data-username="${c.username}">
        ${getAvatarHtml({ id: c.contact_id, username: c.username })}
        <div class="contact-info">
          <div class="contact-name">${c.username}</div>
          <div class="contact-last-msg">${lastMsg}</div>
        </div>
        <div class="contact-time">${timeAgo(c.last_time)}</div>
      </div>
    `;
  }).join('');

  // Click handlers
  DOM.contactList.querySelectorAll('.contact-item').forEach(item => {
    item.addEventListener('click', () => {
      const contactId = parseInt(item.dataset.contactId);
      const username = item.dataset.username;
      openPrivateChat(contactId, username);
    });
  });
}

// ==================== Open Chats ====================
function openPrivateChat(userId, username) {
  currentConversation = { type: 'private', id: userId, name: username };

  // Update active state
  App.activeChat = { type: 'private', id: userId };
  updateActiveContact();

  // Update UI
  DOM.chatPlaceholder.style.display = 'none';
  DOM.chatActive.style.display = 'flex';
  chatTitle.textContent = username;
  chatSubtitle.textContent = '私聊';
  chatAvatar.innerHTML = getAvatarHtml({ id: userId, username });

  // Load history
  loadPrivateHistory(userId);

  // Focus input
  messageInput.focus();
}

function openGroupChat(groupId, groupName) {
  currentConversation = { type: 'group', id: groupId, name: groupName };

  App.activeChat = { type: 'group', id: groupId };
  updateActiveContact();

  DOM.chatPlaceholder.style.display = 'none';
  DOM.chatActive.style.display = 'flex';
  chatTitle.textContent = groupName;
  chatSubtitle.textContent = '群聊';
  chatAvatar.innerHTML = `<span class="avatar" style="background:#9B59B6;">👥</span>`;

  // Join Socket.IO room
  if (App.socket) App.socket.emit('join-group', groupId);

  // Load history
  loadGroupHistory(groupId);

  messageInput.focus();
}

function updateActiveContact() {
  document.querySelectorAll('.contact-item, .group-item').forEach(el => el.classList.remove('active'));
  document.querySelectorAll('.friend-item').forEach(el => el.classList.remove('active'));

  if (App.activeChat?.type === 'private') {
    const contactEl = document.querySelector(`.contact-item[data-contact-id="${App.activeChat.id}"]`);
    if (contactEl) contactEl.classList.add('active');
    const friendEl = document.querySelector(`.friend-item[data-friend-id="${App.activeChat.id}"]`);
    if (friendEl) friendEl.classList.add('active');
  }
  if (App.activeChat?.type === 'group') {
    const groupEl = document.querySelector(`.group-item[data-group-id="${App.activeChat.id}"]`);
    if (groupEl) groupEl.classList.add('active');
  }
}

// ==================== Load History ====================
async function loadPrivateHistory(userId, beforeId = null) {
  let url = `/api/messages/private/${userId}`;
  if (beforeId) url += `?before=${beforeId}`;

  const res = await api(url);
  if (res.messages) {
    if (!beforeId) {
      messageList.innerHTML = '';
      messageList.dataset.oldestId = res.messages.length > 0 ? res.messages[0].id : '';
    }
    renderMessages(res.messages, beforeId ? 'prepend' : 'append');
  }
}

async function loadGroupHistory(groupId, beforeId = null) {
  let url = `/api/messages/group/${groupId}`;
  if (beforeId) url += `?before=${beforeId}`;

  const res = await api(url);
  if (res.messages) {
    if (!beforeId) {
      messageList.innerHTML = '';
      messageList.dataset.oldestId = res.messages.length > 0 ? res.messages[0].id : '';
    }
    renderMessages(res.messages, beforeId ? 'prepend' : 'append');
  }
}

// ==================== Render Messages ====================
function renderMessages(messages, mode = 'append') {
  if (messages.length === 0) return;

  const html = messages.map(m => renderMessageBubble(m)).join('');

  if (mode === 'prepend') {
    const prevScroll = messageList.scrollHeight;
    messageList.insertAdjacentHTML('afterbegin', html);
    messageList.scrollTop = messageList.scrollHeight - prevScroll;
  } else {
    const wasAtBottom = messageList.scrollTop + messageList.clientHeight >= messageList.scrollHeight - 50;
    messageList.insertAdjacentHTML('beforeend', html);
    if (wasAtBottom) {
      messageList.scrollTop = messageList.scrollHeight;
    }
  }
}

function renderMessageBubble(m) {
  const isSelf = m.sender_id === App.currentUser?.id;
  const wrapperClass = isSelf ? 'self' : 'other';

  let contentHtml = '';
  if (m.message_type === 'voice') {
    contentHtml = `
      <div class="message-voice" onclick="playVoice('${m.file_path || ''}')">
        🔊 语音消息 ${m.file_duration ? `(${Math.round(m.file_duration)}秒)` : ''}
        ${m.file_path ? `<audio src="${m.file_path}" preload="none" style="display:none;"></audio>` : ''}
      </div>
    `;
  } else {
    contentHtml = `<div class="message-text">${escapeHtml(m.content || '')}</div>`;
  }

  return `
    <div class="message-wrapper ${wrapperClass}">
      ${!isSelf ? `<div class="message-avatar" style="background:${getColorForUser(m.sender_id)};">${(m.sender_name || '?')[0].toUpperCase()}</div>` : ''}
      <div class="message-bubble">
        ${!isSelf ? `<div class="message-sender">${m.sender_name || ''}</div>` : ''}
        ${contentHtml}
        <div class="message-time">${timeAgo(m.created_at)}</div>
      </div>
      ${isSelf ? `<div class="message-avatar" style="background:${getColorForUser(m.sender_id)};">${(m.sender_name || '?')[0].toUpperCase()}</div>` : ''}
    </div>
  `;
}

function getColorForUser(id) {
  const colors = ['#4A90D9', '#E74C3C', '#27AE60', '#F39C12', '#9B59B6', '#1ABC9C'];
  return colors[(id || 0) % colors.length];
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// ==================== Send Message ====================
function sendMessage() {
  const content = messageInput.value.trim();
  if (!content || !currentConversation) return;

  if (currentConversation.type === 'private') {
    App.socket.emit('private-message', {
      toUserId: currentConversation.id,
      content,
      messageType: 'text',
    });
  } else if (currentConversation.type === 'group') {
    App.socket.emit('group-message', {
      groupId: currentConversation.id,
      content,
      messageType: 'text',
    });
  }

  messageInput.value = '';
  messageInput.style.height = 'auto';
}

btnSend.addEventListener('click', sendMessage);

messageInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendMessage();
  }
});

// Auto-resize textarea
messageInput.addEventListener('input', () => {
  messageInput.style.height = 'auto';
  messageInput.style.height = Math.min(messageInput.scrollHeight, 120) + 'px';
});

// ==================== Handle Incoming Messages ====================
function handlePrivateMessage(msg) {
  // If this is from/to current conversation, display it
  if (currentConversation?.type === 'private' &&
      (currentConversation.id === msg.sender_id || currentConversation.id === msg.receiver_id)) {
    renderMessages([msg], 'append');
  }

  // Refresh contact list
  loadContacts();
}

function handleGroupMessage(msg) {
  if (currentConversation?.type === 'group' && currentConversation.id === msg.group_id) {
    renderMessages([msg], 'append');
  }
}

// ==================== Typing Indicators ====================
messageInput.addEventListener('input', () => {
  if (!currentConversation) return;

  if (!isTyping) {
    isTyping = true;
    const data = currentConversation.type === 'private'
      ? { toUserId: currentConversation.id }
      : { groupId: currentConversation.id, username: App.currentUser.username };
    App.socket.emit('typing-start', data);
  }

  clearTimeout(typingTimer);
  typingTimer = setTimeout(() => {
    isTyping = false;
    const data = currentConversation.type === 'private'
      ? { toUserId: currentConversation.id }
      : { groupId: currentConversation.id };
    App.socket.emit('typing-stop', data);
  }, 1500);
});

function handleTypingStart(data) {
  // Show typing indicator in the sidebar
  const contactItem = document.querySelector(`.contact-item[data-contact-id="${data.userId}"]`);
  if (contactItem) {
    const lastMsg = contactItem.querySelector('.contact-last-msg');
    if (lastMsg) lastMsg.textContent = '正在输入...';
  }

  // Show in chat area
  if (currentConversation?.type === 'private' && currentConversation.id === data.userId) {
    typingIndicator.textContent = '对方正在输入...';
  }
  if (data.chatType === 'group' && currentConversation?.type === 'group') {
    typingIndicator.textContent = `${data.username || '有人'}正在输入...`;
  }
}

function handleTypingStop(data) {
  const contactItem = document.querySelector(`.contact-item[data-contact-id="${data.userId}"]`);
  if (contactItem) {
    const lastMsg = contactItem.querySelector('.contact-last-msg');
    if (lastMsg && lastMsg.textContent === '正在输入...') {
      lastMsg.textContent = '';
    }
  }

  if (currentConversation?.type === 'private' && currentConversation.id === data.userId) {
    typingIndicator.textContent = '';
  }
  if (data.chatType === 'group') {
    typingIndicator.textContent = '';
  }
}

// ==================== Scroll to Load More ====================
messageList.addEventListener('scroll', () => {
  if (messageList.scrollTop < 50 && messageList.dataset.oldestId) {
    const oldestId = messageList.dataset.oldestId;
    messageList.dataset.oldestId = ''; // Prevent duplicate loads

    if (currentConversation?.type === 'private') {
      loadPrivateHistory(currentConversation.id, oldestId);
    } else if (currentConversation?.type === 'group') {
      loadGroupHistory(currentConversation.id, oldestId);
    }
  }
});

// ==================== Export Chat ====================
btnExportChat.addEventListener('click', () => {
  if (!currentConversation) return;

  let url = '';
  if (currentConversation.type === 'private') {
    url = `/api/messages/export/private/${currentConversation.id}`;
  } else {
    url = `/api/messages/export/group/${currentConversation.id}`;
  }

  // Trigger download
  const a = document.createElement('a');
  a.href = url;
  a.download = '';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
});

// ==================== Voice Playback ====================
function playVoice(filePath) {
  if (!filePath) return;
  const audio = new Audio(filePath);
  audio.play().catch(err => console.error('Playback failed:', err));
}

// Make accessible globally
window.playVoice = playVoice;
window.showAddFriendModal = showAddFriendModal;
window.sendFriendRequestFromModal = sendFriendRequestFromModal;

// ==================== Friend Request Handlers ====================
function handleNewRequest(data) {
  // Show notification
  const badge = document.querySelector('.tab-btn[data-tab="friends-tab"] .badge');
  if (!badge) {
    const tab = document.querySelector('.tab-btn[data-tab="friends-tab"]');
    if (tab) tab.innerHTML = '👥 好友 <span class="badge">新</span>';
  }
  // Alert
  if (typeof Notification !== 'undefined') {
    try { new Notification('Chat System', { body: `${data.from_username} 请求添加你为好友` }); } catch(e) {}
  }
}

function handleRequestAccepted(data) {
  loadFriends();
  loadContacts();
  if (typeof Notification !== 'undefined') {
    try { new Notification('Chat System', { body: `${data.username} 已接受你的好友请求` }); } catch(e) {}
  }
}

// ==================== Emoji Picker ====================
const btnEmoji = document.getElementById('btn-emoji');
const emojiPicker = document.getElementById('emoji-picker');

const EMOJI_DATA = [
  // 笑脸与表情
  { cat: '笑脸', emojis: ['😀','😃','😄','😁','😆','😅','🤣','😂','🙂','😊','😇','🥰','😍','🤩','😘','😗','😚','😋','😛','😜','🤪','😝','🤑','🤗','🤭','😏','😒','😞','😔','😟','😕','🙁','😣','😖','😫','😩','😤','😠','😡','🤬','😈','👿'] },
  // 手势
  { cat: '手势', emojis: ['👍','👎','👌','✌️','🤞','🤟','🤘','🤙','👋','🤚','🖐','✋','🖖','👏','🙌','🤝','💪','🦾','👆','👇','👉','👈','🙏','✍️'] },
  // 爱心与符号
  { cat: '爱心', emojis: ['❤️','🧡','💛','💚','💙','💜','🖤','🤍','🤎','💔','❣️','💕','💞','💓','💗','💖','💘','💝','💟','☮️','✝️','☪️','🕉','☸️','✡️','🔯','🕎'] },
  // 动物
  { cat: '动物', emojis: ['🐶','🐱','🐭','🐹','🐰','🦊','🐻','🐼','🐨','🐯','🦁','🐮','🐷','🐸','🐵','🐔','🐧','🐦','🐤','🦆','🦅','🦉','🦇','🐺','🐗','🐴','🦄','🐝','🐛','🦋','🐌','🐞','🐜','🦟','🦗','🕷'] },
  // 吃喝玩乐
  { cat: '吃喝', emojis: ['🍎','🍐','🍊','🍋','🍌','🍉','🍇','🍓','🍒','🍑','🥭','🍍','🥥','🥝','🍅','🥑','🍔','🍟','🍕','🌭','🥪','🌮','🥙','🍿','🥨','🍦','🍩','🍰','🎂','🍪','🍫','🍬','🍭','☕','🍵','🍺','🍻','🥂','🍷','🥃','🍸','🍹','🧉'] },
  // 日常
  { cat: '日常', emojis: ['🎉','🎊','🎈','🎁','🏆','🥇','🥈','🥉','⚽','🏀','🎾','🏈','🎱','🎮','🎲','🎸','🎹','🎺','🎻','🎤','🎧','📱','💻','⌨️','🖥','📷','💡','🔦','💰','💎','🔑','💣','🧲','🧪','💊','🩹'] },
  // 天气旅行
  { cat: '旅行', emojis: ['🌍','🌎','🌏','🗺','🏠','🏢','🏰','⛪','🕌','🛕','⛩','🗽','🎡','🎢','🌞','🌝','🌚','🌙','⭐','🌟','⛈','🌤','🌈','☀️','☁️','❄️','☃️','⛄','🔥','💧','🌊','🌲','🌳','🌸','🌺','🌻','💐','🍀','🎋'] },
];

let emojiPickerOpen = false;

function renderEmojiPicker() {
  let html = '';
  for (const cat of EMOJI_DATA) {
    html += `<div class="emoji-category-label">${cat.cat}</div>`;
    for (const emoji of cat.emojis) {
      html += `<span class="emoji-item" data-emoji="${emoji}">${emoji}</span>`;
    }
  }
  emojiPicker.innerHTML = html;

  // Click handlers
  emojiPicker.querySelectorAll('.emoji-item').forEach(el => {
    el.addEventListener('click', () => {
      const emoji = el.dataset.emoji;
      insertEmoji(emoji);
    });
  });
}

function insertEmoji(emoji) {
  const input = messageInput;
  const start = input.selectionStart;
  const end = input.selectionEnd;
  const before = input.value.substring(0, start);
  const after = input.value.substring(end);
  input.value = before + emoji + after;
  input.selectionStart = input.selectionEnd = start + emoji.length;
  input.focus();
}

btnEmoji.addEventListener('click', (e) => {
  e.stopPropagation();
  if (!emojiPickerOpen) {
    if (!emojiPicker.hasChildNodes()) renderEmojiPicker();
    emojiPicker.style.display = 'grid';
    emojiPickerOpen = true;
  } else {
    emojiPicker.style.display = 'none';
    emojiPickerOpen = false;
  }
});

// Close picker on outside click
document.addEventListener('click', (e) => {
  if (emojiPickerOpen && !emojiPicker.contains(e.target) && e.target !== btnEmoji) {
    emojiPicker.style.display = 'none';
    emojiPickerOpen = false;
  }
});

// Render emoji picker on first creation
renderEmojiPicker();
