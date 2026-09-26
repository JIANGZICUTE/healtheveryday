const form = document.querySelector('#login-form');
const password = document.querySelector('#password');
const submit = document.querySelector('#login-submit');
const errorBox = document.querySelector('#login-error');
const nextParam = new URLSearchParams(window.location.search).get('next');
const nextPath = nextParam?.startsWith('/') && !nextParam.startsWith('//') ? nextParam : '/';

form.addEventListener('submit', async event => {
  event.preventDefault();
  errorBox.hidden = true;
  submit.disabled = true;
  submit.textContent = '正在验证…';
  try {
    const response = await fetch('/api/login', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: password.value })
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || '登录失败');
    window.location.replace(nextPath);
  } catch (error) {
    errorBox.textContent = error.message || '登录失败，请重试';
    errorBox.hidden = false;
    submit.disabled = false;
    submit.textContent = '登录并同步';
    password.select();
  }
});