const COOKIE_NAME = '__Host-nutrition_session';
const DEFAULT_DURATION_SECONDS = 60 * 60 * 24 * 30;
const encoder = new TextEncoder();

function authError(message, status = 401) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function bytesToBase64Url(bytes) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function base64UrlToBytes(value) {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(value.length / 4) * 4, '=');
  const binary = atob(padded);
  return Uint8Array.from(binary, character => character.charCodeAt(0));
}

function decodeBase64UrlText(value) {
  return new TextDecoder().decode(base64UrlToBytes(value));
}

async function hmac(secret, value) {
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(value)));
}

function constantTimeEqual(left, right) {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= left[index] ^ right[index];
  }
  return difference === 0;
}

function readCookie(request, name) {
  const cookieHeader = request.headers.get('Cookie') || '';
  for (const part of cookieHeader.split(';')) {
    const separator = part.indexOf('=');
    if (separator < 0) continue;
    if (part.slice(0, separator).trim() === name) return part.slice(separator + 1).trim();
  }
  return null;
}

function requireConfig(env) {
  const secret = String(env.SESSION_SECRET || '').trim();
  const password = String(env.APP_PASSWORD || '');
  if (!secret) throw authError('未配置登录会话密钥', 500);
  if (!password) throw authError('未配置网站密码', 500);
  return { secret, password };
}

export async function verifyAppPassword(candidate, env) {
  const { secret, password } = requireConfig(env);
  const candidateSignature = await hmac(secret, `password:${String(candidate ?? '')}`);
  const expectedSignature = await hmac(secret, `password:${password}`);
  return constantTimeEqual(candidateSignature, expectedSignature);
}

export async function createSessionCookie(userId, env, now = new Date(), options = {}) {
  const { secret } = requireConfig(env);
  const issuedAt = Math.floor(now.getTime() / 1000);
  const durationSeconds = Number(options.durationSeconds) || DEFAULT_DURATION_SECONDS;
  const payload = bytesToBase64Url(encoder.encode(JSON.stringify({
    sub: String(userId || 'owner'),
    iat: issuedAt,
    exp: issuedAt + durationSeconds
  })));
  const signature = bytesToBase64Url(await hmac(secret, payload));
  const token = `${payload}.${signature}`;
  return `${COOKIE_NAME}=${token}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${durationSeconds}`;
}

export function clearSessionCookie() {
  return `${COOKIE_NAME}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`;
}

export async function authenticateAppRequest(request, env, options = {}) {
  const { secret } = requireConfig(env);
  const token = readCookie(request, COOKIE_NAME);
  if (!token) throw authError('请先登录');

  const separator = token.lastIndexOf('.');
  if (separator <= 0) throw authError('登录会话无效');
  const payload = token.slice(0, separator);
  const signature = token.slice(separator + 1);
  const expected = bytesToBase64Url(await hmac(secret, payload));
  if (!constantTimeEqual(encoder.encode(signature), encoder.encode(expected))) {
    throw authError('登录会话无效');
  }

  let claims;
  try {
    claims = JSON.parse(decodeBase64UrlText(payload));
  } catch {
    throw authError('登录会话无效');
  }
  const nowSeconds = Math.floor((options.now || new Date()).getTime() / 1000);
  if (!claims.sub || !Number.isFinite(Number(claims.exp)) || Number(claims.exp) <= nowSeconds) {
    throw authError('登录已过期，请重新登录');
  }
  return { userId: String(claims.sub), claims };
}

export function appAuthErrorResponse(error) {
  return Response.json(
    { error: error?.message || '登录无效' },
    {
      status: Number(error?.status) || 401,
      headers: { 'Cache-Control': 'no-store' }
    }
  );
}