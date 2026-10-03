import { handleLogoutApi } from '../\_lib/login-api.js';

export function onRequest(context) {
  return handleLogoutApi(context.request);
}