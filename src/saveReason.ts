import type { EstimateMode, InputMode, NutritionTotal } from './types';

export type SaveReasonInput = {
  inputMode: InputMode;
  hasPhoto: boolean;
  estimationInput: string;
  estimateMode: EstimateMode;
  hasNutrition: boolean;
  description: string;
  total: NutritionTotal;
};

const nutritionKeys: Array<keyof NutritionTotal> = [
  'calories_kcal',
  'protein_g',
  'fat_g',
  'carbs_g',
];

export function getSaveBlockedReason(input: SaveReasonInput): string | null {
  const hasInput = input.inputMode === 'photo'
    ? input.hasPhoto || Boolean(input.estimationInput.trim())
    : Boolean(input.estimationInput.trim());

  if (!hasInput) {
    return '食事内容または写真を入力してください';
  }

  if (!input.hasNutrition) {
    return input.estimateMode === 'api'
      ? '先にカロリーとPFCを推定してください'
      : 'カロリーとPFCを入力してください';
  }

  if (!input.description.trim()) {
    return '食事名を入力してください';
  }

  if (!nutritionKeys.every((key) => Number.isFinite(input.total[key]) && input.total[key] >= 0)) {
    return '数値を確認してください';
  }

  return null;
}
