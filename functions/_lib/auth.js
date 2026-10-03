const ACCESS_HEADER = 'Cf-Access-Jwt-Assertion';

function createAuthError(message, status) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function normalizeTeamDomain(value) {
  const text = String(value || '').trim().replace(/\/+$/, '');
  if (!text) throw createAuthError('未配置 Cloudflare Access 团队域名', 500);
  return text.startsWith('http') ? text : `https://${text}`;
}

function allowedEmails(env) {
  return String(env.ALLOWED_EMAIL || '')
    .split(',')
    .map(value => value.trim().toLowerCase())
    .filter(Boolean);
}

export async function authenticateAccessRequest(request, env, options = {}) {
  const token = request.headers.get(ACCESS_HEADER);
  if (!token) throw createAuthError('请先通过 Cloudflare Access 登录', 401);

  const verifyJwt = options.verifyJwt || verifyAccessJwt;
  let claims;
  try {
    claims = await verifyJwt(token, env);
  } catch {
    throw createAuthError('Cloudflare Access 登录已失效，请重新登录', 401);
  }

  const email = String(claims.email || '').trim().toLowerCase();
  if (!email) throw createAuthError('无法确认登录邮箱', 403);
  const allowed = allowedEmails(env);
  if (!allowed.length) throw createAuthError('未配置允许访问的邮箱', 500);
  if (!allowed.includes(email)) throw createAuthError('该邮箱无权访问同步数据', 403);

  return {
    userId: String(claims.sub || email),
    email,
    claims
  };
}

export async function verifyAccessJwt(token, env) {
  if (!env.ACCESS_AUD) throw createAuthError('未配置 Cloudflare Access Audience', 500);
  const teamDomain = normalizeTeamDomain(env.ACCESS_TEAM_DOMAIN);
  const { createRemoteJWKSet, jwtVerify } = await import('jose');
  const jwks = createRemoteJWKSet(new URL('/cdn-cgi/access/certs', teamDomain));
  const result = await jwtVerify(token, jwks, {
    issuer: teamDomain,
    audience: env.ACCESS_AUD
  });
  return result.payload;
}

export function authErrorResponse(error) {
  return Response.json(
    { error: error?.message || '同步请求未获授权' },
    {
      status: Number(error?.status) || 401,
      headers: { 'Cache-Control': 'no-store' }
    }
  );
}