const MAX_OPERATIONS = 100;

export class SyncManager {
  constructor(store, options = {}) {
    if (!store) throw new Error('缺少本地数据仓库');
    this.store = store;
    this.fetchImpl = options.fetchImpl || ((url, init) => fetch(url, init));
    this.intervalMs = options.intervalMs || 60_000;
    this.onStatus = options.onStatus || (() => {});
    this.onChanges = options.onChanges || (() => {});
    this.onAuthRequired = options.onAuthRequired || (() => {});
    this.pending = null;
    this.intervalId = null;
    this.started = false;
    this.boundSync = () => this.sync().catch(() => {});
    this.boundVisibility = () => {
      if (document.visibilityState === 'visible') this.boundSync();
    };
  }

  start() {
    if (this.started) return;
    this.started = true;
    window.addEventListener('online', this.boundSync);
    window.addEventListener('focus', this.boundSync);
    document.addEventListener('visibilitychange', this.boundVisibility);
    this.intervalId = window.setInterval(() => {
      if (document.visibilityState === 'visible') this.boundSync();
    }, this.intervalMs);
    this.boundSync();
  }

  stop() {
    if (!this.started) return;
    this.started = false;
    window.removeEventListener('online', this.boundSync);
    window.removeEventListener('focus', this.boundSync);
    document.removeEventListener('visibilitychange', this.boundVisibility);
    if (this.intervalId !== null) window.clearInterval(this.intervalId);
    this.intervalId = null;
  }

  sync() {
    if (this.pending) return this.pending;
    this.pending = this.#syncUntilCaughtUp()
      .finally(() => { this.pending = null; });
    return this.pending;
  }

  async #syncUntilCaughtUp() {
    this.onStatus({ state: 'syncing', error: null });
    let lastResponse = null;
    try {
      const meta = await this.store.getSyncMeta();
      let cursor = Number(meta.cursor || 0);

      while (true) {
        const outbox = await this.store.getOutbox();
        const operations = outbox.slice(0, MAX_OPERATIONS);
        const response = await this.fetchImpl('/api/sync', {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            cursor,
            deviceId: meta.deviceId,
            ops: operations
          })
        });

        if (response.status === 401) {
          const error = new Error('登录已过期');
          error.status = 401;
          this.onAuthRequired();
          throw error;
        }
        if (!response.ok) {
          const payload = await response.json().catch(() => ({}));
          throw new Error(payload.error || `同步失败（${response.status}）`);
        }

        const payload = await response.json();
        if (Array.isArray(payload.changes) && payload.changes.length) {
          await this.store.applyRemoteChanges(payload.changes);
          this.onChanges(payload.changes);
        }

        const acknowledged = [
          ...(payload.applied || []),
          ...(payload.ignored || []).map(item => typeof item === 'string' ? item : item.opId),
          ...(payload.duplicates || [])
        ].filter(Boolean);
        if (acknowledged.length) await this.store.removeOutbox(acknowledged);

        cursor = Number(payload.cursor ?? cursor);
        lastResponse = { ...payload, cursor };
        await this.store.saveSyncMeta({
          cursor,
          lastSyncAt: new Date().toISOString(),
          lastError: null
        });
        if (!payload.hasMore) break;
      }

      this.onStatus({ state: 'synced', error: null, cursor });
      return lastResponse;
    } catch (error) {
      await this.store.saveSyncMeta({ lastError: error.message }).catch(() => {});
      this.onStatus({
        state: error.status === 401 ? 'auth-required' : 'error',
        error
      });
      throw error;
    }
  }
}