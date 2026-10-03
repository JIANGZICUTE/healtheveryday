import {
  MAX_SYNC_CHANGES,
  shouldApplyOperation,
  validateSyncRequest
} from '../../js/sync-core.js';

export class SyncService {
  constructor(repository, options = {}) {
    if (!repository) throw new Error('缺少同步数据仓库');
    this.repository = repository;
    this.changeLimit = options.changeLimit || MAX_SYNC_CHANGES;
  }

  async sync(userId, payload) {
    if (!userId) throw new Error('缺少同步用户');
    const request = validateSyncRequest(payload);
    const meta = await this.repository.getMeta(userId);
    const outcomes = await this.repository.getOperationOutcomes(
      userId,
      request.ops.map(operation => operation.opId)
    );

    const duplicates = [];
    const pending = [];
    for (const operation of request.ops) {
      if (outcomes.has(operation.opId)) duplicates.push(operation.opId);
      else pending.push(operation);
    }

    const references = [...new Map(pending.map(operation => [
      `${operation.collection}:${operation.id}`,
      { collection: operation.collection, id: operation.id }
    ])).values()];
    const currentEntities = await this.repository.getEntities(userId, references);
    const applied = [];
    const ignored = [];
    const decisionOutcomes = [];

    for (const operation of pending) {
      const key = `${operation.collection}:${operation.id}`;
      const current = currentEntities.get(key);
      if (shouldApplyOperation(current, operation)) {
        applied.push(operation);
        currentEntities.set(key, operation);
        decisionOutcomes.push({ opId: operation.opId, outcome: 'applied' });
      } else {
        ignored.push({ opId: operation.opId, reason: 'stale' });
        decisionOutcomes.push({ opId: operation.opId, outcome: 'ignored' });
      }
    }

    const cursor = await this.repository.commit(userId, applied, decisionOutcomes, meta.cursor);
    const changes = await this.repository.getChanges(userId, request.cursor, this.changeLimit + 1);
    const hasMore = changes.length > this.changeLimit;
    const visibleChanges = hasMore ? changes.slice(0, this.changeLimit) : changes;
    const nextCursor = visibleChanges.length
      ? Math.max(cursor, visibleChanges[visibleChanges.length - 1].revision)
      : cursor;

    return {
      cursor: nextCursor,
      hasMore,
      applied: applied.map(operation => operation.opId),
      ignored,
      duplicates,
      changes: visibleChanges.map(toWireChange)
    };
  }
}

export class D1SyncRepository {
  constructor(database) {
    if (!database) throw new Error('缺少 D1 数据库绑定');
    this.database = database;
  }

  async getMeta(userId) {
    const now = new Date().toISOString();
    await this.database.prepare(`
      INSERT INTO sync_meta (user_id, cursor, updated_at)
      VALUES (?, 0, ?)
      ON CONFLICT(user_id) DO NOTHING
    `).bind(userId, now).run();
    const record = await this.database.prepare(`
      SELECT cursor FROM sync_meta WHERE user_id = ?
    `).bind(userId).first();
    return { cursor: Number(record?.cursor || 0) };
  }

  async getOperationOutcomes(userId, opIds) {
    if (!opIds.length) return new Map();
    const placeholders = opIds.map(() => '?').join(', ');
    const result = await this.database.prepare(`
      SELECT op_id, outcome
      FROM sync_ops
      WHERE user_id = ? AND op_id IN (${placeholders})
    `).bind(userId, ...opIds).all();
    return new Map((result.results || []).map(item => [item.op_id, item.outcome]));
  }

  async getEntities(userId, references) {
    if (!references.length) return new Map();
    const conditions = references.map(() => '(collection = ? AND entity_id = ?)').join(' OR ');
    const bindings = references.flatMap(item => [item.collection, item.id]);
    const result = await this.database.prepare(`
      SELECT collection, entity_id, revision, deleted, client_updated_at, device_id, op_id, payload
      FROM sync_entities
      WHERE user_id = ? AND (${conditions})
    `).bind(userId, ...bindings).all();
    return new Map((result.results || []).map(item => [
      `${item.collection}:${item.entity_id}`,
      fromDatabaseRow(item)
    ]));
  }

  async commit(userId, applied, outcomes, currentCursor) {
    const now = new Date().toISOString();
    const statements = [];
    if (applied.length) {
      statements.push(this.database.prepare(`
        UPDATE sync_meta SET cursor = cursor + 1, updated_at = ? WHERE user_id = ?
      `).bind(now, userId));
      for (const operation of applied) {
        const statement = this.database.prepare(`
          INSERT INTO sync_entities (
            user_id, collection, entity_id, revision, deleted,
            client_updated_at, device_id, op_id, payload, updated_at
          ) VALUES (
            ?, ?, ?, (SELECT cursor FROM sync_meta WHERE user_id = ?), ?, ?, ?, ?, ?, ?
          )
          ON CONFLICT(user_id, collection, entity_id) DO UPDATE SET
            revision = excluded.revision,
            deleted = excluded.deleted,
            client_updated_at = excluded.client_updated_at,
            device_id = excluded.device_id,
            op_id = excluded.op_id,
            payload = excluded.payload,
            updated_at = excluded.updated_at
          WHERE excluded.client_updated_at > sync_entities.client_updated_at
             OR (
               excluded.client_updated_at = sync_entities.client_updated_at
               AND excluded.device_id > sync_entities.device_id
             )
             OR (
               excluded.client_updated_at = sync_entities.client_updated_at
               AND excluded.device_id = sync_entities.device_id
               AND excluded.op_id > sync_entities.op_id
             )
        `).bind(
          userId,
          operation.collection,
          operation.id,
          userId,
          operation.action === 'delete' ? 1 : 0,
          operation.clientUpdatedAt,
          operation.deviceId,
          operation.opId,
          operation.data ? JSON.stringify(operation.data) : null,
          now
        );
        statements.push(statement);
      }
    }

    for (const outcome of outcomes) {
      statements.push(this.database.prepare(`
        INSERT OR IGNORE INTO sync_ops (user_id, op_id, outcome, revision, created_at)
        VALUES (?, ?, ?, (SELECT cursor FROM sync_meta WHERE user_id = ?), ?)
      `).bind(userId, outcome.opId, outcome.outcome, userId, now));
    }

    if (statements.length) await this.database.batch(statements);
    const meta = await this.getMeta(userId);
    return Math.max(Number(currentCursor || 0), meta.cursor);
  }

  async getChanges(userId, cursor, limit) {
    const result = await this.database.prepare(`
      SELECT collection, entity_id, revision, deleted, client_updated_at, device_id, op_id, payload
      FROM sync_entities
      WHERE user_id = ? AND revision > ?
      ORDER BY revision ASC, collection ASC, entity_id ASC
      LIMIT ?
    `).bind(userId, cursor, limit).all();
    return (result.results || []).map(fromDatabaseRow);
  }
}

function fromDatabaseRow(row) {
  return {
    collection: row.collection,
    id: row.entity_id,
    revision: Number(row.revision),
    deleted: Boolean(row.deleted),
    clientUpdatedAt: row.client_updated_at,
    deviceId: row.device_id,
    opId: row.op_id,
    data: row.payload ? JSON.parse(row.payload) : null
  };
}

function toWireChange(change) {
  return {
    collection: change.collection,
    id: change.id,
    revision: change.revision,
    deleted: change.deleted,
    clientUpdatedAt: change.clientUpdatedAt,
    data: change.data
  };
}