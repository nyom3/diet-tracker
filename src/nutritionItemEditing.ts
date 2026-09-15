import type { NutritionItem, NutritionKey } from './types';

const scalableNutritionKeys: readonly NutritionKey[] = [
  'calories_kcal',
  'protein_g',
  'fat_g',
  'carbs_g',
];

export function updateNutritionItemValue(
  item: NutritionItem,
  key: NutritionKey,
  value: number,
): NutritionItem {
  return { ...item, [key]: value };
}

export function scaleNutritionItem(item: NutritionItem, multiplier: number): NutritionItem {
  if (!Number.isFinite(multiplier) || multiplier <= 0) {
    throw new RangeError('栄養値の倍率は0より大きい有限値で指定してください。');
  }

  const nextItem = { ...item };
  scalableNutritionKeys.forEach((key) => {
    nextItem[key] = roundToTenth(item[key] * multiplier);
  });
  return nextItem;
}

export function scaleNutritionItemAt(
  items: NutritionItem[],
  index: number,
  multiplier: number,
): NutritionItem[] {
  return items.map((item, itemIndex) => (
    itemIndex === index ? scaleNutritionItem(item, multiplier) : item
  ));
}

function roundToTenth(value: number): number {
  return Math.round(value * 10) / 10;
}
