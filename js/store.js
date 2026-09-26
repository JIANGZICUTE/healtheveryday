import { scaleNutrition } from './calculations.js';

const DB_NAME = 'nutrition-atlas';
const DB_VERSION = 2;
const STORE_NAMES = Object.freeze({
  profile: 'profile',
  weights: 'weights',
  foods: 'foods',
  entries: 'entries',
  workouts: 'workouts',
  settings: 'settings'
});

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
        }        if (!db.objectStoreNames.contains(STORE_NAMES.settings)) {
          db.createObjectStore(STORE_NAMES.settings, { keyPath: 'id' });
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

  async getProfile() {
    const record = await this.#get(STORE_NAMES.profile, 'profile');
    if (!record) return null;
    const { id, ...profile } = record;
    return profile;
  }

  async saveProfile(profile) {
    await this.#put(STORE_NAMES.profile, { ...profile, id: 'profile', updatedAt: new Date().toISOString() });
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
    await this.#put(STORE_NAMES.weights, record);
    return record;
  }

  async deleteWeight(id) {
    await this.#delete(STORE_NAMES.weights, id);
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
    await this.#put(STORE_NAMES.foods, record);
    return record;
  }

  async deleteFood(id) {
    const food = await this.getFood(id);
    if (food?.custom === false) throw new Error('内置食物不能直接删除，请复制后编辑');
    await this.#delete(STORE_NAMES.foods, id);
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
    await this.#put(STORE_NAMES.workouts, record);
    return record;
  }

  async deleteWorkout(id) {
    await this.#delete(STORE_NAMES.workouts, id);
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
    await this.#put(STORE_NAMES.entries, record);
    return record;
  }

  async deleteEntry(id) {
    await this.#delete(STORE_NAMES.entries, id);
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
    await this.#put(STORE_NAMES.settings, record);
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
    await this.#runTransaction(Object.values(STORE_NAMES), 'readwrite', stores => {
      Object.values(stores).forEach(store => store.clear());
      if (backup.profile) stores[STORE_NAMES.profile].put({ ...backup.profile, id: 'profile' });
      (backup.weights || []).forEach(item => stores[STORE_NAMES.weights].put(item));
      (backup.foods || []).forEach(item => stores[STORE_NAMES.foods].put(normalizeFood(item)));
      (backup.entries || []).forEach(item => stores[STORE_NAMES.entries].put(item));
      (backup.workouts || []).forEach(item => stores[STORE_NAMES.workouts].put(item));
      stores[STORE_NAMES.settings].put({ ...(backup.settings || DEFAULT_SETTINGS), id: 'settings' });
    });
  }

  async clearAll() {
    await this.#runTransaction(Object.values(STORE_NAMES), 'readwrite', stores => {
      Object.values(stores).forEach(store => store.clear());
    });
  }

  static async deleteDatabase(name) {
    await new Promise((resolve, reject) => {
      const request = indexedDB.deleteDatabase(name);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error || new Error('测试数据库清理失败'));
      request.onblocked = () => resolve();
    });
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