import { authenticateAppRequest } from './app-auth.js';

export async function handlePageRequest(request, env, authenticate, next) {
  const accept = request.headers.get('Accept') || '';
  const url = new URL(request.url);
  if (!accept.includes('text/html') || url.pathname === '/login.html') {
    return next();
  }

  try {
    await authenticate(request, env);
    return next();
  } catch {
    const nextPath = `${url.pathname}${url.search}`;
    const location = `/login.html?next=${encodeURIComponent(nextPath || '/')}`;
    return new Response(null, {
      status: 302,
      headers: {
        Location: location,
        'Cache-Control': 'no-store'
      }
    });
  }
}