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

export type NutritionResult = {
  items?: NutritionItem[];
  total?: NutritionTotal;
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

export type TodaySummary = {
  date: string;
  count: number;
  total: NutritionTotal;
};

export type DailyFeedback = TodaySummary & {
  feedback: string;
};

export type ImagePayload = {
  base64: string;
  mimeType: string;
};
