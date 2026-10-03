import { appAuthErrorResponse, authenticateAppRequest } from './app-auth.js';
import { D1SyncRepository, SyncService } from './sync-service.js';
import { validateSyncRequest } from '../../js/sync-core.js';

function jsonResponse(body, status = 200) {
  return Response.json(body, {
    status,
    headers: { 'Cache-Control': 'no-store' }
  });
}

export async function handleSyncApi(request, env, dependencies = {}) {
  if (request.method !== 'POST') {
    return jsonResponse({ error: '仅支持 POST 请求' }, 405);
  }

  const authenticate = dependencies.authenticate || authenticateAppRequest;
  let identity;
  try {
    identity = await authenticate(request, env);
  } catch (error) {
    return appAuthErrorResponse(error);
  }

  let payload;
  try {
    payload = await request.json();
  } catch {
    return jsonResponse({ error: '请求 JSON 无效' }, 400);
  }

  try {
    validateSyncRequest(payload);
  } catch (error) {
    return jsonResponse({ error: error.message }, 400);
  }

  try {
    const createRepository = dependencies.createRepository || (database => new D1SyncRepository(database));
    const repository = createRepository(env.SYNC_DB, env);
    const service = dependencies.service || new SyncService(repository);
    const result = await service.sync(identity.userId, payload);
    return jsonResponse(result);
  } catch (error) {
    console.error('Sync API failure', error);
    return jsonResponse({ error: '同步服务暂时不可用' }, 500);
  }
}