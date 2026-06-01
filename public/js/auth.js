// ==================== Auth Module ====================

// Panel switching
document.getElementById('show-register').addEventListener('click', (e) => {
  e.preventDefault();
  DOM.loginPanel.style.display = 'none';
  DOM.registerPanel.style.display = 'flex';
});

document.getElementById('show-login').addEventListener('click', (e) => {
  e.preventDefault();
  DOM.registerPanel.style.display = 'none';
  DOM.loginPanel.style.display = 'flex';
});

// ==================== Login ====================
document.getElementById('login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const username = document.getElementById('login-username').value.trim();
  const password = document.getElementById('login-password').value;
  const errorEl = document.getElementById('login-error');

  errorEl.textContent = '';

  const res = await api('/api/login', {
    method: 'POST',
    body: JSON.stringify({ username, password }),
  });

  if (res.success) {
    App.currentUser = res.user;
    showMainApp();
    await loadAllData();
    initSocket();
  } else {
    errorEl.textContent = res.error || '登录失败';
  }
});

// ==================== Register ====================
document.getElementById('register-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const username = document.getElementById('register-username').value.trim();
  const password = document.getElementById('register-password').value;
  const passwordConfirm = document.getElementById('register-password-confirm').value;
  const errorEl = document.getElementById('register-error');

  errorEl.textContent = '';

  if (password !== passwordConfirm) {
    errorEl.textContent = '两次密码输入不一致';
    return;
  }

  if (password.length < 4) {
    errorEl.textContent = '密码长度至少4个字符';
    return;
  }

  if (username.length < 2) {
    errorEl.textContent = '用户名长度至少2个字符';
    return;
  }

  const res = await api('/api/register', {
    method: 'POST',
    body: JSON.stringify({ username, password }),
  });

  if (res.success) {
    App.currentUser = res.user;
    showMainApp();
    await loadAllData();
    initSocket();
  } else {
    errorEl.textContent = res.error || '注册失败';
  }
});
