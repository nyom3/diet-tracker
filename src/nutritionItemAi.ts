import type { NutritionItem } from './types';

export function replaceNutritionItemAt<T extends NutritionItem>(
  items: T[],
  index: number,
  nextItem: T,
): T[] {
  if (!Number.isInteger(index) || index < 0 || index >= items.length) {
    throw new Error('品目の位置が不正です。');
  }

  return items.map((item, itemIndex) => itemIndex === index ? nextItem : item);
}

export function appendNutritionItem<T extends NutritionItem>(items: T[], nextItem: T): T[] {
  return [...items, nextItem];
}
