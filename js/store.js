import { scaleNutrition } from './calculations.js';
import { normalizeOperation, sanitizeSyncData } from './sync-core.js';

const DB_NAME = 'nutrition-atlas';
const DB_VERSION = 3;
const STORE_NAMES = Object.freeze({
  profile: 'profile',
  weights: 'weights',
  foods: 'foods',
  entries: 'entries',
  workouts: 'workouts',
  settings: 'settings',
  outbox: 'outbox',
  syncMeta: 'syncMeta'
});

const DATA_STORE_NAMES = Object.freeze([
  STORE_NAMES.profile,
  STORE_NAMES.weights,
  STORE_NAMES.foods,
  STORE_NAMES.entries,
  STORE_NAMES.workouts,
  STORE_NAMES.settings
]);

export const DEFAULT_SETTINGS = Object.freeze({
  workoutNames: null,
  foodSearchHistory: [],
  background: {
    type: 'gradient',
    color: '#eef6f0',
    gradientFrom: '#eef6f0',
    gradientTo: '#b8dfc8',
    preset: 'dawn',
    imageId: null,
    imageName: null,
    images: [],
    crop: null,
    blur: 0,
    dim: 10,
    panelOpacity: 88
  },
  updatedAt: null
});

export class NutritionStore {
  constructor(databaseName = DB_NAME) {
    this.databaseName = databaseName;
    this.db = null;
    this.listeners = new Set();
  }

  async open() {
    if (this.db) return this.db;
    this.db = await new Promise((resolve, reject) => {
      const request = indexedDB.open(this.databaseName, DB_VERSION);
      request.onupgradeneeded = event => {
        const db = event.target.result;
        if (!db.objectStoreNames.contains(STORE_NAMES.profile)) {
          db.createObjectStore(STORE_NAMES.profile, { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains(STORE_NAMES.weights)) {
          const store = db.createObjectStore(STORE_NAMES.weights, { keyPath: 'id' });
          store.createIndex('date', 'date', { unique: false });
        }
        if (!db.objectStoreNames.contains(STORE_NAMES.foods)) {
          const store = db.createObjectStore(STORE_NAMES.foods, { keyPath: 'id' });
          store.createIndex('name', 'name', { unique: false });
          store.createIndex('category', 'category', { unique: false });
        }
        if (!db.objectStoreNames.contains(STORE_NAMES.entries)) {
          const store = db.createObjectStore(STORE_NAMES.entries, { keyPath: 'id' });
          store.createIndex('date', 'date', { unique: false });
          store.createIndex('date_meal', ['date', 'meal'], { unique: false });
        }
        if (!db.objectStoreNames.contains(STORE_NAMES.workouts)) {
          const store = db.createObjectStore(STORE_NAMES.workouts, { keyPath: 'id' });
          store.createIndex('date', 'date', { unique: false });
        }
        if (!db.objectStoreNames.contains(STORE_NAMES.settings)) {
          db.createObjectStore(STORE_NAMES.settings, { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains(STORE_NAMES.outbox)) {
          const store = db.createObjectStore(STORE_NAMES.outbox, { keyPath: 'opId' });
          store.createIndex('createdAt', 'createdAt', { unique: false });
        }
        if (!db.objectStoreNames.contains(STORE_NAMES.syncMeta)) {
          db.createObjectStore(STORE_NAMES.syncMeta, { keyPath: 'id' });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error('无法打开本地数据库'));
      request.onblocked = () => reject(new Error('数据库被另一个页面占用，请关闭其他应用标签后重试'));
    });
    return this.db;
  }

  close() {
    this.db?.close();
    this.db = null;
  }

  subscribe(listener) {
    if (typeof listener !== 'function') throw new Error('同步订阅者无效');
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async getProfile() {
    const record = await this.#get(STORE_NAMES.profile, 'profile');
    if (!record) return null;
    const { id, ...profile } = record;
    return profile;
  }

  async saveProfile(profile) {
    await this.#putWithSync(STORE_NAMES.profile, { ...profile, id: 'profile', updatedAt: new Date().toISOString() });
    return this.getProfile();
  }

  async getWeights() {
    const weights = await this.#all(STORE_NAMES.weights);
    return weights.sort((a, b) => b.date.localeCompare(a.date) || String(b.createdAt).localeCompare(String(a.createdAt)));
  }

  async saveWeight(weight) {
    const now = new Date().toISOString();
    const record = {
      ...weight,
      id: weight.id || createId('weight'),
      weightKg: Number(weight.weightKg),
      createdAt: weight.createdAt || now,
      updatedAt: now
    };
    await this.#putWithSync(STORE_NAMES.weights, record);
    return record;
  }

  async deleteWeight(id) {
    await this.#deleteWithSync(STORE_NAMES.weights, id);
  }

  async getLatestWeight() {
    return (await this.getWeights())[0] || null;
  }

  async getFoods() {
    const foods = await this.#all(STORE_NAMES.foods);
    return foods.sort((a, b) => Number(b.custom) - Number(a.custom) || a.name.localeCompare(b.name, 'zh-CN'));
  }

  async getFood(id) {
    return this.#get(STORE_NAMES.foods, id);
  }

  async saveFood(food) {
    const now = new Date().toISOString();
    const existing = food.id ? await this.getFood(food.id) : null;
    const record = normalizeFood({
      ...food,
      id: food.id || createId('food'),
      createdAt: food.createdAt || existing?.createdAt || now,
      updatedAt: now
    });
    if (record.custom === false) await this.#put(STORE_NAMES.foods, record);
    else await this.#putWithSync(STORE_NAMES.foods, record);
    return record;
  }

  async deleteFood(id) {
    const food = await this.getFood(id);
    if (food?.custom === false) throw new Error('内置食物不能直接删除，请复制后编辑');
    await this.#deleteWithSync(STORE_NAMES.foods, id);
  }

  async seedFoods(foods) {
    const existing = new Set((await this.#all(STORE_NAMES.foods)).map(food => food.id));
    const missing = foods.filter(food => !existing.has(food.id));
    if (!missing.length) return 0;
    await this.#runTransaction(STORE_NAMES.foods, 'readwrite', stores => {
      const foodStore = stores[STORE_NAMES.foods];
      missing.forEach(food => foodStore.put(normalizeFood({ ...food, custom: false })));
    });
    return missing.length;
  }

  async getWorkouts(date) {
    const workouts = date
      ? await this.#getAllByIndex(STORE_NAMES.workouts, 'date', date)
      : await this.#all(STORE_NAMES.workouts);
    return workouts.sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
  }

  async saveWorkout(workout) {
    const now = new Date().toISOString();
    const record = {
      ...workout,
      id: workout.id || createId('workout'),
      weightKg: workout.type === 'strength' ? numberOrZero(workout.weightKg) : null,
      sets: workout.type === 'strength' ? Math.max(1, Number(workout.sets) || 1) : null,
      reps: workout.type === 'strength' ? Math.max(1, Number(workout.reps) || 1) : null,
      durationMinutes: workout.type === 'cardio' ? Math.max(0.1, Number(workout.durationMinutes) || 0) : null,
      createdAt: workout.createdAt || now,
      updatedAt: now
    };
    await this.#putWithSync(STORE_NAMES.workouts, record);
    return record;
  }

  async deleteWorkout(id) {
    await this.#deleteWithSync(STORE_NAMES.workouts, id);
  }
  async getEntries(date) {
    if (date) {
      const entries = await this.#getAllByIndex(STORE_NAMES.entries, 'date', date);
      return sortEntries(entries);
    }
    const entries = await this.#all(STORE_NAMES.entries);
    return sortEntries(entries);
  }

  async addEntry(entry) {
    const food = await this.getFood(entry.foodId);
    if (!food) throw new Error('找不到所选食物');
    const grams = Number(entry.grams);
    if (!(grams > 0)) throw new Error('克数必须大于 0');
    const now = new Date().toISOString();
    const record = {
      ...entry,
      id: entry.id || createId('entry'),
      grams,
      nutrients: entry.nutrients || scaleNutrition(food.per100g, grams),
      foodSnapshot: entry.foodSnapshot || {
        name: food.name,
        category: food.category,
        state: food.state,
        servingLabel: food.servingLabel,
        servingGrams: food.servingGrams,
        per100g: { ...food.per100g }
      },
      createdAt: entry.createdAt || now,
      updatedAt: now
    };
    await this.#putWithSync(STORE_NAMES.entries, record);
    return record;
  }

  async deleteEntry(id) {
    await this.#deleteWithSync(STORE_NAMES.entries, id);
  }

  async getSettings() {
    const record = await this.#get(STORE_NAMES.settings, 'settings');
    if (!record) return structuredClone(DEFAULT_SETTINGS);
    const { id, ...settings } = record;
    return {
      ...structuredClone(DEFAULT_SETTINGS),
      ...settings,
      background: {
        ...DEFAULT_SETTINGS.background,
        ...(settings.background || {})
      }
    };
  }

  async saveSettings(settings) {
    const record = {
      ...settings,
      id: 'settings',
      updatedAt: new Date().toISOString()
    };
    await this.#putWithSync(STORE_NAMES.settings, record);
    return this.getSettings();
  }

  async exportData() {
    const [profile, weights, foods, entries, workouts, settings] = await Promise.all([
      this.getProfile(),
      this.getWeights(),
      this.getFoods(),
      this.getEntries(),
      this.getWorkouts(),
      this.getSettings()
    ]);
    return {
      schemaVersion: 1,
      exportedAt: new Date().toISOString(),
      app: 'nutrition-atlas',
      profile,
      weights,
      foods,
      entries,
      workouts,
      settings
    };
  }

  async replaceData(backup) {
    validateBackup(backup);
    const [profile, weights, foods, entries, workouts, settings] = await Promise.all([
      this.getProfile(),
      this.getWeights(),
      this.getFoods(),
      this.getEntries(),
      this.getWorkouts(),
      this.getSettings()
    ]);
    const meta = await this.getSyncMeta();
    const replacement = {
      profile: backup.profile ? { ...backup.profile, id: 'profile' } : null,
      weights: backup.weights || [],
      foods: (backup.foods || []).map(normalizeFood),
      entries: backup.entries || [],
      workouts: backup.workouts || [],
      settings: { ...(backup.settings || DEFAULT_SETTINGS), id: 'settings' }
    };
    const operations = buildReplacementOperations({
      existing: { profile, weights, foods, entries, workouts, settings },
      replacement,
      deviceId: meta.deviceId
    });

    await this.#runTransaction([...DATA_STORE_NAMES, STORE_NAMES.outbox], 'readwrite', stores => {
      stores[STORE_NAMES.outbox].clear();
      DATA_STORE_NAMES.forEach(name => stores[name].clear());
      if (replacement.profile) stores[STORE_NAMES.profile].put(replacement.profile);
      replacement.weights.forEach(item => stores[STORE_NAMES.weights].put(item));
      replacement.foods.forEach(item => stores[STORE_NAMES.foods].put(item));
      replacement.entries.forEach(item => stores[STORE_NAMES.entries].put(item));
      replacement.workouts.forEach(item => stores[STORE_NAMES.workouts].put(item));
      stores[STORE_NAMES.settings].put(replacement.settings);
      operations.forEach(operation => stores[STORE_NAMES.outbox].put(operation));
    });
    this.#notify();
  }

  async clearAll() {
    const [profile, weights, foods, entries, workouts, settings] = await Promise.all([
      this.getProfile(),
      this.getWeights(),
      this.getFoods(),
      this.getEntries(),
      this.getWorkouts(),
      this.getSettings()
    ]);
    const meta = await this.getSyncMeta();
    const storedSettings = await this.#get(STORE_NAMES.settings, 'settings');
    const existing = { profile, weights, foods, entries, workouts, settings: storedSettings ? settings : null };
    const operations = [];
    for (const collection of DATA_STORE_NAMES) {
      const records = collection === STORE_NAMES.profile
        ? (profile ? [profile] : [])
        : collection === STORE_NAMES.settings
          ? (storedSettings ? [settings] : [])
          : existing[collection] || [];
      for (const record of records) {
        if (!isSyncableStoreRecord(collection, record)) continue;
        operations.push(createOutboxOperation({
          deviceId: meta.deviceId,
          collection,
          id: record.id || (collection === STORE_NAMES.profile ? 'profile' : 'settings'),
          action: 'delete'
        }));
      }
    }

    await this.#runTransaction([...DATA_STORE_NAMES, STORE_NAMES.outbox], 'readwrite', stores => {
      stores[STORE_NAMES.outbox].clear();
      DATA_STORE_NAMES.forEach(name => stores[name].clear());
      operations.forEach(operation => stores[STORE_NAMES.outbox].put(operation));
    });
    this.#notify();
  }

  static async deleteDatabase(name) {
    await new Promise((resolve, reject) => {
      const request = indexedDB.deleteDatabase(name);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error || new Error('测试数据库清理失败'));
      request.onblocked = () => resolve();
    });
  }

  async getSyncMeta() {
    const existing = await this.#get(STORE_NAMES.syncMeta, 'syncMeta');
    if (existing) return existing;
    const meta = {
      id: 'syncMeta',
      deviceId: createId('device'),
      cursor: 0,
      lastSyncAt: null,
      lastError: null
    };
    await this.#put(STORE_NAMES.syncMeta, meta);
    return meta;
  }

  async saveSyncMeta(patch) {
    const current = await this.getSyncMeta();
    const record = { ...current, ...patch, id: 'syncMeta' };
    await this.#put(STORE_NAMES.syncMeta, record);
    return record;
  }

  async getOutbox() {
    const operations = await this.#all(STORE_NAMES.outbox);
    return operations.sort((left, right) => (
      String(left.createdAt).localeCompare(String(right.createdAt))
      || String(left.opId).localeCompare(String(right.opId))
    ));
  }

  async removeOutbox(opIds) {
    const ids = [...new Set(opIds)].filter(Boolean);
    if (!ids.length) return;
    await this.#runTransaction(STORE_NAMES.outbox, 'readwrite', stores => {
      const outbox = stores[STORE_NAMES.outbox];
      ids.forEach(opId => outbox.delete(opId));
    });
  }

  async applyRemoteChanges(changes) {
    const validChanges = (changes || []).filter(change => (
      change
      && DATA_STORE_NAMES.includes(change.collection)
      && typeof change.id === 'string'
      && change.id
    ));
    if (!validChanges.length) return 0;

    const localSettings = validChanges.some(change => change.collection === STORE_NAMES.settings)
      ? await this.getSettings()
      : null;
    const storeNames = [...new Set(validChanges.map(change => change.collection))];
    await this.#runTransaction(storeNames, 'readwrite', stores => {
      for (const change of validChanges) {
        const store = stores[change.collection];
        if (change.deleted) {
          store.delete(change.id);
          continue;
        }
        if (change.collection === STORE_NAMES.settings) {
          const remote = sanitizeSyncData('settings', change.data || {});
          store.put(mergeRemoteSettings(remote, localSettings));
          continue;
        }
        store.put({ ...(change.data || {}), id: change.id });
      }
    });
    return validChanges.length;
  }
  async #putWithSync(storeName, value) {
    const meta = await this.getSyncMeta();
    const operation = normalizeOperation({
      opId: createId('op'),
      collection: storeName,
      id: value.id,
      action: 'put',
      data: value,
      clientUpdatedAt: value.updatedAt || new Date().toISOString(),
      deviceId: meta.deviceId
    });
    const transaction = this.db.transaction([storeName, STORE_NAMES.outbox], 'readwrite');
    transaction.objectStore(storeName).put(value);
    transaction.objectStore(STORE_NAMES.outbox).put({ ...operation, createdAt: new Date().toISOString() });
    await transactionDone(transaction);
    this.#notify();
    return value;
  }

  async #deleteWithSync(storeName, id) {
    const meta = await this.getSyncMeta();
    const operation = normalizeOperation({
      opId: createId('op'),
      collection: storeName,
      id,
      action: 'delete',
      data: null,
      clientUpdatedAt: new Date().toISOString(),
      deviceId: meta.deviceId
    });
    const transaction = this.db.transaction([storeName, STORE_NAMES.outbox], 'readwrite');
    transaction.objectStore(storeName).delete(id);
    transaction.objectStore(STORE_NAMES.outbox).put({ ...operation, createdAt: new Date().toISOString() });
    await transactionDone(transaction);
    this.#notify();
  }

  #notify() {
    for (const listener of this.listeners) {
      try { listener(); } catch {}
    }
  }

  async #get(storeName, key) {
    await this.open();
    return requestToPromise(this.db.transaction(storeName, 'readonly').objectStore(storeName).get(key));
  }

  async #all(storeName) {
    await this.open();
    return requestToPromise(this.db.transaction(storeName, 'readonly').objectStore(storeName).getAll());
  }

  async #getAllByIndex(storeName, indexName, query) {
    await this.open();
    const store = this.db.transaction(storeName, 'readonly').objectStore(storeName);
    return requestToPromise(store.index(indexName).getAll(query));
  }

  async #put(storeName, value) {
    await this.open();
    const transaction = this.db.transaction(storeName, 'readwrite');
    transaction.objectStore(storeName).put(value);
    await transactionDone(transaction);
    return value;
  }

  async #delete(storeName, key) {
    await this.open();
    const transaction = this.db.transaction(storeName, 'readwrite');
    transaction.objectStore(storeName).delete(key);
    await transactionDone(transaction);
  }

  async #runTransaction(storeNames, mode, callback) {
    await this.open();
    const names = Array.isArray(storeNames) ? storeNames : [storeNames];
    const transaction = this.db.transaction(names, mode);
    const stores = Object.fromEntries(names.map(name => [name, transaction.objectStore(name)]));
    callback(stores);
    await transactionDone(transaction);
  }
}

function createOutboxOperation({ deviceId, collection, id, action, data = null, clientUpdatedAt = new Date().toISOString() }) {
  return {
    ...normalizeOperation({
      opId: createId('op'),
      collection,
      id,
      action,
      data,
      clientUpdatedAt,
      deviceId
    }),
    createdAt: new Date().toISOString()
  };
}

function isSyncableStoreRecord(collection, record) {
  if (!record) return false;
  if (collection === STORE_NAMES.foods) return record.custom !== false;
  return true;
}

function buildReplacementOperations({ existing, replacement, deviceId }) {
  const operations = [];
  const collections = [
    STORE_NAMES.profile,
    STORE_NAMES.weights,
    STORE_NAMES.foods,
    STORE_NAMES.entries,
    STORE_NAMES.workouts,
    STORE_NAMES.settings
  ];
  for (const collection of collections) {
    const oldRecords = collection === STORE_NAMES.profile
      ? (existing.profile ? [existing.profile] : [])
      : collection === STORE_NAMES.settings
        ? [existing.settings]
        : existing[collection] || [];
    const newRecords = collection === STORE_NAMES.profile
      ? (replacement.profile ? [replacement.profile] : [])
      : collection === STORE_NAMES.settings
        ? [replacement.settings]
        : replacement[collection] || [];
    const newIds = new Set(newRecords.map(record => record.id));
    for (const record of oldRecords) {
      if (!isSyncableStoreRecord(collection, record)) continue;
      const id = record.id || (collection === STORE_NAMES.profile ? 'profile' : 'settings');
      if (!newIds.has(id)) {
        operations.push(createOutboxOperation({ deviceId, collection, id, action: 'delete' }));
      }
    }
    for (const record of newRecords) {
      if (!isSyncableStoreRecord(collection, record)) continue;
      const id = record.id || (collection === STORE_NAMES.profile ? 'profile' : 'settings');
      operations.push(createOutboxOperation({
        deviceId,
        collection,
        id,
        action: 'put',
        data: record,
        clientUpdatedAt: record.updatedAt || new Date().toISOString()
      }));
    }
  }
  return operations;
}
function mergeRemoteSettings(remote, localSettings) {
  const localBackground = localSettings?.background || DEFAULT_SETTINGS.background;
  const remoteBackground = remote.background || {};
  const mergedBackground = {
    ...localBackground,
    ...remoteBackground,
    images: localBackground.images || [],
    imageData: localBackground.imageData || null,
    imageId: localBackground.imageId || null,
    imageName: localBackground.imageName || null,
    crop: localBackground.crop || null
  };
  if (mergedBackground.type === 'image' && !mergedBackground.imageData) {
    mergedBackground.type = 'gradient';
  }
  return {
    ...DEFAULT_SETTINGS,
    ...localSettings,
    ...remote,
    id: 'settings',
    background: mergedBackground
  };
}
function normalizeFood(food) {
  const per100g = food.per100g || {};
  return {
    ...food,
    name: String(food.name || '').trim(),
    aliases: Array.isArray(food.aliases) ? food.aliases : [],
    category: food.category || '其他',
    state: food.state || '可食部',
    source: food.source || '用户自定义',
    custom: food.custom !== false,
    servingLabel: String(food.servingLabel || '1份').trim() || '1份',
    servingGrams: Number(food.servingGrams) > 0 ? Number(food.servingGrams) : null,
    per100g: {
      kcal: numberOrZero(per100g.kcal),
      carbs: numberOrZero(per100g.carbs),
      protein: numberOrZero(per100g.protein),
      fat: numberOrZero(per100g.fat)
    }
  };
}

function sortEntries(entries) {
  const mealOrder = { breakfast: 0, lunch: 1, dinner: 2, snack: 3 };
  return entries.sort((a, b) => {
    const byDate = String(a.date).localeCompare(String(b.date));
    if (byDate) return byDate;
    return (mealOrder[a.meal] ?? 9) - (mealOrder[b.meal] ?? 9) || String(a.createdAt).localeCompare(String(b.createdAt));
  });
}

function validateBackup(backup) {
  if (!backup || typeof backup !== 'object') throw new Error('备份文件内容无效');
  if (backup.schemaVersion !== 1) throw new Error('不支持的备份版本');
  for (const key of ['weights', 'foods', 'entries', 'workouts']) {
    if (backup[key] !== undefined && !Array.isArray(backup[key])) throw new Error(`备份中的 ${key} 字段无效`);
  }
  if (backup.profile !== null && backup.profile !== undefined && typeof backup.profile !== 'object') {
    throw new Error('备份中的个人资料无效');
  }
}

function requestToPromise(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('本地数据库操作失败'));
  });
}

function transactionDone(transaction) {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error || new Error('本地数据库事务失败'));
    transaction.onabort = () => reject(transaction.error || new Error('本地数据库事务已取消'));
  });
}

function createId(prefix) {
  if (globalThis.crypto?.randomUUID) return `${prefix}-${crypto.randomUUID()}`;
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function numberOrZero(value) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : 0;
}