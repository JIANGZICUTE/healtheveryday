import { sumEntries } from './calculations.js';

export const MEALS = Object.freeze([
  { id: 'breakfast', label: '早餐' },
  { id: 'lunch', label: '午餐' },
  { id: 'dinner', label: '晚餐' },
  { id: 'snack', label: '加餐' }
]);

const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

export function localDateKey(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function parseDateKey(dateKey) {
  const [year, month, day] = String(dateKey).split('-').map(Number);
  return new Date(year, month - 1, day, 12, 0, 0, 0);
}

export function addDays(dateKey, amount) {
  const date = parseDateKey(dateKey);
  date.setDate(date.getDate() + amount);
  return localDateKey(date);
}

export function createDateRange(endDate, count) {
  return Array.from({ length: Math.max(0, Number(count) || 0) }, (_, index) =>
    addDays(endDate, index - count + 1)
  );
}

export function formatDateLabel(dateKey) {
  const date = parseDateKey(dateKey);
  return `${date.getMonth() + 1}月${date.getDate()}日 ${WEEKDAYS[date.getDay()]}`;
}

export function formatNumber(value, digits = 0) {
  const number = Number(value);
  return new Intl.NumberFormat('zh-CN', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits
  }).format(Number.isFinite(number) ? number : 0);
}

export function formatCompactNumber(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return '0';
  return new Intl.NumberFormat('zh-CN', { notation: 'compact', maximumFractionDigits: 1 }).format(number);
}

export function validateMacroRatios(ratios) {
  const carbs = Number(ratios?.carbs) || 0;
  const protein = Number(ratios?.protein) || 0;
  const fat = Number(ratios?.fat) || 0;
  const total = carbs + protein + fat;
  const valid = Math.abs(total - 100) < 0.01 && [carbs, protein, fat].every(value => value >= 0 && value <= 100);
  return { valid, total, message: valid ? '' : `三类比例合计必须为 100%，当前为 ${formatNumber(total, 0)}%` };
}

export function groupEntriesByMeal(entries) {
  const safeEntries = Array.isArray(entries) ? entries : [];
  return MEALS.map(meal => {
    const mealEntries = safeEntries.filter(entry => entry.meal === meal.id);
    return {
      meal: meal.id,
      label: meal.label,
      entries: mealEntries,
      totals: sumEntries(mealEntries)
    };
  });
}

export function calculateBackgroundCropStyle(crop) {
  const width = clamp(crop?.width ?? 1, 0.05, 1);
  const height = clamp(crop?.height ?? 1, 0.05, 1);
  const x = clamp(crop?.x ?? 0, 0, 1 - width);
  const y = clamp(crop?.y ?? 0, 0, 1 - height);
  const xPercent = width >= 1 ? 0 : (x / (1 - width)) * 100;
  const yPercent = height >= 1 ? 0 : (y / (1 - height)) * 100;
  return {
    backgroundSize: `${100 / width}% auto`,
    backgroundPosition: `${xPercent}% ${yPercent}%`
  };
}
export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, Number(value)));
}

export function debounce(callback, delay = 180) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => callback(...args), delay);
  };
}

export function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}