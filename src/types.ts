export type MealType = '朝' | '昼' | '夜' | '間食';
export type InputMode = 'photo' | 'text';
export type EstimateMode = 'api' | 'manual';

export type NutritionKey = 'calories_kcal' | 'protein_g' | 'fat_g' | 'carbs_g';

export type NutritionItem = {
  name: string;
  calories_kcal: number;
  protein_g: number;
  fat_g: number;
  carbs_g: number;
};

export type NutritionTotal = {
  calories_kcal: number;
  protein_g: number;
  fat_g: number;
  carbs_g: number;
};

export type NutritionTargets = {
  calories_kcal: number | null;
  protein_g: number | null;
  fat_g: number | null;
  carbs_g: number | null;
};

export type SaveTargetsPayload = {
  calories_kcal: number;
  protein_g: number;
  fat_g: number;
  carbs_g: number;
};

export type NutritionResult = {
  display_name?: string;
  items?: NutritionItem[];
  total?: NutritionTotal;
  fallback_notice?: string;
} & Partial<NutritionTotal>;

export type SaveMealPayload = {
  timestamp: string;
  meal_type: MealType;
  description: string;
  calories_kcal: number | string;
  protein_g: number | string;
  fat_g: number | string;
  carbs_g: number | string;
  source: EstimateMode;
  breakdown_json: string;
};

export type SavedMeal = SaveMealPayload & {
  id: string;
  calories_kcal: number;
  protein_g: number;
  fat_g: number;
  carbs_g: number;
};

export type FavoriteMealPayload = {
  description: string;
  calories_kcal: number | string;
  protein_g: number | string;
  fat_g: number | string;
  carbs_g: number | string;
  breakdown_json: string;
};

export type FavoriteMeal = FavoriteMealPayload & {
  id: string;
  calories_kcal: number;
  protein_g: number;
  fat_g: number;
  carbs_g: number;
  created_at: string;
};

export type TodaySummary = {
  date: string;
  count: number;
  total: NutritionTotal;
};

export type DailyFeedback = TodaySummary & {
  feedback: string;
  fallback_notice?: string;
};

export type WeeklyReview = {
  generated_at: string;
  window_start: string;
  window_end: string;
  text: string;
  fallback_notice?: string;
};

export type WeeklyTrendDay = {
  date: string;
  count: number;
  total: NutritionTotal;
  weight_kg: number | null;
};

export type WeeklyTrend = {
  window_start: string;
  window_end: string;
  targets: NutritionTargets;
  days: WeeklyTrendDay[];
  latest_review: WeeklyReview | null;
};

export type DashboardRangeDays = 7 | 30 | 90;
export type DataConfidence = 'low' | 'medium' | 'high';

export type MealCoverage = {
  logged_main_meal_types: Array<Extract<MealType, '朝' | '昼' | '夜'>>;
  ratio: number;
  adequate: boolean;
};

export type DashboardDay = {
  date: string;
  intake: NutritionTotal;
  meal_count: number;
  coverage: MealCoverage;
  weight_kg: number | null;
  weight_trend_kg: number | null;
  body_fat_pct: number | null;
  steps: number | null;
  expenditure_kcal: number | null;
  energy_balance_kcal: number | null;
};

export type DashboardData = {
  range_days: DashboardRangeDays;
  window_start: string;
  window_end: string;
  goals: NutritionTargets & { target_weight_kg: number | null };
  confidence: {
    nutrition: DataConfidence;
    weight: DataConfidence;
    activity: DataConfidence;
  };
  summary: {
    logging_days: number;
    adequate_days: number;
    recording_coverage_ratio: number;
    average_intake_kcal: number | null;
    average_protein_g: number | null;
    average_steps: number | null;
    latest_weight_trend_kg: number | null;
    weight_change_kg: number | null;
  };
  days: DashboardDay[];
};

export type ImagePayload = {
  base64: string;
  mimeType: string;
  widthPx: number;
  heightPx: number;
};

export type AiProviderMode = 'auto' | 'openai' | 'gemini';
export type AiEligibilityStatus = 'confirmed' | 'unconfirmed' | 'expired' | 'paused';

export type AiUsage = {
  dateUtc: string;
  economyTokens: number;
  premiumTokens: number;
  reservedEconomyTokens: number;
  reservedPremiumTokens: number;
  requestCount: number;
  lastUsedAt: string;
};

export type AiLimitPair = {
  officialLimit: number;
  appLimit: number;
};

export type AiStatus = {
  mode: AiProviderMode;
  openAiAvailable: boolean;
  blockingReason: string;
  lastFallbackReason: string;
  lastUsage?: {
    totalTokens: number;
    inputTokens: number;
    outputTokens: number;
    requestKind: string;
    model: string;
    usedAt: string;
  } | null;
  eligibility: {
    status: AiEligibilityStatus;
    confirmedAt: number;
    recheckIntervalDays: number;
  };
  usage: AiUsage;
  limits: {
    economy: AiLimitPair;
    premium: AiLimitPair;
  };
};
