const DAILY_MOVEMENT_MULTIPLIERS = Object.freeze({
  seated: 1.2,
  mixed: 1.3,
  active: 1.4,
  physical: 1.55
});

const EXERCISE_INTENSITY_FACTORS = Object.freeze({
  light: 0.6,
  moderate: 1,
  vigorous: 1.5
});

const ACTIVITY_MIN = 1.2;
const ACTIVITY_MAX = 2.1;
const WEEKLY_EXERCISE_CAP = 600;
const EXERCISE_MULTIPLIER_RANGE = 0.55;

export function calculateBmr({ sex, age, heightCm, weightKg }) {
  const base = 10 * Number(weightKg) + 6.25 * Number(heightCm) - 5 * Number(age);
  if (sex === 'male') return base + 5;
  if (sex === 'female') return base - 161;
  throw new TypeError('sex must be male or female for the Mifflin-St Jeor formula');
}

export function calculateActivityMultiplier({
  dailyMovement,
  exerciseDays,
  exerciseMinutes,
  exerciseIntensity,
  manualOverride
}) {
  if (manualOverride !== null && manualOverride !== undefined && manualOverride !== '') {
    return clamp(Number(manualOverride), ACTIVITY_MIN, ACTIVITY_MAX);
  }

  const dailyMultiplier = DAILY_MOVEMENT_MULTIPLIERS[dailyMovement] ?? DAILY_MOVEMENT_MULTIPLIERS.seated;
  const intensityFactor = EXERCISE_INTENSITY_FACTORS[exerciseIntensity] ?? EXERCISE_INTENSITY_FACTORS.moderate;
  const weeklyEquivalentMinutes = Math.min(
    WEEKLY_EXERCISE_CAP,
    Math.max(0, Number(exerciseDays) || 0) * Math.max(0, Number(exerciseMinutes) || 0) * intensityFactor
  );
  const exerciseAddition = (weeklyEquivalentMinutes / WEEKLY_EXERCISE_CAP) * EXERCISE_MULTIPLIER_RANGE;

  return clamp(dailyMultiplier + exerciseAddition, ACTIVITY_MIN, ACTIVITY_MAX);
}

export function calculateTdee(bmr, activityMultiplier) {
  return Number(bmr) * Number(activityMultiplier);
}

export function scaleNutrition(per100g, grams) {
  const factor = Math.max(0, Number(grams) || 0) / 100;
  return {
    kcal: Number(per100g.kcal || 0) * factor,
    carbs: Number(per100g.carbs || 0) * factor,
    protein: Number(per100g.protein || 0) * factor,
    fat: Number(per100g.fat || 0) * factor,
    fiber: Number(per100g.fiber || 0) * factor,
    sodium: Number(per100g.sodium || 0) * factor,
    potassium: Number(per100g.potassium || 0) * factor
  };
}

export function calculateMacroTargets(calorieTarget, ratios) {
  const target = Math.max(0, Number(calorieTarget) || 0);
  return {
    carbs: (target * (Number(ratios.carbs) || 0) / 100) / 4,
    protein: (target * (Number(ratios.protein) || 0) / 100) / 4,
    fat: (target * (Number(ratios.fat) || 0) / 100) / 9
  };
}

export function sumEntries(entries) {
  return (Array.isArray(entries) ? entries : []).reduce((totals, entry) => {
    const nutrients = entry?.nutrients || {};
    totals.kcal += Number(nutrients.kcal) || 0;
    totals.carbs += Number(nutrients.carbs) || 0;
    totals.protein += Number(nutrients.protein) || 0;
    totals.fat += Number(nutrients.fat) || 0;
    totals.fiber += Number(nutrients.fiber) || 0;
    totals.sodium += Number(nutrients.sodium) || 0;
    totals.potassium += Number(nutrients.potassium) || 0;
    return totals;
  }, { kcal: 0, carbs: 0, protein: 0, fat: 0, fiber: 0, sodium: 0, potassium: 0 });
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}