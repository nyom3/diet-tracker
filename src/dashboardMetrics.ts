import type {
  DashboardData,
  DashboardDay,
  DashboardRangeDays,
  DataConfidence,
  MealCoverage,
  NutritionTargets,
} from './types';

const JST_OFFSET_MS = 9 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const MAIN_MEAL_TYPES = ['朝', '昼', '夜'] as const;
const VALID_RANGE_DAYS = new Set<DashboardRangeDays>([7, 30, 90]);

type DateInput = Date | string | number;
type Row = readonly unknown[] | Record<string, unknown>;

export type DashboardMetricsInput = {
  foodLogs: readonly Row[];
  healthRows: readonly Row[];
  targets?: readonly Row[];
  rangeDays: DashboardRangeDays;
  now?: DateInput;
};

type FoodRecord = {
  date: string | null;
  timestamp: number | null;
  mealType: string;
  calories: number;
  protein: number;
  fat: number;
  carbs: number;
};

type HealthRecord = {
  date: string | null;
  steps: number | null;
  expenditure: number | null;
  weight: number | null;
  bodyFat: number | null;
  present: {
    steps: boolean;
    expenditure: boolean;
    weight: boolean;
    bodyFat: boolean;
  };
};

type DayAccumulator = {
  intake: { calories: number; protein: number; fat: number; carbs: number };
  mealTypes: Set<string>;
  mealCount: number;
  health: {
    steps: number | null;
    expenditure: number | null;
    weight: number | null;
    bodyFat: number | null;
  };
};

export function getDashboardPeriod(
  rangeDays: DashboardRangeDays,
  now: DateInput = new Date(),
): { window_start: string; window_end: string } {
  assertRangeDays(rangeDays);
  const windowEnd = toDateKey(now);
  if (!windowEnd) {
    throw new RangeError('有効な基準日が必要です');
  }
  return {
    window_start: addCalendarDays(windowEnd, 1 - rangeDays),
    window_end: windowEnd,
  };
}

export function buildDashboardData(input: DashboardMetricsInput): DashboardData {
  const period = getDashboardPeriod(input.rangeDays, input.now);
  const nowDetails = getDateInputDetails(input.now ?? new Date());
  const dates = enumerateDateKeys(period.window_start, period.window_end);
  const accumulators = new Map<string, DayAccumulator>();
  for (const date of dates) {
    accumulators.set(date, createDayAccumulator());
  }

  for (const row of input.foodLogs) {
    const food = readFoodRecord(row);
    if (
      !food.date ||
      !accumulators.has(food.date) ||
      (nowDetails.epochMs !== null && food.timestamp !== null && food.timestamp > nowDetails.epochMs)
    ) {
      continue;
    }
    const day = accumulators.get(food.date);
    if (!day) {
      continue;
    }
    day.mealCount += 1;
    if (MAIN_MEAL_TYPES.includes(food.mealType as (typeof MAIN_MEAL_TYPES)[number])) {
      day.mealTypes.add(food.mealType);
    }
    day.intake.calories += food.calories;
    day.intake.protein += food.protein;
    day.intake.fat += food.fat;
    day.intake.carbs += food.carbs;
  }

  for (const row of input.healthRows) {
    const health = readHealthRecord(row);
    if (!health.date || !accumulators.has(health.date)) {
      continue;
    }
    const day = accumulators.get(health.date);
    if (!day) {
      continue;
    }
    mergeHealthRecord(day.health, health);
  }

  const days = dates.map((date, index) => {
    const accumulator = accumulators.get(date);
    if (!accumulator) {
      throw new Error(`日別集計の初期化に失敗しました: ${date}`);
    }
    const coverage = createMealCoverage(accumulator.mealTypes);
    const weightTrend = calculateWeightTrend(dates, accumulators, index);
    const expenditure = accumulator.health.expenditure;
    return {
      date,
      intake: {
        calories_kcal: accumulator.intake.calories,
        protein_g: accumulator.intake.protein,
        fat_g: accumulator.intake.fat,
        carbs_g: accumulator.intake.carbs,
      },
      meal_count: accumulator.mealCount,
      coverage,
      weight_kg: accumulator.health.weight,
      weight_trend_kg: weightTrend,
      body_fat_pct: accumulator.health.bodyFat,
      steps: accumulator.health.steps,
      expenditure_kcal: expenditure,
      energy_balance_kcal:
        coverage.adequate && expenditure !== null
          ? accumulator.intake.calories - expenditure
          : null,
    } satisfies DashboardDay;
  });

  return {
    range_days: input.rangeDays,
    ...period,
    goals: readTargets(input.targets ?? []),
    confidence: calculateConfidence(days, input.rangeDays),
    summary: calculateSummary(days, input.rangeDays),
    days,
  };
}

export function calculateWeightTrend(
  dates: readonly string[],
  accumulators: ReadonlyMap<string, DayAccumulator>,
  index: number,
): number | null {
  const start = Math.max(0, index - 6);
  const weights: number[] = [];
  for (let cursor = start; cursor <= index; cursor += 1) {
    const weight = accumulators.get(dates[cursor])?.health.weight ?? null;
    if (weight !== null) {
      weights.push(weight);
    }
  }
  return weights.length >= 3 ? average(weights) : null;
}

export function calculateConfidence(
  days: readonly DashboardDay[],
  rangeDays: DashboardRangeDays,
): DashboardData['confidence'] {
  const adequateDays = days.filter((day) => day.coverage.adequate).length;
  const weightObservations = days.filter((day) => day.weight_kg !== null).length;
  const activityObservations = days.filter(
    (day) => day.steps !== null || day.expenditure_kcal !== null,
  ).length;
  return {
    nutrition: confidenceForRatio(adequateDays / rangeDays),
    weight: confidenceForRatio((weightObservations * 7) / rangeDays, 3, 1),
    activity: confidenceForRatio(activityObservations / rangeDays),
  };
}

export function calculateSummary(
  days: readonly DashboardDay[],
  rangeDays: DashboardRangeDays,
): DashboardData['summary'] {
  const loggingDays = days.filter((day) => day.meal_count > 0);
  const adequateDays = days.filter((day) => day.coverage.adequate);
  const trendDays = days.filter((day) => day.weight_trend_kg !== null);
  const validSteps = days.flatMap((day) => (day.steps === null ? [] : [day.steps]));
  const firstTrend = trendDays[0]?.weight_trend_kg ?? null;
  const lastTrend = trendDays.at(-1)?.weight_trend_kg ?? null;

  return {
    logging_days: loggingDays.length,
    adequate_days: adequateDays.length,
    recording_coverage_ratio: round(
      days.reduce((total, day) => total + day.coverage.ratio, 0) / rangeDays,
    ),
    average_intake_kcal: averageOrNull(loggingDays.map((day) => day.intake.calories_kcal)),
    average_protein_g: averageOrNull(loggingDays.map((day) => day.intake.protein_g)),
    average_steps: averageOrNull(validSteps),
    latest_weight_trend_kg: lastTrend,
    weight_change_kg:
      rangeDays >= 7 && firstTrend !== null && lastTrend !== null && trendDays.length >= 2
        ? round(lastTrend - firstTrend)
        : null,
  };
}

function createDayAccumulator(): DayAccumulator {
  return {
    intake: { calories: 0, protein: 0, fat: 0, carbs: 0 },
    mealTypes: new Set<string>(),
    mealCount: 0,
    health: { steps: null, expenditure: null, weight: null, bodyFat: null },
  };
}

function readFoodRecord(row: Row): FoodRecord {
  const timestampValue = valueAt(row, 1, 'timestamp');
  return {
    date: toDateKey(timestampValue),
    timestamp: toTimestamp(timestampValue),
    mealType: String(valueAt(row, 2, 'meal_type') ?? ''),
    calories: toNumber(valueAt(row, 4, 'calories_kcal')) ?? 0,
    protein: toNumber(valueAt(row, 5, 'protein_g')) ?? 0,
    fat: toNumber(valueAt(row, 6, 'fat_g')) ?? 0,
    carbs: toNumber(valueAt(row, 7, 'carbs_g')) ?? 0,
  };
}

function readHealthRecord(row: Row): HealthRecord {
  const stepsValue = valueAt(row, 1, 'steps');
  const expenditureValue = valueAt(row, 2, 'total_calories_kcal');
  const weightValue = valueAt(row, 3, 'weight_kg');
  const bodyFatValue = valueAt(row, 4, 'body_fat_pct');
  return {
    date: toDateKey(valueAt(row, 0, 'date')),
    steps: nonNegativeNumber(stepsValue),
    expenditure: nonNegativeNumber(expenditureValue),
    weight: boundedNumber(weightValue, 20, 300),
    bodyFat: boundedNumber(bodyFatValue, 0, 100),
    present: {
      steps: hasExplicitValue(stepsValue),
      expenditure: hasExplicitValue(expenditureValue),
      weight: hasExplicitValue(weightValue),
      bodyFat: hasExplicitValue(bodyFatValue),
    },
  };
}

function mergeHealthRecord(
  target: DayAccumulator['health'],
  row: HealthRecord,
): void {
  const fields: Array<Exclude<keyof HealthRecord, 'date' | 'present'>> = [
    'steps',
    'expenditure',
    'weight',
    'bodyFat',
  ];
  for (const field of fields) {
    const raw = field === 'steps'
      ? row.steps
      : field === 'expenditure'
        ? row.expenditure
        : field === 'weight'
          ? row.weight
          : row.bodyFat;
    if (row.present[field]) {
      target[field] = raw;
    }
  }
}

function hasExplicitValue(value: unknown): boolean {
  return value !== '' && value !== null && value !== undefined;
}

function createMealCoverage(mealTypes: ReadonlySet<string>): MealCoverage {
  const logged = MAIN_MEAL_TYPES.filter((mealType) => mealTypes.has(mealType));
  return {
    logged_main_meal_types: [...logged],
    ratio: logged.length / MAIN_MEAL_TYPES.length,
    adequate: logged.length >= 2,
  };
}

function readTargets(rows: readonly Row[]): NutritionTargets & { target_weight_kg: number | null } {
  const goals: NutritionTargets & { target_weight_kg: number | null } = {
    calories_kcal: null,
    protein_g: null,
    fat_g: null,
    carbs_g: null,
    target_weight_kg: null,
  };
  for (const row of rows) {
    const key = String(valueAt(row, 0, 'key') ?? '');
    const value = valueAt(row, 1, 'value');
    if (key === 'target_weight_kg') {
      goals.target_weight_kg = boundedNumber(value, 20, 300);
    } else if (key in goals && key !== 'target_weight_kg') {
      goals[key as keyof NutritionTargets] = nonNegativeNumber(value);
    }
  }
  return goals;
}

function valueAt(row: Row, index: number, key: string): unknown {
  return Array.isArray(row) ? row[index] : (row as Record<string, unknown>)[key];
}

function toDateKey(value: unknown): string | null {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
      return isValidDateKey(trimmed) ? trimmed : null;
    }
    const timestamp = parseTimestamp(trimmed);
    return timestamp === null ? null : epochToJstDateKey(timestamp);
  }
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : epochToJstDateKey(value.getTime());
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return epochToJstDateKey(value);
  }
  return null;
}

function toTimestamp(value: unknown): number | null {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
      return null;
    }
    return parseTimestamp(trimmed);
  }
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value.getTime();
  }
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function getDateInputDetails(value: DateInput): { epochMs: number | null } {
  return { epochMs: toTimestamp(value) };
}

function parseTimestamp(value: string): number | null {
  const hasTimeZone = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(value);
  const normalized = hasTimeZone ? value : `${value}+09:00`;
  const timestamp = Date.parse(normalized);
  return Number.isNaN(timestamp) ? null : timestamp;
}

function epochToJstDateKey(epochMs: number): string {
  return new Date(epochMs + JST_OFFSET_MS).toISOString().slice(0, 10);
}

function isValidDateKey(date: string): boolean {
  const epoch = Date.parse(`${date}T00:00:00Z`);
  return !Number.isNaN(epoch) && new Date(epoch).toISOString().slice(0, 10) === date;
}

function addCalendarDays(date: string, amount: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + amount * DAY_MS)
    .toISOString()
    .slice(0, 10);
}

function enumerateDateKeys(start: string, end: string): string[] {
  const dates: string[] = [];
  for (let cursor = start; cursor <= end; cursor = addCalendarDays(cursor, 1)) {
    dates.push(cursor);
  }
  return dates;
}

function assertRangeDays(rangeDays: number): asserts rangeDays is DashboardRangeDays {
  if (!VALID_RANGE_DAYS.has(rangeDays as DashboardRangeDays)) {
    throw new RangeError('期間は7、30、90日のいずれかです');
  }
}

function toNumber(value: unknown): number | null {
  if (value === '' || value === null || value === undefined) {
    return null;
  }
  const number = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(number) ? number : null;
}

function nonNegativeNumber(value: unknown): number | null {
  const number = toNumber(value);
  return number !== null && number >= 0 ? number : null;
}

function boundedNumber(value: unknown, minimum: number, maximum: number): number | null {
  const number = toNumber(value);
  return number !== null && number >= minimum && number <= maximum ? number : null;
}

function confidenceForRatio(
  ratio: number,
  highThreshold = 0.7,
  mediumThreshold = 0.4,
): DataConfidence {
  if (ratio >= highThreshold) {
    return 'high';
  }
  if (ratio >= mediumThreshold) {
    return 'medium';
  }
  return 'low';
}

function average(values: readonly number[]): number {
  return values.reduce((total, value) => total + value, 0) / values.length;
}

function averageOrNull(values: readonly number[]): number | null {
  return values.length === 0 ? null : round(average(values));
}

function round(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}
