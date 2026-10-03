import { clearSessionCookie, createSessionCookie, verifyAppPassword } from './app-auth.js';

function jsonResponse(body, status = 200, headers = {}) {
  return Response.json(body, {
    status,
    headers: { 'Cache-Control': 'no-store', ...headers }
  });
}

export async function handleLoginApi(request, env) {
  if (request.method !== 'POST') return jsonResponse({ error: '仅支持 POST 请求' }, 405);
  let payload;
  try {
    payload = await request.json();
  } catch {
    return jsonResponse({ error: '请求 JSON 无效' }, 400);
  }

  const password = String(payload?.password || '');
  if (password.length < 8 || password.length > 256) {
    return jsonResponse({ error: '密码长度无效' }, 400);
  }

  try {
    if (!(await verifyAppPassword(password, env))) {
      return jsonResponse({ error: '密码错误' }, 401);
    }
    return jsonResponse({ ok: true }, 200, {
      'Set-Cookie': await createSessionCookie('owner', env)
    });
  } catch (error) {
    console.error('Login API failure', error);
    return jsonResponse({ error: error?.status === 500 ? error.message : '登录服务暂时不可用' }, error?.status || 500);
  }
}

export function handleLogoutApi(request) {
  if (request.method !== 'POST') return jsonResponse({ error: '仅支持 POST 请求' }, 405);
  return jsonResponse({ ok: true }, 200, { 'Set-Cookie': clearSessionCookie() });
}