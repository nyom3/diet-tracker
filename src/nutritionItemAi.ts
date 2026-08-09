import type { NutritionItem } from './types';

export function replaceNutritionItemAt(
  items: NutritionItem[],
  index: number,
  nextItem: NutritionItem,
): NutritionItem[] {
  if (!Number.isInteger(index) || index < 0 || index >= items.length) {
    throw new Error('品目の位置が不正です。');
  }

  return items.map((item, itemIndex) => itemIndex === index ? nextItem : item);
}

export function appendNutritionItem(items: NutritionItem[], nextItem: NutritionItem): NutritionItem[] {
  return [...items, nextItem];
}
