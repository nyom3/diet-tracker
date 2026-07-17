import type {
  AiProviderMode,
  AiStatus,
  CoachAction,
  CoachActionCandidate,
  CoachActionCategory,
  CoachInsight,
  DailyFeedback,
  DashboardData,
  DashboardRangeDays,
  DataConfidence,
  FavoriteMeal,
  FavoriteMealPayload,
  GenerateCoachInsightRequest,
  HealthGoals,
  HomeSnapshot,
  MealType,
  NutritionResult,
  NutritionTargets,
  SavedMeal,
  SaveGoalsPayload,
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
  getGoals: () => void;
  saveGoals: (payload: SaveGoalsPayload) => void;
  getHomeSnapshot: () => void;
  generateCoachInsight: (request: GenerateCoachInsightRequest) => void;
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

export function getGoals(): Promise<HealthGoals> {
  return callGas<Partial<HealthGoals>>((runner) => {
    runner.getGoals();
  }).then(normalizeHealthGoals);
}

export function saveGoals(payload: SaveGoalsPayload): Promise<{ ok: true; goals: HealthGoals }> {
  return callGas<{ ok: true; goals: Partial<HealthGoals> }>((runner) => {
    runner.saveGoals(payload);
  }).then((result) => ({
    ...result,
    goals: normalizeHealthGoals(result.goals),
  }));
}

export function getHomeSnapshot(): Promise<HomeSnapshot> {
  return callGas<Partial<HomeSnapshot>>((runner) => {
    runner.getHomeSnapshot();
  }).then(normalizeHomeSnapshot);
}

export function generateCoachInsight(request: GenerateCoachInsightRequest): Promise<CoachInsight> {
  return callGas<Partial<CoachInsight>>((runner) => {
    runner.generateCoachInsight(request);
  }).then((result) => normalizeCoachInsight(result, '1970-01-01'));
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

function normalizeHealthGoals(goals: Partial<HealthGoals> | null | undefined): HealthGoals {
  return {
    calories_kcal: normalizeNullableNonNegativeNumber(goals?.calories_kcal),
    protein_g: normalizeNullableNonNegativeNumber(goals?.protein_g),
    fat_g: normalizeNullableNonNegativeNumber(goals?.fat_g),
    carbs_g: normalizeNullableNonNegativeNumber(goals?.carbs_g),
    target_weight_kg: normalizeNullableBoundedNumber(goals?.target_weight_kg, 20, 300),
  };
}

export function normalizeHomeSnapshot(snapshot: Partial<HomeSnapshot> | null | undefined): HomeSnapshot {
  const raw = asRecord(snapshot);
  const date = normalizeDateKey(raw.date) || '1970-01-01';
  const today = normalizeTodaySummary(raw.today, date);

  return {
    date,
    today,
    goals: normalizeHealthGoals(asRecord(raw.goals) as Partial<HealthGoals>),
    today_meals: normalizeSavedMeals(raw.today_meals),
    recent_meals: normalizeSavedMeals(raw.recent_meals),
    favorites: normalizeFavoriteMeals(raw.favorites),
    active_action: normalizeCoachAction(raw.active_action),
    rule_focus: normalizeCoachInsight(raw.rule_focus, date),
  };
}

function normalizeTodaySummary(value: unknown, fallbackDate: string): TodaySummary {
  const summary = asRecord(value);
  const total = asRecord(summary.total);

  return {
    date: normalizeDateKey(summary.date) || fallbackDate,
    count: normalizeNonNegativeInteger(summary.count),
    total: {
      calories_kcal: normalizeNonNegativeNumber(total.calories_kcal),
      protein_g: normalizeNonNegativeNumber(total.protein_g),
      fat_g: normalizeNonNegativeNumber(total.fat_g),
      carbs_g: normalizeNonNegativeNumber(total.carbs_g),
    },
  };
}

function normalizeSavedMeals(value: unknown): SavedMeal[] {
  return Array.isArray(value) ? value.map(normalizeSavedMeal) : [];
}

function normalizeSavedMeal(value: unknown): SavedMeal {
  const meal = asRecord(value);
  return {
    id: normalizeString(meal.id),
    timestamp: normalizeString(meal.timestamp),
    meal_type: normalizeMealType(meal.meal_type),
    description: normalizeString(meal.description),
    calories_kcal: normalizeNonNegativeNumber(meal.calories_kcal),
    protein_g: normalizeNonNegativeNumber(meal.protein_g),
    fat_g: normalizeNonNegativeNumber(meal.fat_g),
    carbs_g: normalizeNonNegativeNumber(meal.carbs_g),
    source: meal.source === 'api' ? 'api' : 'manual',
    breakdown_json: normalizeString(meal.breakdown_json),
  };
}

function normalizeFavoriteMeals(value: unknown): FavoriteMeal[] {
  return Array.isArray(value) ? value.map(normalizeFavoriteMeal) : [];
}

function normalizeFavoriteMeal(value: unknown): FavoriteMeal {
  const favorite = asRecord(value);
  return {
    id: normalizeString(favorite.id),
    description: normalizeString(favorite.description),
    calories_kcal: normalizeNonNegativeNumber(favorite.calories_kcal),
    protein_g: normalizeNonNegativeNumber(favorite.protein_g),
    fat_g: normalizeNonNegativeNumber(favorite.fat_g),
    carbs_g: normalizeNonNegativeNumber(favorite.carbs_g),
    breakdown_json: normalizeString(favorite.breakdown_json),
    created_at: normalizeString(favorite.created_at),
  };
}

export function normalizeCoachInsight(value: unknown, fallbackDate: string): CoachInsight {
  const insight = asRecord(value);
  const rawEvidence = Array.isArray(insight.evidence) ? insight.evidence : [];

  return {
    generated_at: normalizeString(insight.generated_at),
    scope: insight.scope === 'trend' ? 'trend' : 'today',
    source: insight.source === 'ai' ? 'ai' : 'rules',
    headline: normalizeString(insight.headline),
    summary: normalizeString(insight.summary),
    confidence: normalizeConfidence(insight.confidence),
    evidence: rawEvidence.map((item) => normalizeCoachEvidence(item, fallbackDate)),
    selected_action: normalizeCoachActionCandidate(insight.selected_action, fallbackDate),
    alternative_action: normalizeCoachActionCandidate(insight.alternative_action, fallbackDate),
    fallback_notice: typeof insight.fallback_notice === 'string' ? insight.fallback_notice : undefined,
  };
}

function normalizeCoachEvidence(value: unknown, fallbackDate: string): CoachInsight['evidence'][number] {
  const evidence = asRecord(value);
  const units = ['kcal', 'g', 'kg', 'steps', '%', 'days'] as const;
  const unit = units.includes(evidence.unit as typeof units[number])
    ? evidence.unit as typeof units[number]
    : 'days';

  return {
    key: normalizeString(evidence.key),
    label: normalizeString(evidence.label),
    value: normalizeFiniteNumber(evidence.value),
    unit,
    comparison_value: normalizeNullableNumber(evidence.comparison_value),
    comparison_label: typeof evidence.comparison_label === 'string' ? evidence.comparison_label : null,
    period_start: normalizeDateKey(evidence.period_start) || fallbackDate,
    period_end: normalizeDateKey(evidence.period_end) || fallbackDate,
    confidence: normalizeConfidence(evidence.confidence),
  };
}

function normalizeCoachActionCandidate(value: unknown, fallbackDate: string): CoachActionCandidate | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const action = asRecord(value);
  const categories = ['logging', 'energy', 'protein', 'macro_balance', 'activity'] as const;
  const category = categories.includes(action.category as CoachActionCategory)
    ? action.category as CoachActionCategory
    : 'logging';

  return {
    key: normalizeString(action.key),
    category,
    text: normalizeString(action.text),
    target_date: normalizeDateKey(action.target_date) || fallbackDate,
  };
}

function normalizeCoachAction(value: unknown): CoachAction | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const action = asRecord(value);
  const candidate = normalizeCoachActionCandidate(action, '1970-01-01');
  const statuses = ['planned', 'completed', 'dismissed', 'expired'] as const;
  const status = statuses.includes(action.status as typeof statuses[number])
    ? action.status as typeof statuses[number]
    : 'planned';

  return {
    ...(candidate || { key: '', category: 'logging', text: '', target_date: '1970-01-01' }),
    id: normalizeString(action.id),
    created_at: normalizeString(action.created_at),
    status,
    completed_at: typeof action.completed_at === 'string' ? action.completed_at : null,
  };
}

function normalizeString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function normalizeMealType(value: unknown): MealType {
  return value === '朝' || value === '昼' || value === '夜' || value === '間食' ? value : '間食';
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

function normalizeFiniteNumber(value: unknown): number {
  const numberValue = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(numberValue) ? numberValue : 0;
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
