export const SYNC_COLLECTIONS = Object.freeze([
  'profile',
  'weights',
  'foods',
  'entries',
  'workouts',
  'settings'
]);

export const MAX_SYNC_OPERATIONS = 100;
export const MAX_SYNC_CHANGES = 200;

const COLLECTION_SET = new Set(SYNC_COLLECTIONS);
const LOCAL_BACKGROUND_FIELDS = ['images', 'imageData', 'imageId', 'imageName', 'crop'];

function clone(value) {
  return typeof structuredClone === 'function'
    ? structuredClone(value)
    : JSON.parse(JSON.stringify(value));
}

function nonEmptyString(value, message) {
  const text = String(value ?? '').trim();
  if (!text) throw new Error(message);
  return text;
}

function normalizeTimestamp(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error('同步时间无效');
  return date.toISOString();
}

export function sanitizeSyncData(collection, data) {
  if (data === null || data === undefined) return data;
  const copy = clone(data);
  if (collection !== 'settings' || !copy.background || typeof copy.background !== 'object') {
    return copy;
  }
  const background = { ...copy.background };
  for (const field of LOCAL_BACKGROUND_FIELDS) delete background[field];
  copy.background = background;
  return copy;
}

export function isSyncableRecord(collection, record) {
  if (!COLLECTION_SET.has(collection) || !record || typeof record !== 'object') return false;
  if (collection === 'foods') return record.custom !== false;
  return true;
}

export function normalizeOperation(operation) {
  if (!operation || typeof operation !== 'object') throw new Error('同步操作无效');
  const collection = nonEmptyString(operation.collection, '缺少数据类型');
  if (!COLLECTION_SET.has(collection)) throw new Error(`不支持的数据类型：${collection}`);

  const action = nonEmptyString(operation.action, '缺少同步动作');
  if (!['put', 'delete'].includes(action)) throw new Error('同步动作无效');
  if (action === 'put' && (!operation.data || typeof operation.data !== 'object')) {
    throw new Error('同步新增或更新操作缺少数据');
  }

  const data = action === 'put' ? sanitizeSyncData(collection, operation.data) : null;
  const recordId = nonEmptyString(operation.id ?? data?.id, '缺少记录 ID');
  if (action === 'put' && isSyncableRecord(collection, data) === false) {
    throw new Error('内置食物不需要同步');
  }

  return Object.freeze({
    opId: nonEmptyString(operation.opId, '缺少操作 ID'),
    collection,
    id: recordId,
    action,
    data,
    clientUpdatedAt: normalizeTimestamp(operation.clientUpdatedAt || data?.updatedAt),
    deviceId: nonEmptyString(operation.deviceId, '缺少设备 ID')
  });
}

export function compareSyncVersions(left, right) {
  const leftTime = new Date(left.clientUpdatedAt).getTime();
  const rightTime = new Date(right.clientUpdatedAt).getTime();
  if (leftTime !== rightTime) return leftTime > rightTime ? 1 : -1;

  const leftDevice = String(left.deviceId || '');
  const rightDevice = String(right.deviceId || '');
  if (leftDevice !== rightDevice) return leftDevice > rightDevice ? 1 : -1;

  const leftOperation = String(left.opId || '');
  const rightOperation = String(right.opId || '');
  if (leftOperation === rightOperation) return 0;
  return leftOperation > rightOperation ? 1 : -1;
}

export function shouldApplyOperation(current, incoming) {
  if (!current) return true;
  return compareSyncVersions(incoming, current) > 0;
}

export function validateSyncRequest(payload) {
  if (!payload || typeof payload !== 'object') throw new Error('同步请求无效');
  const cursor = Number(payload.cursor);
  if (!Number.isInteger(cursor) || cursor < 0) throw new Error('同步游标无效');
  const deviceId = nonEmptyString(payload.deviceId, '缺少设备 ID');
  const operations = payload.ops ?? [];
  if (!Array.isArray(operations)) throw new Error('同步操作列表无效');
  if (operations.length > MAX_SYNC_OPERATIONS) {
    throw new Error(`一次最多同步 ${MAX_SYNC_OPERATIONS} 条操作`);
  }

  const normalized = operations.map(operation => {
    const value = normalizeOperation(operation);
    if (value.deviceId !== deviceId) throw new Error('操作设备 ID 与请求不一致');
    return value;
  });

  return { cursor, deviceId, ops: normalized };
}