import { NutritionStore, DEFAULT_SETTINGS } from './store.js';
import { FOOD_LIBRARY, searchFoods } from './foods.js';
import {
  calculateActivityMultiplier,
  calculateBmr,
  calculateMacroTargets,
  calculateTdee,
  scaleNutrition,
  sumEntries
} from './calculations.js';
import {
  MEALS,
  addDays,
  calculateBackgroundCropStyle,
  clamp,
  createDateRange,
  debounce,
  downloadBlob,
  escapeHtml,
  formatDateLabel,
  formatNumber,
  groupEntriesByMeal,
  localDateKey,
  validateMacroRatios
} from './utils.js';
import { lineChart } from './charts.js';
import { analyzeImageTheme, BASE_THEME, ensureAccessibleTextColor, contrastRatio, hexToRgb, rgbToHex } from './theme.js';

const params = new URLSearchParams(window.location.search);
const isTestMode = params.has('test');
const databaseName = params.get('db') || (isTestMode ? `nutrition-atlas-ui-test-${Date.now()}` : undefined);
const store = new NutritionStore(databaseName);
const todayKey = localDateKey();
let deferredInstallPrompt = null;
let pendingImport = null;
let pendingBackgroundUpload = null;
const backgroundCropEditor = {
  naturalWidth: 0,
  naturalHeight: 0,
  scale: 1,
  offsetX: 0,
  offsetY: 0,
  dragging: false,
  pointerId: null,
  pointerStartX: 0,
  pointerStartY: 0,
  offsetStartX: 0,
  offsetStartY: 0
};

const state = {
  route: 'today',
  selectedDate: todayKey,
  profile: null,
  foods: [],
  weights: [],
  allEntries: [],
  workouts: [],
  settings: structuredClone(DEFAULT_SETTINGS),
  selectedEntryFood: null
};

const routeMeta = {
  today: { kicker: '今日记录', title: '今日营养' },
  workout: { kicker: '今日训练', title: '运动记录' },
  history: { kicker: '长期变化', title: '历史趋势' },
  foods: { kicker: '常吃食物', title: '食物库' },
  profile: { kicker: '代谢估算', title: '个人资料' },
  appearance: { kicker: '个人氛围', title: '网页背景' }
};

const $ = (selector, scope = document) => scope.querySelector(selector);
const $$ = (selector, scope = document) => [...scope.querySelectorAll(selector)];

renderToday();
init();

async function init() {
  try {
    await store.open();
    await store.seedFoods(FOOD_LIBRARY);
    await reloadState();
    await ensureActiveBackgroundTheme();
    bindEvents();
    populateFoodCategories();
    syncProfileForm();
    syncWeightForm();
    syncBackgroundForm();
    applyBackground(state.settings);
    renderRoute('today');
    document.documentElement.dataset.appReady = 'true';
    if (isTestMode) window.__nutritionAtlas = { store, state, renderRoute, reloadState };
    if (!isTestMode && 'serviceWorker' in navigator) {
      navigator.serviceWorker.register('./sw.js').catch(() => {});
    }
  } catch (error) {
    document.documentElement.dataset.appReady = 'error';
    showToast(`应用初始化失败：${error.message}`, 'error');
  }
}

async function reloadState() {
  const [profile, foods, weights, entries, workouts, settings] = await Promise.all([
    store.getProfile(),
    store.getFoods(),
    store.getWeights(),
    store.getEntries(),
    store.getWorkouts(),
    store.getSettings()
  ]);
  state.profile = profile;
  state.foods = foods;
  state.weights = weights;
  state.allEntries = entries;
  state.workouts = workouts;
  state.settings = ensureBackgroundLibrary(settings);
  if (state.settings.workoutNames === null) {
    state.settings.workoutNames = [...new Set(state.workouts.map(workout => workout.name).filter(Boolean))];
    state.settings = await store.saveSettings(state.settings);
  }
}

function bindEvents() {
  $$('.nav-button').forEach(button => button.addEventListener('click', () => renderRoute(button.dataset.route)));
  document.body.addEventListener('click', handleBodyClick);
  $('#date-prev').addEventListener('click', () => changeSelectedDate(-1));
  $('#date-next').addEventListener('click', () => changeSelectedDate(1));
  $('#today-date-button').addEventListener('click', () => {
    state.selectedDate = todayKey;
    renderRoute('today');
  });

  $('#food-search').addEventListener('input', renderFoodList);
  $('#food-category-filter').addEventListener('change', renderFoodList);
  $('#food-source-filter').addEventListener('change', renderFoodList);
  $('#food-form').addEventListener('submit', handleFoodSubmit);  $('#food-kcal').addEventListener('input', renderFoodEnergyConversion);
  $('#food-energy-unit').addEventListener('change', handleFoodEnergyUnitChange);
  $('#add-food-button').addEventListener('click', () => openFoodDialog());

  $('#entry-food-search').addEventListener('input', event => renderEntryFoodResults(event.target.value));
  $('#entry-amount').addEventListener('input', renderEntryPreview);
  $('#entry-unit').addEventListener('change', handleEntryUnitChange);
  $('#entry-form').addEventListener('submit', handleEntrySubmit);


  $('#workout-type').addEventListener('change', updateWorkoutFormFields);
  $('#workout-form').addEventListener('submit', handleWorkoutSubmit);  $('#maintenance-form').addEventListener('submit', handleMaintenanceSubmit);  $$('[data-nutrient-toggle]').forEach(input => input.addEventListener('change', handleOptionalNutrientToggle));  $('#profile-form').addEventListener('input', handleProfileInput);
  $('#profile-form').addEventListener('submit', handleProfileSubmit);
  $('#weight-form').addEventListener('submit', handleWeightSubmit);
  $('#history-range').addEventListener('change', renderHistory);
  $('#toggle-history-data').addEventListener('click', toggleHistoryTable);
  $('#export-data').addEventListener('click', exportBackup);
  $('#import-file').addEventListener('change', prepareImport);
  $('#confirm-import').addEventListener('click', confirmImport);
  $('#reset-data').addEventListener('click', resetAllData);

  $('#background-type').addEventListener('change', handleBackgroundChange);
  $('#background-color').addEventListener('input', debounce(handleBackgroundChange, 120));
  $('#background-color').addEventListener('change', handleBackgroundChange);
  $('#gradient-from').addEventListener('input', debounce(handleBackgroundChange, 120));
  $('#gradient-from').addEventListener('change', handleBackgroundChange);
  $('#gradient-to').addEventListener('input', debounce(handleBackgroundChange, 120));
  $('#gradient-to').addEventListener('change', handleBackgroundChange);
  $('#background-preset').addEventListener('change', handleBackgroundChange);
  $('#background-blur').addEventListener('input', handleBackgroundChange);
  $('#background-dim').addEventListener('input', handleBackgroundChange);
  $('#panel-opacity').addEventListener('input', handlePanelOpacityChange);
  $('#background-image-input').addEventListener('change', handleBackgroundImage);
  $('#background-crop-ratio').addEventListener('change', resetBackgroundCropEditor);
  $('#background-crop-zoom').addEventListener('input', updateBackgroundCropTransform);
  $('#background-crop-reset').addEventListener('click', resetBackgroundCropEditor);
  $('#save-background-crop').addEventListener('click', saveCroppedBackground);
  const cropStage = $('#background-crop-stage');
  cropStage.addEventListener('pointerdown', startBackgroundCropDrag);
  cropStage.addEventListener('pointermove', moveBackgroundCropDrag);
  cropStage.addEventListener('pointerup', endBackgroundCropDrag);
  cropStage.addEventListener('pointercancel', endBackgroundCropDrag);
  $('#theme-text-color').addEventListener('input', handleThemeTextColor);
  $('#theme-text-color').addEventListener('change', handleThemeTextColor);
  $('#reset-theme-text-color').addEventListener('click', resetThemeTextColor);
  $('#remove-background-image').addEventListener('click', removeBackgroundImage);
  bindBackgroundDropZone();
  $('#reset-background').addEventListener('click', resetBackground);

  window.addEventListener('beforeinstallprompt', event => {
    event.preventDefault();
    deferredInstallPrompt = event;
    $('#install-button').hidden = false;
  });
  $('#install-button').addEventListener('click', async () => {
    if (!deferredInstallPrompt) return;
    await deferredInstallPrompt.prompt();
    deferredInstallPrompt = null;
    $('#install-button').hidden = true;
  });
}

function renderRoute(route, maintainFocus = false) {
  if (!routeMeta[route]) route = 'today';
  state.route = route;
  $$('.view').forEach(view => { view.hidden = view.id !== `view-${route}`; });
  $$('.nav-button').forEach(button => {
    const active = button.dataset.route === route;
    button.classList.toggle('is-active', active);
    if (active) button.setAttribute('aria-current', 'page');
    else button.removeAttribute('aria-current');
  });
  $('#page-kicker').textContent = routeMeta[route].kicker;
  $('#page-title').textContent = routeMeta[route].title;
  $('#date-switcher').hidden = !['today', 'workout'].includes(route);

  if (route === 'today') renderToday();
  if (route === 'workout') renderWorkout();
  if (route === 'history') renderHistory();
  if (route === 'foods') renderFoodList();
  if (route === 'profile') renderProfile();
  if (route === 'appearance') renderAppearance();
  if (maintainFocus) $('#main-content').focus({ preventScroll: true });
}

function formatCalorieDifference(value) {
  if (value === null || !Number.isFinite(Number(value))) return '—';
  const numeric = Number(value);
  return `${numeric > 0 ? '+' : ''}${formatNumber(numeric, 0)} kcal`;
}
function macroCalories(targets) {
  return Number(targets?.carbs || 0) * 4 + Number(targets?.protein || 0) * 4 + Number(targets?.fat || 0) * 9;
}
function getMacroTargetsForProfile(profile, weightKg, calorieTarget) {
  if (!profile) return null;
  if (profile.macroTargetMode === 'weight') {
    if (!(weightKg > 0)) return null;
    const multipliers = profile.macroMultipliers || {};
    return {
      carbs: weightKg * Number(multipliers.carbs || 0),
      protein: weightKg * Number(multipliers.protein || 0),
      fat: weightKg * Number(multipliers.fat || 0)
    };
  }
  return calorieTarget ? calculateMacroTargets(calorieTarget, profile.macroRatios) : null;
}
function renderToday() {
  const entries = entriesForDate(state.selectedDate);
  const totals = sumEntries(entries);
  const weightKg = latestWeight()?.weightKg;
  const metabolism = getMetabolism(state.profile, weightKg);
  const manualGoal = Number(state.profile?.maintenanceCalories) > 0 ? Number(state.profile.maintenanceCalories) : null;
  const macroTargets = getMacroTargetsForProfile(state.profile, weightKg, manualGoal);
  const goal = state.profile?.macroTargetMode === 'weight' && macroTargets ? macroCalories(macroTargets) : manualGoal;
  updateDateControls();
  updateDailyDashboard({ totals, goal, macroTargets, metabolism });
  renderMeals(entries);
}

function formatWorkoutNumber(value, digits = 1) {
  return formatNumber(value, digits).replace(/\.?0+$/, '');
}
function renderWorkout() {
  const workouts = state.workouts.filter(item => item.date === state.selectedDate);
  $('#workout-date-label').textContent = `${state.selectedDate === todayKey ? '今天 · ' : ''}${formatDateLabel(state.selectedDate)}`;
  $('#workout-today-list').innerHTML = workouts.length
    ? renderWorkoutTypeSections(groupWorkouts(workouts))
    : '<p class="empty-inline">今天还没有训练记录，先添加一项训练。</p>';
  renderWorkoutHistory();
  renderWorkoutNames();
  updateWorkoutFormFields();
}

function renderWorkoutNames() {
  const names = Array.isArray(state.settings.workoutNames) ? state.settings.workoutNames : [];
  $('#workout-name-list').innerHTML = names.length
    ? names.map(name => `<span class="workout-name-chip"><button type="button" data-workout-name="${escapeHtml(name)}">${escapeHtml(name)}</button><button type="button" class="workout-name-delete" data-delete-workout-name="${escapeHtml(name)}" aria-label="删除名称 ${escapeHtml(name)}">×</button></span>`).join('')
    : '<small>添加训练后会在这里记住名称</small>';
}

function groupWorkouts(workouts) {
  const groups = new Map();
  workouts.forEach(workout => {
    const key = `${workout.type}::${workout.name}`;
    if (!groups.has(key)) groups.set(key, { key, name: workout.name, type: workout.type, items: [] });
    groups.get(key).items.push(workout);
  });
  return [...groups.values()];
}

function renderWorkoutTypeSections(groups, compact = false) {
  return [
    { type: 'strength', label: '力量训练' },
    { type: 'cardio', label: '有氧训练' },
    { type: 'rest', label: '休息日' }
  ].map(section => {
    const sectionGroups = groups.filter(group => group.type === section.type);
    if (!sectionGroups.length) return '';
    if (section.type === 'rest') {
      const restWorkout = sectionGroups[0].items[0];
      return `<section class="rest-day-display" data-workout-type="rest"><strong>休息日</strong><button class="icon-button danger-icon" type="button" data-delete-workout="${escapeHtml(restWorkout.id)}" aria-label="删除休息日记录"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 7h14M9 7V4h6v3m2 0-1 13H8L7 7"/></svg></button></section>`;
    }
    return `<section class="workout-type-section" data-workout-type="${section.type}">
      <header><h3>${section.label}</h3><span>${sectionGroups.reduce((sum, group) => sum + group.items.length, 0)} 条</span></header>
      <div class="workout-type-groups">${sectionGroups.map(group => workoutGroupMarkup(group, compact)).join('')}</div>
    </section>`;
  }).join('');
}
function workoutGroupMarkup(group, compact = false) {
  return `
    <article class="workout-group${compact ? ' compact' : ''}" data-workout-key="${escapeHtml(group.key)}">
      <header>
        <h4>${escapeHtml(group.name)}</h4>
        <span>${group.items.length} 条</span>
      </header>
      <div class="workout-set-list">
        ${group.items.map((workout, index) => {
          const weightText = workout.weightExpression || formatWorkoutNumber(workout.weightKg);
          const repsText = workout.repsExpression || formatNumber(workout.reps, 0);
          const detail = workout.type === 'strength'
            ? `${weightText}kg　${formatNumber(workout.sets, 0)}组 × ${repsText}次`
            : workout.type === 'cardio'
              ? `${formatWorkoutNumber(workout.durationMinutes)}分钟`
              : '休息与恢复';
          return `<div class="workout-set-row"><span class="workout-set-index">第${index + 1}组</span><strong>${detail}</strong><button class="icon-button danger-icon" type="button" data-delete-workout="${escapeHtml(workout.id)}" aria-label="删除 ${escapeHtml(workout.name)} 记录"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 7h14M9 7V4h6v3m2 0-1 13H8L7 7m3 4v5m4-5v5"/></svg></button></div>`;
        }).join('')}
      </div>
    </article>`;
}

function renderWorkoutHistory() {
  const range = new Set(createDateRange(todayKey, 30));
  const recent = state.workouts.filter(item => range.has(item.date)).sort((first, second) => second.date.localeCompare(first.date) || String(first.createdAt).localeCompare(String(second.createdAt)));
  const grouped = new Map();
  recent.forEach(item => {
    if (!grouped.has(item.date)) grouped.set(item.date, []);
    grouped.get(item.date).push(item);
  });
  const dates = [...grouped.keys()].sort((a, b) => b.localeCompare(a));
  $('#workout-history-list').innerHTML = dates.length ? dates.map(date => {
    const items = grouped.get(date);
    const strength = items.filter(item => item.type === 'strength');
    const cardio = items.filter(item => item.type === 'cardio');
    const rest = items.filter(item => item.type === 'rest');
    const summary = [
      strength.length ? `${strength.reduce((sum, item) => sum + Number(item.sets || 0), 0)} 组力量` : '',
      cardio.length ? `${formatNumber(cardio.reduce((sum, item) => sum + Number(item.durationMinutes || 0), 0), 0)} 分钟有氧` : ''
    ].filter(Boolean).join(' · ');
    return `<section class="workout-history-day" data-date="${escapeHtml(date)}"><header><strong>${formatDateLabel(date)}</strong><span>${summary}</span></header>${renderWorkoutTypeSections(groupWorkouts(items), true)}</section>`;
  }).join('') : '<p class="empty-inline">近 30 天还没有训练记录。</p>';
}
function updateWorkoutFormFields() {
  const type = $('#workout-type').value;
  const isStrength = type === 'strength';
  const isCardio = type === 'cardio';
  const isRest = type === 'rest';
  $('#workout-name-field').hidden = isRest;
  $('#workout-strength-fields').hidden = !isStrength;
  $('#workout-cardio-fields').hidden = !isCardio;
  $('#workout-name').required = !isRest;
  $('#workout-weight').required = isStrength;
  $('#workout-sets').required = isStrength;
  $('#workout-reps').required = isStrength;
  $('#workout-minutes').required = isCardio;
  $('#workout-submit-button').textContent = isRest ? '记录为休息日' : '添加到今日训练';
}

function parseWorkoutExpression(value, allowZero = false) {
  const text = String(value ?? '').trim().replaceAll('＋', '+').replace(/\s+/g, '');
  if (!/^\d+(?:\.\d+)?(?:\+\d+(?:\.\d+)?)*$/.test(text)) return { valid: false };
  const parts = text.split('+').map(Number);
  const total = parts.reduce((sum, part) => sum + part, 0);
  if (parts.some(part => !Number.isFinite(part) || part < 0) || (!allowZero && total <= 0)) return { valid: false };
  return { valid: true, text, total };
}
async function handleWorkoutSubmit(event) {
  event.preventDefault();
  const type = $('#workout-type').value;
  if (type === 'rest') {
    if (state.workouts.some(item => item.date === state.selectedDate && item.type === 'rest')) {
      showToast('今天已经记录为休息日');
      return;
    }
    const restRecord = await store.saveWorkout({ date: state.selectedDate, type: 'rest', name: '休息日' });
    state.workouts.push(restRecord);
    $('#workout-form').reset();
    $('#workout-sets').value = 1;
    $('#workout-type').value = 'rest';
    renderWorkout();
    showToast('已记录为休息日');
    return;
  }
  const name = $('#workout-name').value.trim();
  if (!name) return setFormError('#workout-form-error', '请输入运动名称。');
  let workout;
  if (type === 'strength') {
    const weight = parseWorkoutExpression($('#workout-weight').value, true);
    const reps = parseWorkoutExpression($('#workout-reps').value);
    const sets = Number($('#workout-sets').value);
    if (!weight.valid || !reps.valid || !(sets > 0)) return setFormError('#workout-form-error', '重量和每组个数可使用“10+5”格式，组数必须大于 0。');
    workout = {
      date: state.selectedDate,
      type,
      name,
      weightKg: weight.total,
      weightExpression: weight.text,
      sets,
      reps: reps.total,
      repsExpression: reps.text
    };
  } else {
    const durationMinutes = Number($('#workout-minutes').value);
    if (!(durationMinutes > 0)) return setFormError('#workout-form-error', '请输入有效的有氧运动时长。');
    workout = { date: state.selectedDate, type, name, durationMinutes };
  }
  const saved = await store.saveWorkout(workout);
  state.workouts.push(saved);
  const names = Array.isArray(state.settings.workoutNames) ? state.settings.workoutNames : [];
  if (!names.includes(name)) {
    state.settings.workoutNames = [...names, name];
    state.settings = await store.saveSettings(state.settings);
  }
  $('#workout-form').reset();
  $('#workout-sets').value = 1;
  $('#workout-type').value = type;
  setFormError('#workout-form-error', '');
  renderWorkout();
  showToast(`${name} 已添加到训练记录`);
}
function updateDateControls() {
  const isToday = state.selectedDate === todayKey;
  $('#date-label').textContent = isToday ? `今天 · ${formatDateLabel(todayKey)}` : formatDateLabel(state.selectedDate);
  $('#date-next').disabled = state.selectedDate >= todayKey;
  $('#brief-date').textContent = isToday ? '今天' : formatDateLabel(state.selectedDate);
}

function updateDailyDashboard({ totals, goal, macroTargets, metabolism }) {
  $('#today-kcal').textContent = formatNumber(totals.kcal, 0);
  $('#summary-goal').textContent = goal ? `${formatNumber(goal, 0)} kcal` : '—';
  const remaining = goal ? goal - totals.kcal : null;
  $('#summary-remaining').textContent = remaining === null ? '—' : `${formatNumber(remaining, 0)} kcal`;
  const theoreticalSurplus = metabolism.complete && goal ? goal - metabolism.tdee : null;
  $('#summary-theoretical-surplus').textContent = formatCalorieDifference(theoreticalSurplus);
  const calorieRatio = goal ? totals.kcal / goal : 0;
  $('#calorie-progress-bar').style.width = `${clamp(calorieRatio * 100, 0, 100)}%`;

  const macroMap = [
    ['carbs', '#plate-carbs-total', '#plate-carbs-bar', '#plate-carbs-percent'],
    ['protein', '#plate-protein-total', '#plate-protein-bar', '#plate-protein-percent'],
    ['fat', '#plate-fat-total', '#plate-fat-bar', '#plate-fat-percent']
  ];
  for (const [key, totalSelector, barSelector, percentSelector] of macroMap) {
    const target = macroTargets?.[key] ?? null;
    const value = totals[key] || 0;
    const ratio = target ? value / target : 0;
    $(totalSelector).textContent = `${formatNumber(value, 1)} / ${target ? formatNumber(target, 0) : '—'} g`;
    $(barSelector).style.width = `${clamp(ratio * 100, 0, 100)}%`;
    $(percentSelector).textContent = target ? `${formatNumber(ratio * 100, 0)}%` : '—';
  }

  const optionalNutrients = [
    { key: 'fiber', target: 25, unit: 'g', digits: 1 },
    { key: 'sodium', target: 2000, unit: 'mg', digits: 0 },
    { key: 'potassium', target: 3510, unit: 'mg', digits: 0 }
  ];
  for (const item of optionalNutrients) {
    const visible = Boolean(state.settings.nutrientVisibility?.[item.key]);
    const row = $(`[data-nutrient-row="${item.key}"]`);
    row.hidden = !visible;
    const input = $(`#nutrient-toggle-${item.key}`);
    if (input) input.checked = visible;
    if (!visible) continue;
    const value = totals[item.key] || 0;
    const ratio = item.target ? value / item.target : 0;
    $(`#nutrient-${item.key}-total`).textContent = `${formatNumber(value, item.digits)} / ${formatNumber(item.target, 0)} ${item.unit}`;
    $(`#nutrient-${item.key}-bar`).style.width = `${clamp(ratio * 100, 0, 100)}%`;
    $(`#nutrient-${item.key}-percent`).textContent = `${formatNumber(ratio * 100, 0)}%`;
  }
  const status = $('#goal-status');
  if (!metabolism.complete) {
    status.textContent = '等待资料';
    status.dataset.state = 'pending';
  } else if (totals.kcal === 0) {
    status.textContent = '尚未记录';
    status.dataset.state = 'idle';
  } else {
    const progress = totals.kcal / goal;
    status.textContent = progress > 1.1 ? `高于目标 ${formatNumber((progress - 1) * 100, 0)}%` : `完成 ${formatNumber(progress * 100, 0)}%`;
    status.dataset.state = progress > 1.1 ? 'over' : 'good';
  }
  $('#profile-hint').hidden = metabolism.complete;
}
async function handleOptionalNutrientToggle(event) {
  const key = event.target.dataset.nutrientToggle;
  state.settings.nutrientVisibility = {
    ...(state.settings.nutrientVisibility || {}),
    [key]: event.target.checked
  };
  state.settings = await store.saveSettings(state.settings);
  renderToday();
}
function renderMeals(entries) {
  const groups = groupEntriesByMeal(entries);
  $('#meal-grid').innerHTML = groups.map(group => `
    <article class="meal-block" data-meal="${group.meal}">
      <header>
        <div>
          <span class="meal-name">${group.label}</span>
          <strong data-meal-total="${group.meal}">${formatNumber(group.totals.kcal, 0)} kcal</strong>
        </div>
        <button class="icon-button" type="button" data-add-meal="${group.meal}" aria-label="向${group.label}添加食物">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>
        </button>
      </header>
      ${group.entries.length ? `<ul class="meal-entry-list">${group.entries.map(entry => `
        <li>
          <div class="entry-main"><strong>${escapeHtml(entry.foodSnapshot?.name || '未知食物')}</strong><span>${entry.unit === 'serving' && entry.servingGrams ? `${formatServingAmount(entry.amount, entry.servingLabel)}（${formatNumber(entry.grams, 0)}g）` : `${formatNumber(entry.grams, 0)}g`} · ${escapeHtml(entry.foodSnapshot?.state || '')}</span></div>
          <div class="entry-nutrition"><strong>${formatNumber(entry.nutrients.kcal, 0)} kcal</strong><span>碳 ${formatNumber(entry.nutrients.carbs, 1)} · 蛋 ${formatNumber(entry.nutrients.protein, 1)} · 脂 ${formatNumber(entry.nutrients.fat, 1)}</span></div>
          <button class="icon-button danger-icon" type="button" data-delete-entry="${entry.id}" aria-label="删除 ${escapeHtml(entry.foodSnapshot?.name || '食物')} 记录"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 7h14M9 7V4h6v3m2 0-1 13H8L7 7m3 4v5m4-5v5"/></svg></button>
        </li>`).join('')}</ul>` : `
        <button class="empty-meal" type="button" data-add-meal="${group.meal}">
          <span>还没有记录</span>
          <small>添加${group.label}</small>
        </button>`}
    </article>
  `).join('');
}function renderFoodList() {
  populateFoodCategories();
  const query = $('#food-search').value.trim();
  const category = $('#food-category-filter').value;
  const source = $('#food-source-filter').value;
  let foods = query ? searchFoods(state.foods, query, 200) : state.foods;
  if (category) foods = foods.filter(food => food.category === category);
  if (source === 'custom') foods = foods.filter(food => food.custom);
  if (source === 'builtin') foods = foods.filter(food => !food.custom);
  $('#food-count').textContent = `${foods.length} 项食物`;
  $('#food-list').innerHTML = foods.length ? foods.map(food => `
    <article class="food-item" data-food-id="${escapeHtml(food.id)}">
      <div class="food-identity">
        <span class="food-chip">${escapeHtml(food.category)}</span>
        <div class="food-copy">
          <div class="food-title-line">
            <h3>${escapeHtml(food.name)}</h3>
            <strong class="food-kcal">${formatNumber(food.per100g.kcal, 0)} kcal</strong>
          </div>
          <p class="food-meta">${escapeHtml(food.state)} · ${food.custom ? '我的食物' : '内置参考值'}${food.servingGrams ? ` · ${escapeHtml(food.servingLabel || '1份')} = ${formatNumber(food.servingGrams, 1)}g` : ''}</p>
          <p class="food-macros">每 100g：碳 ${formatNumber(food.per100g.carbs, 1)} · 蛋 ${formatNumber(food.per100g.protein, 1)} · 脂 ${formatNumber(food.per100g.fat, 1)} · 纤 ${formatNumber(food.per100g.fiber || 0, 1)} · 钠 ${formatNumber(food.per100g.sodium || 0, 1)} · 钾 ${formatNumber(food.per100g.potassium || 0, 1)}</p>
        </div>
      </div>
      <div class="food-actions">
        ${food.custom
          ? `<button class="quiet-button" type="button" data-edit-food="${escapeHtml(food.id)}">编辑</button><button class="danger-text-button" type="button" data-delete-food="${escapeHtml(food.id)}">删除</button>`
          : `<button class="quiet-button" type="button" data-copy-food="${escapeHtml(food.id)}">复制并编辑</button>`}
      </div>
    </article>
  `).join('') : `<div class="empty-state"><strong>没有找到匹配食物</strong><p>调整搜索条件，或添加你的常吃食物。</p><button class="primary-button" type="button" data-open-food-dialog>添加食物</button></div>`;
}

function populateFoodCategories() {
  const select = $('#food-category-filter');
  const current = select.value;
  const categories = [...new Set(state.foods.map(food => food.category))].sort((a, b) => a.localeCompare(b, 'zh-CN'));
  select.innerHTML = `<option value="">全部分类</option>${categories.map(category => `<option value="${escapeHtml(category)}">${escapeHtml(category)}</option>`).join('')}`;
  if (categories.includes(current)) select.value = current;
}

function openFoodDialog(food = null) {
  $('#food-form').reset();
  $('#food-id').value = food?.id || '';
  $('#food-name').value = food?.name || '';
  $('#food-category').value = food?.category || '主食';
  $('#food-state').value = food?.state || '可食部';
  $('#food-aliases').value = (food?.aliases || []).filter(alias => !/^[a-z]+$/i.test(alias)).join('，');
  $('#food-serving-label').value = food?.servingLabel || '1份';
  $('#food-serving-grams').value = food?.servingGrams ?? '';
  $('#food-energy-unit').value = 'kcal';
  $('#food-energy-unit').dataset.previousUnit = 'kcal';
  $('#food-kcal').value = food?.per100g.kcal ?? '';
  renderFoodEnergyConversion();
  $('#food-carbs').value = food?.per100g.carbs ?? '';
  $('#food-protein').value = food?.per100g.protein ?? '';
  $('#food-fat').value = food?.per100g.fat ?? '';
  $('#food-fiber').value = food?.per100g.fiber ?? '';
  $('#food-sodium').value = food?.per100g.sodium ?? '';
  $('#food-potassium').value = food?.per100g.potassium ?? '';
  $('#food-dialog-title').textContent = food ? '复制并编辑食物' : '添加食物';
  setFormError('#food-form-error', '');
  openDialog('#food-dialog');
  setTimeout(() => $('#food-name').focus(), 0);
}

function convertFoodEnergy(value, fromUnit, toUnit) {
  if (!Number.isFinite(value)) return null;
  if (fromUnit === toUnit) return value;
  return fromUnit === 'kJ' ? value / 4.184 : value * 4.184;
}

function renderFoodEnergyConversion() {
  const value = Number($('#food-kcal').value);
  const unit = $('#food-energy-unit').value;
  if (!Number.isFinite(value) || value < 0) {
    $('#food-kcal-converted').textContent = '';
    return;
  }
  $('#food-kcal-converted').textContent = unit === 'kJ'
    ? `≈ ${formatNumber(value / 4.184, 1)} kcal / 100g`
    : '按 kcal / 100g 保存';
}

function handleFoodEnergyUnitChange() {
  const select = $('#food-energy-unit');
  const previousUnit = select.dataset.previousUnit || 'kcal';
  const nextUnit = select.value;
  const currentValue = Number($('#food-kcal').value);
  if (previousUnit !== nextUnit && Number.isFinite(currentValue)) {
    $('#food-kcal').value = formatNumber(convertFoodEnergy(currentValue, previousUnit, nextUnit), 2).replaceAll(',', '');
  }
  select.dataset.previousUnit = nextUnit;
  renderFoodEnergyConversion();
}
async function handleFoodSubmit(event) {
  event.preventDefault();
  const name = $('#food-name').value.trim();
  const enteredEnergy = Number($('#food-kcal').value);
  const energyUnit = $('#food-energy-unit').value;
  const nutrients = {
    kcal: energyUnit === 'kJ' ? enteredEnergy / 4.184 : enteredEnergy,
    carbs: Number($('#food-carbs').value),
    protein: Number($('#food-protein').value),
    fat: Number($('#food-fat').value),
    fiber: Number($('#food-fiber').value) || 0,
    sodium: Number($('#food-sodium').value) || 0,
    potassium: Number($('#food-potassium').value) || 0
  };
  if (!name) return setFormError('#food-form-error', '请输入食物名称。');
  if (Object.values(nutrients).some(value => !Number.isFinite(value) || value < 0)) {
    return setFormError('#food-form-error', '营养值必须是大于或等于 0 的数字。');
  }
  const servingLabel = $('#food-serving-label').value.trim() || '1份';
  const servingGrams = Number($('#food-serving-grams').value);
  if ($('#food-serving-grams').value.trim() && !(servingGrams > 0)) {
    return setFormError('#food-form-error', '一份重量必须大于 0g。');
  }
  const existingId = $('#food-id').value;
  await store.saveFood({
    id: existingId || undefined,
    name,
    category: $('#food-category').value,
    state: $('#food-state').value,
    aliases: $('#food-aliases').value.split(/[，,]/).map(value => value.trim()).filter(Boolean),
    servingLabel,
    servingGrams: servingGrams > 0 ? servingGrams : null,
    per100g: nutrients,
    custom: true,
    source: '用户自定义'
  });
  state.foods = await store.getFoods();
  populateFoodCategories();
  renderFoodList();
  closeDialog('#food-dialog');
  showToast(existingId ? '食物已更新' : '食物已添加到食物库');
}

function openEntryDialog(meal) {
  state.selectedEntryFood = null;
  $('#entry-form').reset();
  $('#entry-date').value = state.selectedDate;
  $('#entry-meal').value = meal;
  const mealLabel = MEALS.find(item => item.id === meal)?.label || '餐次';
  $('#entry-dialog-kicker').textContent = mealLabel;
  $('#entry-food-search').value = '';
  $('#entry-unit').value = 'grams';
  $('#entry-amount').value = '';
  updateEntryUnitControl();
  renderEntryFoodResults('');
  renderEntryPreview();
  setFormError('#entry-form-error', '');
  openDialog('#entry-dialog');
  setTimeout(() => $('#entry-food-search').focus(), 0);
}

function handleEntryUnitChange() {
  updateEntryUnitControl();
  renderEntryPreview();
}

function updateEntryUnitControl() {
  const food = state.selectedEntryFood;
  const servingOption = $('#entry-unit').querySelector('option[value="serving"]');
  servingOption.disabled = !food?.servingGrams;
  if (!food?.servingGrams && $('#entry-unit').value === 'serving') $('#entry-unit').value = 'grams';
  $('#entry-amount-label').textContent = $('#entry-unit').value === 'serving' ? '份数' : '重量（g）';
}

function entryAmountInGrams(amount, food = state.selectedEntryFood) {
  if (!food) return 0;
  return $('#entry-unit').value === 'serving' && food.servingGrams ? amount * food.servingGrams : amount;
}

function formatServingAmount(amount, label) {
  const unitName = String(label || '1份').replace(/^1/, '');
  const formattedAmount = formatNumber(amount, 2).replace(/\.?0+$/, '');
  return `${formattedAmount}${unitName}`;
}
function renderEntryFoodResults(query) {
  const history = Array.isArray(state.settings.foodSearchHistory) ? state.settings.foodSearchHistory : [];
  const historyRank = new Map(history.map((item, index) => [item.foodId, index]));
  let foods = query ? searchFoods(state.foods, query, 50) : [...state.foods];
  foods.sort((first, second) => {
    const firstRank = historyRank.has(first.id) ? historyRank.get(first.id) : Number.POSITIVE_INFINITY;
    const secondRank = historyRank.has(second.id) ? historyRank.get(second.id) : Number.POSITIVE_INFINITY;
    if (firstRank !== secondRank) return firstRank - secondRank;
    return first.name.localeCompare(second.name, 'zh-CN');
  });
  foods = foods.slice(0, 12);
  if (!foods.length) {
    $('#entry-food-results').innerHTML = '<p class="empty-inline">没有匹配食物，请先到食物库添加。</p>';
    return;
  }
  $('#entry-food-results').innerHTML = foods.map(food => `
    <button type="button" class="entry-food-option" role="option" data-entry-food-id="${escapeHtml(food.id)}">
      <span class="entry-food-main">
        <span class="entry-food-title">
          <strong>${escapeHtml(food.name)}</strong>
          <em>${formatNumber(food.per100g.kcal, 0)} kcal / 100g</em>
        </span>
        <small>${escapeHtml(food.state)} · ${escapeHtml(food.category)}${food.servingGrams ? ` · ${escapeHtml(food.servingLabel || '1份')} = ${formatNumber(food.servingGrams, 1)}g` : ''}</small>
      </span>
    </button>
  `).join('');
}

async function rememberFoodSearch(foodId) {
  const history = Array.isArray(state.settings.foodSearchHistory) ? state.settings.foodSearchHistory : [];
  state.settings.foodSearchHistory = [
    { foodId, searchedAt: new Date().toISOString() },
    ...history.filter(item => item.foodId !== foodId)
  ].slice(0, 30);
  state.settings = await store.saveSettings(state.settings);
}

async function selectEntryFood(id) {
  const food = state.foods.find(item => item.id === id);
  if (!food) return;
  state.selectedEntryFood = food;
  await rememberFoodSearch(id);
  $('#entry-food-results').innerHTML = '';
  updateEntryUnitControl();
  $('#entry-amount').focus();
  renderEntryPreview();
}
function renderEntryPreview() {
  const amount = Number($('#entry-amount').value) || 0;
  const grams = entryAmountInGrams(amount);
  const nutrients = state.selectedEntryFood
    ? scaleNutrition(state.selectedEntryFood.per100g, grams)
    : { kcal: 0, carbs: 0, protein: 0, fat: 0 };
  const usingServing = $('#entry-unit').value === 'serving' && state.selectedEntryFood?.servingGrams;
  $('#entry-preview').innerHTML = `
    ${usingServing ? `<p class="entry-serving-equivalent">${formatServingAmount(amount, state.selectedEntryFood.servingLabel)} ≈ ${formatNumber(grams, 1)}g</p>` : ''}
    <span>热量 <strong>${formatNumber(nutrients.kcal, 0)} kcal</strong></span>
    <span>碳水 <strong>${formatNumber(nutrients.carbs, 1)} g</strong></span>
    <span>蛋白质 <strong>${formatNumber(nutrients.protein, 1)} g</strong></span>
    <span>脂肪 <strong>${formatNumber(nutrients.fat, 1)} g</strong></span>`;
}

async function handleEntrySubmit(event) {
  event.preventDefault();
  const amount = Number($('#entry-amount').value);
  const unit = $('#entry-unit').value;
  if (!state.selectedEntryFood) return setFormError('#entry-form-error', '请先选择食物。');
  if (!(amount > 0)) return setFormError('#entry-form-error', unit === 'serving' ? '份数必须大于 0。' : '重量必须大于 0g。');
  if (unit === 'serving' && !state.selectedEntryFood.servingGrams) return setFormError('#entry-form-error', '该食物尚未设置一份重量。');
  const grams = entryAmountInGrams(amount);
  const record = await store.addEntry({
    date: $('#entry-date').value || state.selectedDate,
    meal: $('#entry-meal').value,
    foodId: state.selectedEntryFood.id,
    grams,
    amount,
    unit,
    servingLabel: unit === 'serving' ? state.selectedEntryFood.servingLabel : null,
    servingGrams: unit === 'serving' ? state.selectedEntryFood.servingGrams : null
  });
  state.allEntries.push(record);
  closeDialog('#entry-dialog');
  showToast(`已添加 ${state.selectedEntryFood.name} ${formatNumber(grams, 0)}g`);
  renderToday();
}function renderProfile() {
  syncProfileForm();
  renderMetabolism();
  renderWeightList();
}

function syncProfileForm() {
  const profile = state.profile || {};
  $('#profile-sex').value = profile.sex || 'female';
  $('#profile-age').value = profile.age ?? '';
  $('#profile-height').value = profile.heightCm ?? '';
  $('#profile-weight').value = latestWeight()?.weightKg ?? '';
  $('#profile-activity-multiplier').value = profile.activityMultiplierOverride ?? profile.activityMultiplier ?? 1.2;  $('#profile-maintenance-calories').value = profile.maintenanceCalories ?? '';
  const ratios = profile.macroRatios || { carbs: 45, protein: 25, fat: 30 };
  $('#macro-carbs').value = ratios.carbs;
  $('#macro-protein').value = ratios.protein;
  $('#macro-fat').value = ratios.fat;
  const multipliers = profile.macroMultipliers || { carbs: 1.5, protein: 1.5, fat: 1 };
  $('#macro-target-mode').value = profile.macroTargetMode || 'ratio';
  $('#macro-carbs-multiplier').value = multipliers.carbs;
  $('#macro-protein-multiplier').value = multipliers.protein;
  $('#macro-fat-multiplier').value = multipliers.fat;
  updateMacroOutputs();
}
function handleProfileInput(event) {
  if (event.target.id?.startsWith('macro-')) updateMacroOutputs();
  renderMetabolism(readProfileForm(false));
}

function updateMacroOutputs() {
  const mode = $('#macro-target-mode').value;
  $('#macro-ratio-fields').hidden = mode !== 'ratio';
  $('#macro-weight-fields').hidden = mode !== 'weight';
  const ratios = readMacroRatios();
  const validation = validateMacroRatios(ratios);
  $('#macro-ratio-total').textContent = `${formatNumber(validation.total, 0)}%`;
  $('#macro-ratio-total').dataset.valid = String(validation.valid);
  setFormError('#macro-ratio-error', mode === 'ratio' && !validation.valid ? validation.message : '');
  return ratios;
}

function readMacroRatios() {
  return {
    carbs: Number($('#macro-carbs').value),
    protein: Number($('#macro-protein').value),
    fat: Number($('#macro-fat').value)
  };
}

function readProfileForm(includeWeight = true) {
  const age = Number($('#profile-age').value);
  const heightCm = Number($('#profile-height').value);
  const weightKg = includeWeight ? Number($('#profile-weight').value) : latestWeight()?.weightKg;
  const activityMultiplier = Number($('#profile-activity-multiplier').value);
  const macroTargetMode = $('#macro-target-mode').value;
  return {
    sex: $('#profile-sex').value,
    age: Number.isFinite(age) && age > 0 ? age : null,
    heightCm: Number.isFinite(heightCm) && heightCm > 0 ? heightCm : null,
    weightKg: Number.isFinite(weightKg) && weightKg > 0 ? weightKg : null,
    activityMultiplierOverride: Number.isFinite(activityMultiplier) ? clamp(activityMultiplier, 1.2, 2.1) : 1.2,    macroTargetMode,
    macroMultipliers: {
      carbs: Number($('#macro-carbs-multiplier').value),
      protein: Number($('#macro-protein-multiplier').value),
      fat: Number($('#macro-fat-multiplier').value)
    },
    macroRatios: readMacroRatios()
  };
}
async function handleProfileSubmit(event) {
  event.preventDefault();
  const profile = readProfileForm();
  const validation = validateMacroRatios(profile.macroRatios);
  const invalidMultipliers = Object.values(profile.macroMultipliers).some(value => !Number.isFinite(value) || value <= 0);
  if (!profile.age || !profile.heightCm || !profile.weightKg) {
    return showToast('请补全年龄、身高和体重。', 'error');
  }
  if (profile.macroTargetMode === 'ratio' && !validation.valid) return setFormError('#macro-ratio-error', validation.message);
  if (profile.macroTargetMode === 'weight' && invalidMultipliers) return setFormError('#macro-ratio-error', '请填写有效的体重倍数。');
  const { weightKg, ...profileData } = profile;
  profileData.maintenanceCalories = state.profile?.maintenanceCalories ?? null;
  state.profile = await store.saveProfile(profileData);
  const weightDate = todayKey;
  await store.saveWeight({ id: `weight-${weightDate}`, date: weightDate, weightKg });
  state.weights = await store.getWeights();
  renderProfile();
  renderToday();
  showToast('个人资料、目标热量与体重已保存');
}

function syncWeightForm() {
  $('#weight-date').max = todayKey;
  if (!$('#weight-date').value) $('#weight-date').value = todayKey;
  if (!$('#weight-value').value) $('#weight-value').value = latestWeight()?.weightKg ?? '';
}

async function handleMaintenanceSubmit(event) {
  event.preventDefault();
  const input = Number($('#profile-maintenance-calories').value);
  const maintenanceCalories = Number.isFinite(input) && input > 0 ? input : null;
  state.profile = await store.saveProfile({ ...(state.profile || {}), maintenanceCalories });
  renderMetabolism();
  renderToday();
  showToast(maintenanceCalories ? '目标热量已保存' : '目标热量已清除');
}
async function handleWeightSubmit(event) {
  event.preventDefault();
  const date = $('#weight-date').value;
  const weightKg = Number($('#weight-value').value);
  if (!date || date > todayKey) return showToast('体重日期不能晚于今天。', 'error');
  if (!(weightKg > 0)) return showToast('请输入有效体重。', 'error');
  await store.saveWeight({ id: `weight-${date}-${Date.now()}`, date, weightKg });
  state.weights = await store.getWeights();
  syncProfileForm();
  renderMetabolism();
  renderWeightList();
  showToast('体重记录已保存');
}

function renderWeightList() {
  const weights = state.weights.slice(0, 6);
  $('#weight-list').innerHTML = weights.length ? `
    <div class="weight-list-heading"><strong>最近体重</strong><span>${state.weights.length} 条记录</span></div>
    <ul>${weights.map(item => `<li><span>${formatDateLabel(item.date)}</span><strong>${formatNumber(item.weightKg, 1)} kg</strong><button class="icon-button danger-icon" type="button" data-delete-weight="${escapeHtml(item.id)}" aria-label="删除 ${item.date} 体重记录"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 7h14M9 7V4h6v3m2 0-1 13H8L7 7"/></svg></button></li>`).join('')}</ul>
  ` : '<p class="empty-inline">还没有体重记录。</p>';
}

function renderMetabolism(profileOverride = null) {
  const profile = profileOverride || state.profile;
  const weight = profileOverride?.weightKg ?? latestWeight()?.weightKg;
  const metabolism = getMetabolism(profile, weight);
  $('#metric-bmr').textContent = metabolism.complete ? `${formatNumber(metabolism.bmr, 0)} kcal` : '—';
  $('#metric-tdee').textContent = metabolism.complete ? `${formatNumber(metabolism.tdee, 0)} kcal` : '—';
  const manualGoal = Number(profile?.maintenanceCalories);
  const macroTargets = getMacroTargetsForProfile(profile, weight, manualGoal);
  const displayGoal = profile?.macroTargetMode === 'weight' && macroTargets ? macroCalories(macroTargets) : manualGoal;
  $('#metric-goal').textContent = Number.isFinite(displayGoal) && displayGoal > 0 ? `${formatNumber(displayGoal, 0)} kcal` : '—';
  $('#activity-explanation').textContent = metabolism.complete
    ? `BMR × ${metabolism.multiplier.toFixed(2)} = ${formatNumber(metabolism.tdee, 0)} kcal；目标热量由你手动填写。`
    : '完善年龄、身高、体重和活动信息后显示估算依据。';
}

function getMetabolism(profile, weightKg) {
  if (!profile || !profile.age || !profile.heightCm || !profile.sex || !weightKg) return { complete: false };
  const bmr = calculateBmr({ sex: profile.sex, age: profile.age, heightCm: profile.heightCm, weightKg });
  const multiplier = calculateActivityMultiplier({
    manualOverride: profile.activityMultiplierOverride ?? profile.activityMultiplier ?? 1.2
  });
  return { complete: true, bmr, multiplier, tdee: calculateTdee(bmr, multiplier) };
}

function renderHistory() {
  const count = Number($('#history-range').value) || 30;
  const dates = createDateRange(todayKey, count);
  const entryMap = new Map(dates.map(date => [date, []]));
  state.allEntries.forEach(entry => {
    if (entryMap.has(entry.date)) entryMap.get(entry.date).push(entry);
  });
  const calories = dates.map(date => sumEntries(entryMap.get(date)).kcal);
  const labels = dates.map(date => `${Number(date.slice(5, 7))}/${Number(date.slice(8, 10))}`);
  const metabolism = getMetabolism(state.profile, latestWeight()?.weightKg);
  const target = metabolism.complete ? metabolism.tdee : null;
  $('#calorie-chart').innerHTML = lineChart({
    labels,
    values: calories,
    target,
    unit: 'kcal',
    color: 'var(--theme-chart-calories)',
    title: `${count} 天每日热量摄入`
  });
  const recorded = calories.filter(value => value > 0);
  $('#history-average-kcal').textContent = recorded.length
    ? `记录日均 ${formatNumber(recorded.reduce((sum, value) => sum + value, 0) / recorded.length, 0)} kcal`
    : '尚无记录';

  const rangeWeights = state.weights.filter(item => item.date >= dates[0] && item.date <= todayKey).reverse();
  if (rangeWeights.length) {
    $('#weight-chart').innerHTML = lineChart({
      labels: rangeWeights.map(item => `${Number(item.date.slice(5, 7))}/${Number(item.date.slice(8, 10))}`),
      values: rangeWeights.map(item => item.weightKg),
      target: null,
      unit: 'kg',
      color: 'var(--theme-chart-weight)',
      title: '体重趋势'
    });
  } else {
    $('#weight-chart').innerHTML = '<p class="chart-empty">还没有范围内的体重记录</p>';
  }
  const delta = rangeWeights.length > 1 ? rangeWeights.at(-1).weightKg - rangeWeights[0].weightKg : null;
  $('#history-weight-delta').textContent = delta === null ? '—' : `${delta > 0 ? '+' : ''}${formatNumber(delta, 1)} kg`;

  const weightMap = new Map(state.weights.map(item => [item.date, item.weightKg]));
  $('#history-table tbody').innerHTML = [...dates].reverse().map(date => {
    const totals = sumEntries(entryMap.get(date));
    return `<tr><td>${formatDateLabel(date)}</td><td>${formatNumber(totals.kcal, 0)} kcal</td><td>${formatNumber(totals.carbs, 1)} g</td><td>${formatNumber(totals.protein, 1)} g</td><td>${formatNumber(totals.fat, 1)} g</td><td>${weightMap.has(date) ? `${formatNumber(weightMap.get(date), 1)} kg` : '—'}</td></tr>`;
  }).join('');
}

function toggleHistoryTable() {
  const button = $('#toggle-history-data');
  const expanded = button.getAttribute('aria-expanded') === 'true';
  button.setAttribute('aria-expanded', String(!expanded));
  button.textContent = expanded ? '查看数据表' : '收起数据表';
  $('#history-table-wrap').hidden = expanded;
}function renderAppearance() {
  syncBackgroundForm();
  applyBackground(state.settings);
}

function syncBackgroundForm() {
  const background = state.settings.background || DEFAULT_SETTINGS.background;
  $('#background-type').value = background.type;
  $('#background-color').value = background.color || '#eef6f0';
  $('#gradient-from').value = background.gradientFrom || '#eef6f0';
  $('#gradient-to').value = background.gradientTo || '#b8dfc8';
  $('#background-preset').value = background.preset || 'dawn';
  $('#background-blur').value = background.blur ?? 0;
  $('#background-dim').value = background.dim ?? 10;
  $('#panel-opacity').value = Math.round(getEffectivePanelOpacity(background) * 100);
  const hasImage = Boolean(background.imageData);
  $('#background-image-preview').hidden = !hasImage;
  $('#background-image-thumbnail').style.backgroundImage = hasImage ? `url("${background.imageData}")` : 'none';
  if (hasImage) {
    const cropStyle = calculateBackgroundCropStyle(getActiveBackgroundImage(background)?.crop || background.crop);
    $('#background-image-thumbnail').style.backgroundSize = cropStyle.backgroundSize;
    $('#background-image-thumbnail').style.backgroundPosition = cropStyle.backgroundPosition;
  }
  $('#background-image-name').textContent = background.imageName || '已保存在当前浏览器';
  $('#background-image-drop').classList.toggle('has-image', hasImage);
  renderBackgroundLibrary(background);
  syncThemeControls(background);
  updateBackgroundControlVisibility(background.type);
  updateRangeOutputs();
}

function updateBackgroundControlVisibility(type) {
  $('#solid-controls').hidden = type !== 'solid';
  $('#gradient-controls').hidden = type !== 'gradient';
  $('#preset-controls').hidden = type !== 'preset';
  $('#image-controls').hidden = false;
}

function getActiveBackgroundImage(background = state.settings.background) {
  if (!background || background.type !== 'image' || !background.imageId) return null;
  return (background.images || []).find(image => image.id === background.imageId) || null;
}

function getEffectivePanelOpacity(background = state.settings.background) {
  const image = getActiveBackgroundImage(background);
  if (background?.type === 'image' && image) {
    return image.userPanelOpacity ?? image.theme?.suggestedOpacity ?? (background.panelOpacity ?? 88) / 100;
  }
  return (background?.panelOpacity ?? 88) / 100;
}

function applyThemeTokens(theme, textOverride = null) {
  const root = document.documentElement;
  const source = theme?.tokens || BASE_THEME.tokens;
  const correctedOverride = textOverride
    ? ensureAccessibleTextColor(textOverride, source.surface, 4.5)
    : null;
  const tokens = {
    ...BASE_THEME.tokens,
    ...source,
    text: correctedOverride?.color || source.text,
    textSoft: correctedOverride
      ? ensureAccessibleTextColor(source.textSoft, source.surface, 4.5).color
      : source.textSoft
  };
  const values = {
    '--theme-bg': tokens.bg,
    '--theme-surface': tokens.surface,
    '--theme-surface-rgb': tokens.surfaceRgb.join(' '),
    '--theme-text': tokens.text,
    '--theme-text-soft': tokens.textSoft,
    '--theme-muted': tokens.muted,
    '--theme-primary': tokens.primary,
    '--theme-primary-deep': tokens.primaryDeep,
    '--theme-primary-text': tokens.primaryText,
    '--theme-accent': tokens.accent,
    '--theme-berry': tokens.berry,
    '--theme-sky': tokens.sky,
    '--theme-border': tokens.border,
    '--theme-border-rgb': tokens.borderRgb.join(' '),
    '--theme-sidebar': tokens.sidebar,
    '--theme-sidebar-rgb': hexToRgb(tokens.sidebar).join(' '),
    '--theme-sidebar-text': tokens.sidebarText,
    '--theme-danger': tokens.danger,
    '--theme-chart-calories': tokens.chartCalories,
    '--theme-chart-weight': tokens.chartWeight,
    '--theme-chart-protein': tokens.chartProtein || tokens.sky
  };
  Object.entries(values).forEach(([name, value]) => root.style.setProperty(name, value));
  root.dataset.themeMode = theme?.mode || 'light';
  root.style.colorScheme = theme?.mode || 'light';
}

function syncThemeControls(background = state.settings.background) {
  const image = getActiveBackgroundImage(background);
  const theme = image?.theme;
  const panel = $('#image-theme-panel');
  panel.hidden = !theme;
  if (!theme) return;
  $('#theme-mode-label').textContent = theme.mode === 'dark' ? '深色主题' : '浅色主题';
  $('#theme-swatch-bg').style.background = theme.tokens.bg;
  $('#theme-swatch-surface').style.background = theme.tokens.surface;
  $('#theme-swatch-primary').style.background = theme.tokens.primary;
  $('#theme-swatch-accent').style.background = theme.tokens.accent;
  const effectiveText = image.textColorOverride || theme.tokens.text;
  $('#theme-text-color').value = effectiveText;
  $('#theme-status').textContent = image.textColorOverride
    ? '已使用手动字体颜色，并自动保证至少 4.5:1 对比度。'
    : `自动配色已应用到全站，建议面板透明度 ${Math.round(theme.suggestedOpacity * 100)}%。`;
}

function handleBackgroundChange() {
  const type = $('#background-type').value;
  updateBackgroundControlVisibility(type);
  state.settings = {
    ...state.settings,
    background: {
      ...state.settings.background,
      type,
      color: $('#background-color').value,
      gradientFrom: $('#gradient-from').value,
      gradientTo: $('#gradient-to').value,
      preset: $('#background-preset').value,
      blur: Number($('#background-blur').value),
      dim: Number($('#background-dim').value)
    }
  };
  applyBackground(state.settings);
  updateRangeOutputs();
  persistBackground();
}

const persistBackground = debounce(async () => {
  try {
    state.settings = await store.saveSettings(state.settings);
  } catch (error) {
    showToast(`背景保存失败：${error.message}`, 'error');
  }
}, 250);

function updateRangeOutputs() {
  $('#background-blur-output').textContent = `${$('#background-blur').value}px`;
  $('#background-dim-output').textContent = `${$('#background-dim').value}%`;
  $('#panel-opacity-output').textContent = `${$('#panel-opacity').value}%`;
}

function applyBackground(settings) {
  const background = settings.background || DEFAULT_SETTINGS.background;
  const root = document.documentElement;
  const activeImage = getActiveBackgroundImage(background);
  applyThemeTokens(activeImage?.theme, activeImage?.textColorOverride);
  root.style.setProperty('--user-bg-color', background.color || '#eef6f0');
  root.style.setProperty('--user-gradient-from', background.gradientFrom || '#eef6f0');
  root.style.setProperty('--user-gradient-to', background.gradientTo || '#b8dfc8');
  root.style.setProperty('--user-bg-blur', `${background.blur ?? 0}px`);
  root.style.setProperty('--user-bg-dim', `${(background.dim ?? 10) / 100}`);
  root.style.setProperty('--panel-opacity', `${getEffectivePanelOpacity(background)}`);
  document.body.dataset.backgroundType = background.type || 'gradient';
  $('#background-pattern').dataset.preset = background.preset || 'dawn';
  const cropStyle = calculateBackgroundCropStyle(activeImage?.crop || background.crop);
  $('#background-image').style.backgroundImage = background.imageData ? `url("${background.imageData}")` : 'none';
  $('#background-image').style.backgroundSize = background.imageData ? cropStyle.backgroundSize : '';
  $('#background-image').style.backgroundPosition = background.imageData ? cropStyle.backgroundPosition : '';
  syncThemeControls(background);
}

async function handlePanelOpacityChange(event) {
  const opacity = clamp(Number(event.target.value) / 100, 0, 1);
  const background = state.settings.background;
  const image = getActiveBackgroundImage(background);
  const images = image
    ? (background.images || []).map(item => item.id === image.id ? { ...item, userPanelOpacity: opacity } : item)
    : background.images;
  state.settings = {
    ...state.settings,
    background: {
      ...background,
      images,
      panelOpacity: image ? background.panelOpacity : Math.round(opacity * 100)
    }
  };
  applyBackground(state.settings);
  updateRangeOutputs();
  persistBackground();
}

async function handleThemeTextColor(event) {
  const image = getActiveBackgroundImage();
  if (!image?.theme) return;
  const corrected = ensureAccessibleTextColor(event.target.value, image.theme.tokens.surface, 4.5);
  const images = (state.settings.background.images || []).map(item =>
    item.id === image.id ? { ...item, textColorOverride: corrected.color } : item
  );
  state.settings = { ...state.settings, background: { ...state.settings.background, images } };
  event.target.value = corrected.color;
  applyBackground(state.settings);
  state.settings = await store.saveSettings(state.settings);
  $('#theme-status').textContent = corrected.adjusted
    ? '所选颜色对比度不足，已自动调整到可读范围。'
    : '已使用手动字体颜色，并保证至少 4.5:1 对比度。';
}

async function resetThemeTextColor() {
  const image = getActiveBackgroundImage();
  if (!image?.theme) return;
  const images = (state.settings.background.images || []).map(item =>
    item.id === image.id ? { ...item, textColorOverride: null } : item
  );
  state.settings = { ...state.settings, background: { ...state.settings.background, images } };
  state.settings = await store.saveSettings(state.settings);
  applyBackground(state.settings);
  syncThemeControls(state.settings.background);
  showToast('已恢复自动字体颜色');
}

async function ensureActiveBackgroundTheme() {
  const background = state.settings.background;
  const image = getActiveBackgroundImage(background);
  if (!image || image.theme) return;
  try {
    const theme = await analyzeStoredImageTheme(image.data);
    const images = (background.images || []).map(item => item.id === image.id ? { ...item, theme } : item);
    state.settings = { ...state.settings, background: { ...background, images } };
    state.settings = await store.saveSettings(state.settings);
  } catch (error) {
    showToast(`图片主题分析失败：${error.message}`, 'error');
  }
}
async function handleBackgroundImage(event) {
  await processBackgroundImage(event.target.files?.[0]);
  event.target.value = '';
}

function bindBackgroundDropZone() {
  const dropZone = $('#background-image-drop');
  for (const eventName of ['dragenter', 'dragover']) {
    dropZone.addEventListener(eventName, event => {
      event.preventDefault();
      dropZone.classList.add('is-dragging');
    });
  }
  for (const eventName of ['dragleave', 'drop']) {
    dropZone.addEventListener(eventName, event => {
      event.preventDefault();
      dropZone.classList.remove('is-dragging');
    });
  }
  dropZone.addEventListener('drop', event => processBackgroundImage(event.dataTransfer?.files?.[0]));
}

function isSupportedBackgroundFile(file) {
  const type = String(file.type || '').toLowerCase();
  if (type.startsWith('image/')) return true;
  return /\.(jpe?g|png|webp|gif|bmp|avif|svg|ico|heic|heif|tiff?)$/i.test(file.name || '');
}
async function processBackgroundImage(file) {
  if (!file) return;
  if (!isSupportedBackgroundFile(file)) {
    showToast('请选择浏览器支持的图片文件。', 'error');
    return;
  }
  if (file.size > 20 * 1024 * 1024) {
    showToast('原图不能超过 20MB。', 'error');
    return;
  }
  $('#background-status').textContent = '正在读取原图并分析主题颜色…';
  try {
    const prepared = await prepareBackgroundImage(file);
    pendingBackgroundUpload = {
      name: file.name,
      mimeType: file.type,
      data: prepared.imageData,
      theme: prepared.theme,
      naturalWidth: prepared.naturalWidth,
      naturalHeight: prepared.naturalHeight
    };
    backgroundCropEditor.naturalWidth = prepared.naturalWidth;
    backgroundCropEditor.naturalHeight = prepared.naturalHeight;
    const cropImage = $('#background-crop-image');
    cropImage.onload = () => requestAnimationFrame(resetBackgroundCropEditor);
    cropImage.src = prepared.imageData;
    $('#background-crop-status').textContent = `${prepared.naturalWidth} × ${prepared.naturalHeight} 原图，拖动或缩放选择区域`;
    openDialog('#background-crop-dialog');
    if (cropImage.complete) requestAnimationFrame(resetBackgroundCropEditor);
  } catch (error) {
    $('#background-status').textContent = '';
    showToast(`图片读取失败：${error.message}`, 'error');
  }
}

function backgroundCropMetrics() {
  const rect = $('#background-crop-stage').getBoundingClientRect();
  const zoom = Number($('#background-crop-zoom').value) || 1;
  const scale = Math.max(rect.width / backgroundCropEditor.naturalWidth, rect.height / backgroundCropEditor.naturalHeight) * zoom;
  return {
    stageWidth: rect.width,
    stageHeight: rect.height,
    scale,
    displayWidth: backgroundCropEditor.naturalWidth * scale,
    displayHeight: backgroundCropEditor.naturalHeight * scale
  };
}

function clampBackgroundCropOffsets() {
  const metrics = backgroundCropMetrics();
  const minX = metrics.stageWidth - metrics.displayWidth;
  const minY = metrics.stageHeight - metrics.displayHeight;
  backgroundCropEditor.offsetX = clamp(backgroundCropEditor.offsetX, minX, 0);
  backgroundCropEditor.offsetY = clamp(backgroundCropEditor.offsetY, minY, 0);
}

function applyBackgroundCropTransform() {
  const image = $('#background-crop-image');
  const metrics = backgroundCropMetrics();
  image.style.width = `${metrics.displayWidth}px`;
  image.style.height = `${metrics.displayHeight}px`;
  image.style.transform = `translate(${backgroundCropEditor.offsetX}px, ${backgroundCropEditor.offsetY}px)`;
}

function resetBackgroundCropEditor() {
  const ratio = $('#background-crop-ratio').value;
  $('#background-crop-stage').style.setProperty('--crop-aspect', ratio.replace('/', ' / '));
  $('#background-crop-zoom').value = 1;
  requestAnimationFrame(() => {
    const metrics = backgroundCropMetrics();
    backgroundCropEditor.offsetX = (metrics.stageWidth - metrics.displayWidth) / 2;
    backgroundCropEditor.offsetY = (metrics.stageHeight - metrics.displayHeight) / 2;
    clampBackgroundCropOffsets();
    applyBackgroundCropTransform();
  });
}

function updateBackgroundCropTransform() {
  const metrics = backgroundCropMetrics();
  backgroundCropEditor.offsetX = (metrics.stageWidth - metrics.displayWidth) / 2;
  backgroundCropEditor.offsetY = (metrics.stageHeight - metrics.displayHeight) / 2;
  clampBackgroundCropOffsets();
  applyBackgroundCropTransform();
}

function startBackgroundCropDrag(event) {
  if (!pendingBackgroundUpload) return;
  backgroundCropEditor.dragging = true;
  backgroundCropEditor.pointerId = event.pointerId;
  backgroundCropEditor.pointerStartX = event.clientX;
  backgroundCropEditor.pointerStartY = event.clientY;
  backgroundCropEditor.offsetStartX = backgroundCropEditor.offsetX;
  backgroundCropEditor.offsetStartY = backgroundCropEditor.offsetY;
  event.currentTarget.setPointerCapture(event.pointerId);
}

function moveBackgroundCropDrag(event) {
  if (!backgroundCropEditor.dragging || event.pointerId !== backgroundCropEditor.pointerId) return;
  backgroundCropEditor.offsetX = backgroundCropEditor.offsetStartX + event.clientX - backgroundCropEditor.pointerStartX;
  backgroundCropEditor.offsetY = backgroundCropEditor.offsetStartY + event.clientY - backgroundCropEditor.pointerStartY;
  clampBackgroundCropOffsets();
  applyBackgroundCropTransform();
}

function endBackgroundCropDrag(event) {
  if (event.pointerId !== backgroundCropEditor.pointerId) return;
  backgroundCropEditor.dragging = false;
  backgroundCropEditor.pointerId = null;
}

async function saveCroppedBackground() {
  if (!pendingBackgroundUpload) return;
  const metrics = backgroundCropMetrics();
  const crop = {
    x: clamp((-backgroundCropEditor.offsetX / metrics.scale) / backgroundCropEditor.naturalWidth, 0, 1),
    y: clamp((-backgroundCropEditor.offsetY / metrics.scale) / backgroundCropEditor.naturalHeight, 0, 1),
    width: clamp(metrics.stageWidth / metrics.scale / backgroundCropEditor.naturalWidth, 0.05, 1),
    height: clamp(metrics.stageHeight / metrics.scale / backgroundCropEditor.naturalHeight, 0.05, 1)
  };
  const entry = {
    id: createBackgroundImageId(),
    name: pendingBackgroundUpload.name,
    mimeType: pendingBackgroundUpload.mimeType,
    data: pendingBackgroundUpload.data,
    crop,
    theme: pendingBackgroundUpload.theme,
    userPanelOpacity: null,
    textColorOverride: null,
    createdAt: new Date().toISOString()
  };
  state.settings = {
    ...state.settings,
    background: {
      ...state.settings.background,
      type: 'image',
      imageId: entry.id,
      imageData: entry.data,
      imageName: entry.name,
      crop: entry.crop,
      images: [entry, ...(state.settings.background.images || [])]
    }
  };
  state.settings = await store.saveSettings(state.settings);
  closeDialog('#background-crop-dialog');
  pendingBackgroundUpload = null;
  syncBackgroundForm();
  applyBackground(state.settings);
  $('#background-status').textContent = '原图与裁剪区域已保存在当前浏览器。';
  showToast('背景图片已保存，原图未经压缩');
}
async function removeBackgroundImage() {
  state.settings = await store.saveSettings({
    ...state.settings,
    background: {
      ...state.settings.background,
      type: 'gradient',
      imageId: null,
      imageData: null,
      imageName: null,
      crop: null
    }
  });
  syncBackgroundForm();
  applyBackground(state.settings);
  $('#background-status').textContent = '个人背景图片已移除。';
  showToast('已移除背景图片');
}
async function resetBackground() {
  const images = state.settings.background.images || [];
  state.settings = await store.saveSettings({ ...state.settings, background: { ...structuredClone(DEFAULT_SETTINGS.background), images } });
  syncBackgroundForm();
  applyBackground(state.settings);
  showToast('已恢复默认背景');
}

function ensureBackgroundLibrary(settings) {
  const background = { ...DEFAULT_SETTINGS.background, ...(settings.background || {}) };
  const images = Array.isArray(background.images) ? [...background.images] : [];
  if (background.imageData && !images.some(image => image.data === background.imageData)) {
    images.unshift({
      id: background.imageId || 'background-legacy-current',
      name: background.imageName || '之前使用的图片',
      data: background.imageData,
      createdAt: new Date().toISOString()
    });
  }
  const normalizedImages = images.map(image => ({
    ...image,
    mimeType: image.mimeType || 'image/*',
    crop: image.crop || { x: 0, y: 0, width: 1, height: 1 },
    theme: image.theme || null,
    userPanelOpacity: Number.isFinite(image.userPanelOpacity) ? image.userPanelOpacity : null,
    textColorOverride: image.textColorOverride || null
  }));
  if (background.imageData && !background.imageId) background.imageId = normalizedImages[0]?.id || null;
  return { ...settings, background: { ...background, images: normalizedImages } };
}
function createBackgroundImageId() {
  return globalThis.crypto?.randomUUID ? `background-${crypto.randomUUID()}` : `background-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function renderBackgroundLibrary(background) {
  const images = Array.isArray(background.images) ? background.images : [];
  const library = $('#background-library');
  const grid = $('#background-library-grid');
  library.hidden = images.length === 0;
  $('#background-image-count').textContent = `${images.length} 张`;
  grid.innerHTML = images.map(image => `
    <article class="background-library-item">
      <button type="button" class="background-library-choice" data-background-image-id="${escapeHtml(image.id)}"${background.imageId === image.id ? ' data-current="true"' : ''}>
        <span class="background-library-thumb" data-background-thumb="${escapeHtml(image.id)}"></span>
        <strong>${escapeHtml(image.name)}</strong>
      </button>
      <button type="button" class="danger-text-button" data-delete-background-image-id="${escapeHtml(image.id)}">删除</button>
    </article>
  `).join('');
  for (const image of images) {
    const thumbnail = grid.querySelector(`[data-background-thumb="${CSS.escape(image.id)}"]`);
    if (thumbnail) {
      const cropStyle = calculateBackgroundCropStyle(image.crop);
      thumbnail.style.backgroundImage = `url("${image.data}")`;
      thumbnail.style.backgroundSize = cropStyle.backgroundSize;
      thumbnail.style.backgroundPosition = cropStyle.backgroundPosition;
    }
  }
}

async function applyStoredBackgroundImage(id) {
  const background = state.settings.background;
  let image = (background.images || []).find(item => item.id === id);
  if (!image) return;
  if (!image.theme) {
    $('#background-status').textContent = '正在分析图片颜色…';
    const theme = await analyzeStoredImageTheme(image.data);
    image = { ...image, theme };
    const images = background.images.map(item => item.id === id ? image : item);
    state.settings = { ...state.settings, background: { ...background, images } };
  }
  state.settings = await store.saveSettings({
    ...state.settings,
    background: { ...state.settings.background, type: 'image', imageId: image.id, imageData: image.data, imageName: image.name, crop: image.crop }
  });
  syncBackgroundForm();
  applyBackground(state.settings);
  $('#background-status').textContent = `正在使用：${image.name}`;
  showToast('已更换背景图片并应用自动主题');
}
async function deleteStoredBackgroundImage(id) {
  const background = state.settings.background;
  const image = (background.images || []).find(item => item.id === id);
  if (!image || !window.confirm(`确定删除背景图片“${image.name}”吗？`)) return;
  const images = (background.images || []).filter(item => item.id !== id);
  const removingCurrent = background.imageId === id;
  state.settings = await store.saveSettings({
    ...state.settings,
    background: {
      ...background,
      type: removingCurrent ? 'gradient' : background.type,
      images,
      imageId: removingCurrent ? null : background.imageId,
      imageData: removingCurrent ? null : background.imageData,
      imageName: removingCurrent ? null : background.imageName,
      crop: removingCurrent ? null : background.crop
    }
  });
  syncBackgroundForm();
  applyBackground(state.settings);
  showToast('背景图片已删除');
}
function loadImageSource(source, revoke = false) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => {
      if (revoke) URL.revokeObjectURL(source);
      resolve(image);
    };
    image.onerror = () => {
      if (revoke) URL.revokeObjectURL(source);
      reject(new Error('无法读取图片'));
    };
    image.src = source;
  });
}

function analyzeImageElement(image) {
  const canvas = document.createElement('canvas');
  canvas.width = 48;
  canvas.height = 48;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  return analyzeImageTheme(context.getImageData(0, 0, canvas.width, canvas.height));
}

async function prepareBackgroundImage(file) {
  const objectUrl = URL.createObjectURL(file);
  const image = await loadImageSource(objectUrl, true);
  const theme = analyzeImageElement(image);
  const imageData = await readFileAsDataUrl(file);
  return {
    imageData,
    theme,
    mimeType: file.type,
    naturalWidth: image.naturalWidth,
    naturalHeight: image.naturalHeight
  };
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error || new Error('无法读取原图'));
    reader.readAsDataURL(file);
  });
}
async function analyzeStoredImageTheme(dataUrl) {
  const image = await loadImageSource(dataUrl);
  return analyzeImageElement(image);
}
async function exportBackup() {
  const data = await store.exportData();
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  downloadBlob(blob, `nutrition-atlas-backup-${todayKey}.json`);
  showToast('JSON 备份已导出');
}

async function prepareImport(event) {
  const file = event.target.files?.[0];
  event.target.value = '';
  if (!file) return;
  try {
    const parsed = JSON.parse(await file.text());
    if (parsed.schemaVersion !== 1 || !Array.isArray(parsed.foods) || !Array.isArray(parsed.entries)) {
      throw new Error('文件不是有效的营养图谱备份');
    }
    pendingImport = parsed;
    $('#import-summary').innerHTML = `
      <div><span>个人资料</span><strong>${parsed.profile ? '有' : '无'}</strong></div>
      <div><span>食物</span><strong>${formatNumber(parsed.foods.length, 0)} 项</strong></div>
      <div><span>记录</span><strong>${formatNumber(parsed.entries.length, 0)} 条</strong></div>
      <div><span>体重</span><strong>${formatNumber(parsed.weights?.length || 0, 0)} 条</strong></div>`;
    openDialog('#import-dialog');
  } catch (error) {
    showToast(`无法导入：${error.message}`, 'error');
  }
}

async function confirmImport() {
  if (!pendingImport) return;
  try {
    await store.replaceData(pendingImport);
    pendingImport = null;
    closeDialog('#import-dialog');
    await reloadState();
    populateFoodCategories();
    syncProfileForm();
    syncBackgroundForm();
    applyBackground(state.settings);
    renderRoute(state.route);
    showToast('备份已导入并替换当前数据');
  } catch (error) {
    showToast(`导入失败：${error.message}`, 'error');
  }
}

async function resetAllData() {
  if (!window.confirm('确定清空全部个人记录、自定义食物、体重和背景设置吗？此操作无法撤销。')) return;
  await store.clearAll();
  await store.seedFoods(FOOD_LIBRARY);
  await reloadState();
  populateFoodCategories();
  syncProfileForm();
  syncBackgroundForm();
  applyBackground(state.settings);
  renderRoute('today');
  showToast('全部数据已清空');
}

async function handleBodyClick(event) {
  const routeButton = event.target.closest('[data-route]');
  if (routeButton) return renderRoute(routeButton.dataset.route, true);
  const closeButton = event.target.closest('[data-close-dialog]');
  if (closeButton) return closeDialog(`#${closeButton.dataset.closeDialog}`);
  const addMealButton = event.target.closest('[data-add-meal]');
  if (addMealButton) return openEntryDialog(addMealButton.dataset.addMeal);
  const entryFoodButton = event.target.closest('[data-entry-food-id]');
  if (entryFoodButton) return selectEntryFood(entryFoodButton.dataset.entryFoodId);
  const editFoodButton = event.target.closest('[data-edit-food]');
  if (editFoodButton) return openFoodDialog(state.foods.find(food => food.id === editFoodButton.dataset.editFood));
  const copyFoodButton = event.target.closest('[data-copy-food]');
  if (copyFoodButton) return openFoodDialog(state.foods.find(food => food.id === copyFoodButton.dataset.copyFood));
  const openFoodButton = event.target.closest('[data-open-food-dialog]');
  if (openFoodButton) return openFoodDialog();
  const deleteFoodButton = event.target.closest('[data-delete-food]');
  if (deleteFoodButton) return deleteFood(deleteFoodButton.dataset.deleteFood);
  const deleteEntryButton = event.target.closest('[data-delete-entry]');
  if (deleteEntryButton) return deleteEntry(deleteEntryButton.dataset.deleteEntry);
  const deleteWeightButton = event.target.closest('[data-delete-weight]');
  if (deleteWeightButton) return deleteWeight(deleteWeightButton.dataset.deleteWeight);  const workoutNameButton = event.target.closest('[data-workout-name]');
  if (workoutNameButton) {
    $('#workout-name').value = workoutNameButton.dataset.workoutName;
    $('#workout-name').focus();
    return;
  }
  const deleteWorkoutNameButton = event.target.closest('[data-delete-workout-name]');
  if (deleteWorkoutNameButton) return deleteWorkoutName(deleteWorkoutNameButton.dataset.deleteWorkoutName);  const deleteWorkoutButton = event.target.closest('[data-delete-workout]');
  if (deleteWorkoutButton) return deleteWorkout(deleteWorkoutButton.dataset.deleteWorkout);
  const backgroundImageButton = event.target.closest('[data-background-image-id]');
  if (backgroundImageButton) return applyStoredBackgroundImage(backgroundImageButton.dataset.backgroundImageId);
  const deleteBackgroundImageButton = event.target.closest('[data-delete-background-image-id]');
  if (deleteBackgroundImageButton) return deleteStoredBackgroundImage(deleteBackgroundImageButton.dataset.deleteBackgroundImageId);
}

async function deleteWorkoutName(name) {
  state.settings.workoutNames = (state.settings.workoutNames || []).filter(item => item !== name);
  state.settings = await store.saveSettings(state.settings);
  renderWorkoutNames();
  showToast('已从常用名称中删除');
}
async function deleteWorkout(id) {
  if (!window.confirm('确定删除这条训练记录吗？')) return;
  await store.deleteWorkout(id);
  state.workouts = state.workouts.filter(item => item.id !== id);
  renderWorkout();
  showToast('训练记录已删除');
}
async function deleteFood(id) {
  if (!window.confirm('确定删除这个自定义食物吗？已有记录不会改变。')) return;
  try {
    await store.deleteFood(id);
    state.foods = await store.getFoods();
    renderFoodList();
    showToast('食物已删除');
  } catch (error) {
    showToast(error.message, 'error');
  }
}

async function deleteEntry(id) {
  if (!window.confirm('确定删除这条食物记录吗？')) return;
  await store.deleteEntry(id);
  state.allEntries = state.allEntries.filter(entry => entry.id !== id);
  renderToday();
  showToast('记录已删除');
}

async function deleteWeight(id) {
  if (!window.confirm('确定删除这条体重记录吗？')) return;
  await store.deleteWeight(id);
  state.weights = await store.getWeights();
  syncProfileForm();
  renderMetabolism();
  renderWeightList();
  showToast('体重记录已删除');
}

function changeSelectedDate(amount) {
  const next = addDays(state.selectedDate, amount);
  if (next > todayKey) return;
  state.selectedDate = next;
  if (state.route === 'workout') renderWorkout();
  else renderToday();
}

function entriesForDate(date) {
  return state.allEntries.filter(entry => entry.date === date);
}

function latestWeight() {
  return state.weights[0] || null;
}

function openDialog(selector) {
  const dialog = $(selector);
  if (!dialog.open) dialog.showModal();
}

function closeDialog(selector) {
  const dialog = $(selector);
  if (dialog.open) dialog.close();
}

function setFormError(selector, message) {
  const element = $(selector);
  element.textContent = message || '';
  element.hidden = !message;
}

function showToast(message, type = 'success') {
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.textContent = message;
  $('#toast-region').append(toast);
  setTimeout(() => toast.remove(), 3200);
}