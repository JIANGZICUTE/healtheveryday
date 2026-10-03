import { handleLoginApi } from '../\_lib/login-api.js';

export function onRequest(context) {
  return handleLoginApi(context.request, context.env);
}