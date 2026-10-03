import { authenticateAppRequest } from './_lib/app-auth.js';
import { handlePageRequest } from './_lib/page-auth.js';

export function onRequest(context) {
  return handlePageRequest(context.request, context.env, authenticateAppRequest, context.next);
}