import { handleSyncApi } from '../\_lib/api.js';

export function onRequest(context) {
  return handleSyncApi(context.request, context.env);
}