import type {
  AiProviderMode,
  AiStatus,
  DailyFeedback,
  DashboardData,
  DashboardRangeDays,
  DataConfidence,
  FavoriteMeal,
  FavoriteMealPayload,
  NutritionResult,
  NutritionTargets,
  SavedMeal,
  SaveMealPayload,
  SaveTargetsPayload,
  TodaySummary,
  WeeklyReview,
  WeeklyTrend,
  WeeklyTrendDay,
} from './types';

declare global {
  interface Window {
    google?: {
      script?: {
        run?: GoogleScriptRun;
      };
    };
  }
}

type GoogleScriptRun = {
  withSuccessHandler: (handler: (value: unknown) => void) => GoogleScriptRun;
  withFailureHandler: (handler: (error: Error) => void) => GoogleScriptRun;
  estimateCalories: (
    description: string,
    imageBase64: string,
    imageMimeType: string,
    imageWidthPx: number,
    imageHeightPx: number,
  ) => void;
  processInput: (payload: SaveMealPayload) => void;
  deleteMeal: (id: string) => void;
  listRecentMeals: (limit: number) => void;
  listFavorites: () => void;
  addFavorite: (payload: FavoriteMealPayload) => void;
  removeFavorite: (id: string) => void;
  updateMeal: (id: string, payload: SaveMealPayload) => void;
  getTodaySummary: () => void;
  getTargets: () => void;
  saveTargets: (payload: SaveTargetsPayload) => void;
  getWeeklyTrend: () => void;
  getDashboardData: (rangeDays: DashboardRangeDays) => void;
  getLatestWeeklyReview: () => void;
  summarizeTodayFeedback: () => void;
  summarizeWeeklyFeedback: () => void;
  getAiStatus: () => void;
  setAiProviderMode: (mode: AiProviderMode) => void;
  confirmOpenAiEligibility: (action: 'confirm' | 'pause') => void;
};

export function estimateCalories(
  description: string,
  imageBase64: string,
  imageMimeType: string,
  imageWidthPx: number,
  imageHeightPx: number,
): Promise<NutritionResult> {
  return callGas<NutritionResult>((runner) => {
    runner.estimateCalories(description, imageBase64, imageMimeType, imageWidthPx, imageHeightPx);
  });
}

export function processInput(payload: SaveMealPayload): Promise<{ ok: boolean; id: string }> {
  return callGas<{ ok: boolean; id: string }>((runner) => {
    runner.processInput(payload);
  });
}

export function deleteMeal(id: string): Promise<{ ok: boolean; id: string }> {
  return callGas<{ ok: boolean; id: string }>((runner) => {
    runner.deleteMeal(id);
  });
}

export function listRecentMeals(limit: number): Promise<SavedMeal[]> {
  return callGas<SavedMeal[]>((runner) => {
    runner.listRecentMeals(limit);
  });
}

export function listFavorites(): Promise<FavoriteMeal[]> {
  return callGas<FavoriteMeal[]>((runner) => {
    runner.listFavorites();
  });
}

export function addFavorite(payload: FavoriteMealPayload): Promise<FavoriteMeal> {
  return callGas<FavoriteMeal>((runner) => {
    runner.addFavorite(payload);
  });
}

export function removeFavorite(id: string): Promise<{ ok: boolean; id: string }> {
  return callGas<{ ok: boolean; id: string }>((runner) => {
    runner.removeFavorite(id);
  });
}

export function updateMeal(id: string, payload: SaveMealPayload): Promise<{ ok: boolean; id: string }> {
  return callGas<{ ok: boolean; id: string }>((runner) => {
    runner.updateMeal(id, payload);
  });
}

export function getTodaySummary(): Promise<TodaySummary> {
  return callGas<TodaySummary>((runner) => {
    runner.getTodaySummary();
  });
}

export function getTargets(): Promise<NutritionTargets> {
  return callGas<NutritionTargets>((runner) => {
    runner.getTargets();
  }).then(normalizeTargets);
}

export function saveTargets(payload: SaveTargetsPayload): Promise<{ ok: boolean; targets: NutritionTargets }> {
  return callGas<{ ok: boolean; targets: NutritionTargets }>((runner) => {
    runner.saveTargets(payload);
  }).then((result) => ({
    ...result,
    targets: normalizeTargets(result.targets),
  }));
}

export function getWeeklyTrend(): Promise<WeeklyTrend> {
  return callGas<WeeklyTrend>((runner) => {
    runner.getWeeklyTrend();
  }).then(normalizeWeeklyTrend);
}

export function getDashboardData(rangeDays: DashboardRangeDays): Promise<DashboardData> {
  return callGas<DashboardData>((runner) => {
    runner.getDashboardData(rangeDays);
  }).then(normalizeDashboardData);
}

export function getLatestWeeklyReview(): Promise<WeeklyReview | null> {
  return callGas<WeeklyReview | null>((runner) => {
    runner.getLatestWeeklyReview();
  });
}

export function summarizeTodayFeedback(): Promise<DailyFeedback> {
  return callGas<DailyFeedback>((runner) => {
    runner.summarizeTodayFeedback();
  });
}

export function summarizeWeeklyFeedback(): Promise<WeeklyReview> {
  return callGas<WeeklyReview>((runner) => {
    runner.summarizeWeeklyFeedback();
  });
}

export function getAiStatus(): Promise<AiStatus> {
  return callGas<AiStatus>((runner) => {
    runner.getAiStatus();
  });
}

export function setAiProviderMode(mode: AiProviderMode): Promise<AiStatus> {
  return callGas<AiStatus>((runner) => {
    runner.setAiProviderMode(mode);
  });
}

export function confirmOpenAiEligibility(action: 'confirm' | 'pause'): Promise<AiStatus> {
  return callGas<AiStatus>((runner) => {
    runner.confirmOpenAiEligibility(action);
  });
}

function callGas<T>(invoke: (runner: GoogleScriptRun) => void): Promise<T> {
  return new Promise((resolve, reject) => {
    const runner = window.google?.script?.run;

    if (!runner) {
      reject(new Error('GAS Web App 上で開いてください。'));
      return;
    }

    const configuredRunner = runner
      .withSuccessHandler((value: unknown) => {
        resolve(value as T);
      })
      .withFailureHandler((error: Error) => {
        reject(error);
      });

    invoke(configuredRunner);
  });
}

function normalizeTargets(targets: Partial<NutritionTargets> | null | undefined): NutritionTargets {
  return {
    calories_kcal: normalizeNullableNumber(targets?.calories_kcal),
    protein_g: normalizeNullableNumber(targets?.protein_g),
    fat_g: normalizeNullableNumber(targets?.fat_g),
    carbs_g: normalizeNullableNumber(targets?.carbs_g),
  };
}

function normalizeWeeklyTrend(trend: WeeklyTrend): WeeklyTrend {
  return {
    ...trend,
    targets: normalizeTargets(trend.targets),
    days: trend.days.map(normalizeWeeklyTrendDay),
    latest_review: trend.latest_review ?? null,
  };
}

function normalizeWeeklyTrendDay(day: WeeklyTrendDay): WeeklyTrendDay {
  return {
    ...day,
    weight_kg: normalizeNullableNumber(day.weight_kg),
  };
}

export function normalizeDashboardData(data: Partial<DashboardData> | null | undefined): DashboardData {
  const raw = asRecord(data);
  const rangeDays = normalizeDashboardRangeDays(raw.range_days);
  const rawDays = Array.isArray(raw.days) ? raw.days.map(asRecord) : [];
  const rawDayDates = rawDays
    .map((day) => normalizeDateKey(day.date))
    .filter((date): date is string => date !== null);
  const windowEnd = normalizeDateKey(raw.window_end) || rawDayDates[rawDayDates.length - 1] || '1970-01-01';
  const windowStart = normalizeDateKey(raw.window_start) || addDateDays(windowEnd, 1 - rangeDays);
  const dates = enumerateDateKeys(windowStart, windowEnd, rangeDays);
  const daysByDate = new Map<string, Record<string, unknown>>();

  rawDays.forEach((day) => {
    const date = normalizeDateKey(day.date);
    if (date && !daysByDate.has(date)) {
      daysByDate.set(date, day);
    }
  });

  return {
    range_days: rangeDays,
    window_start: windowStart,
    window_end: windowEnd,
    goals: normalizeDashboardGoals(raw.goals),
    confidence: normalizeDashboardConfidence(raw.confidence),
    summary: normalizeDashboardSummary(raw.summary),
    days: dates.map((date) => normalizeDashboardDay(daysByDate.get(date), date)),
  };
}

function normalizeDashboardGoals(value: unknown): DashboardData['goals'] {
  const goals = asRecord(value);
  return {
    calories_kcal: normalizeNullableNonNegativeNumber(goals.calories_kcal),
    protein_g: normalizeNullableNonNegativeNumber(goals.protein_g),
    fat_g: normalizeNullableNonNegativeNumber(goals.fat_g),
    carbs_g: normalizeNullableNonNegativeNumber(goals.carbs_g),
    target_weight_kg: normalizeNullableBoundedNumber(goals.target_weight_kg, 20, 300),
  };
}

function normalizeDashboardConfidence(value: unknown): DashboardData['confidence'] {
  const confidence = asRecord(value);
  return {
    nutrition: normalizeConfidence(confidence.nutrition),
    weight: normalizeConfidence(confidence.weight),
    activity: normalizeConfidence(confidence.activity),
  };
}

function normalizeDashboardSummary(value: unknown): DashboardData['summary'] {
  const summary = asRecord(value);
  return {
    logging_days: normalizeNonNegativeInteger(summary.logging_days),
    adequate_days: normalizeNonNegativeInteger(summary.adequate_days),
    recording_coverage_ratio: normalizeRatio(summary.recording_coverage_ratio),
    average_intake_kcal: normalizeNullableNonNegativeNumber(summary.average_intake_kcal),
    average_protein_g: normalizeNullableNonNegativeNumber(summary.average_protein_g),
    average_steps: normalizeNullableNonNegativeNumber(summary.average_steps),
    latest_weight_trend_kg: normalizeNullableNumber(summary.latest_weight_trend_kg),
    weight_change_kg: normalizeNullableNumber(summary.weight_change_kg),
  };
}

function normalizeDashboardDay(value: Record<string, unknown> | undefined, date: string): DashboardData['days'][number] {
  const day = value || {};
  const intake = asRecord(day.intake);
  const coverage = asRecord(day.coverage);
  const loggedTypes = Array.isArray(coverage.logged_main_meal_types)
    ? coverage.logged_main_meal_types.filter(isMainMealType)
    : [];

  return {
    date,
    intake: {
      calories_kcal: normalizeNonNegativeNumber(intake.calories_kcal),
      protein_g: normalizeNonNegativeNumber(intake.protein_g),
      fat_g: normalizeNonNegativeNumber(intake.fat_g),
      carbs_g: normalizeNonNegativeNumber(intake.carbs_g),
    },
    meal_count: normalizeNonNegativeInteger(day.meal_count),
    coverage: {
      logged_main_meal_types: [...new Set(loggedTypes)],
      ratio: normalizeRatio(coverage.ratio),
      adequate: coverage.adequate === true,
    },
    weight_kg: normalizeNullableBoundedNumber(day.weight_kg, 20, 300),
    weight_trend_kg: normalizeNullableBoundedNumber(day.weight_trend_kg, 20, 300),
    body_fat_pct: normalizeNullableBoundedNumber(day.body_fat_pct, 0, 100),
    steps: normalizeNullableNonNegativeNumber(day.steps),
    expenditure_kcal: normalizeNullableNonNegativeNumber(day.expenditure_kcal),
    energy_balance_kcal: normalizeNullableNumber(day.energy_balance_kcal),
  };
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? value as Record<string, unknown> : {};
}

function normalizeDashboardRangeDays(value: unknown): DashboardRangeDays {
  return value === 30 || value === 90 ? value : 7;
}

function normalizeConfidence(value: unknown): DataConfidence {
  return value === 'high' || value === 'medium' ? value : 'low';
}

function isMainMealType(value: unknown): value is '朝' | '昼' | '夜' {
  return value === '朝' || value === '昼' || value === '夜';
}

function normalizeNonNegativeNumber(value: unknown): number {
  const number = normalizeNullableNumber(value);
  return number !== null && number >= 0 ? number : 0;
}

function normalizeNullableNonNegativeNumber(value: unknown): number | null {
  const number = normalizeNullableNumber(value);
  return number !== null && number >= 0 ? number : null;
}

function normalizeNullableBoundedNumber(value: unknown, minimum: number, maximum: number): number | null {
  const number = normalizeNullableNumber(value);
  return number !== null && number >= minimum && number <= maximum ? number : null;
}

function normalizeNonNegativeInteger(value: unknown): number {
  const number = normalizeNullableNumber(value);
  return number !== null && number >= 0 ? Math.floor(number) : 0;
}

function normalizeRatio(value: unknown): number {
  const number = normalizeNullableNumber(value);
  return number === null ? 0 : Math.min(1, Math.max(0, number));
}

function normalizeDateKey(value: unknown): string | null {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return null;
  }
  const timestamp = Date.parse(`${value}T00:00:00Z`);
  return Number.isNaN(timestamp) ? null : value;
}

function addDateDays(date: string, amount: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + amount * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);
}

function enumerateDateKeys(start: string, end: string, rangeDays: DashboardRangeDays): string[] {
  const dates: string[] = [];
  for (let cursor = start; cursor <= end && dates.length < rangeDays; cursor = addDateDays(cursor, 1)) {
    dates.push(cursor);
  }
  while (dates.length < rangeDays) {
    dates.unshift(addDateDays(dates[0] || end, -1));
  }
  return dates;
}

function normalizeNullableNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}
