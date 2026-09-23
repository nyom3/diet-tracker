import type { EstimateMode, MealSource, NutritionItem, NutritionKey, NutritionTotal } from './types';

export type NutritionSnapshot = {
  items: Array<Pick<NutritionItem, 'name' | 'quantity_text' | 'calories_kcal' | 'protein_g' | 'fat_g' | 'carbs_g'>>;
};

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

export function updateNutritionItemQuantity(item: NutritionItem, quantityText: string): NutritionItem {
  return { ...item, quantity_text: quantityText };
}

export function normalizeNutritionNumber(value: unknown): number {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) && numberValue >= 0 ? numberValue : 0;
}

export function normalizeNutritionItem(item: Partial<NutritionItem>): NutritionItem {
  return {
    name: String(item.name || '品名未設定'),
    // Keep the server-side truncation visible before saving, so reloads do not change the display.
    quantity_text: String(item.quantity_text || '').trim(),
    basis: String(item.basis || '').trim().slice(0, 40),
    calories_kcal: normalizeNutritionNumber(item.calories_kcal),
    protein_g: normalizeNutritionNumber(item.protein_g),
    fat_g: normalizeNutritionNumber(item.fat_g),
    carbs_g: normalizeNutritionNumber(item.carbs_g),
  };
}

export function calculateNutritionTotal(items: NutritionItem[]): NutritionTotal {
  return items.reduce<NutritionTotal>(
    (sum, item) => ({
      calories_kcal: Math.round(sum.calories_kcal + item.calories_kcal),
      protein_g: roundToTenth(sum.protein_g + item.protein_g),
      fat_g: roundToTenth(sum.fat_g + item.fat_g),
      carbs_g: roundToTenth(sum.carbs_g + item.carbs_g),
    }),
    { calories_kcal: 0, protein_g: 0, fat_g: 0, carbs_g: 0 },
  );
}

export function createNutritionSnapshot(items: NutritionItem[]): NutritionSnapshot {
  return {
    items: items.map(({ name, quantity_text, calories_kcal, protein_g, fat_g, carbs_g }) => ({
      name,
      quantity_text,
      calories_kcal,
      protein_g,
      fat_g,
      carbs_g,
    })),
  };
}

export function hasNutritionSnapshotChanged(
  snapshot: NutritionSnapshot | null,
  items: NutritionItem[],
): boolean {
  if (!snapshot) return false;
  return JSON.stringify(createNutritionSnapshot(items)) !== JSON.stringify(snapshot);
}

export function resolveMealSource(
  estimateMode: EstimateMode,
  snapshot: NutritionSnapshot | null,
  items: NutritionItem[],
  persistedSource: MealSource | null,
): MealSource {
  if (estimateMode === 'manual') return 'manual';
  if (persistedSource === 'api_edited') return 'api_edited';
  return hasNutritionSnapshotChanged(snapshot, items) ? 'api_edited' : 'api';
}

export function serializeNutritionItems(items: NutritionItem[]): string {
  return JSON.stringify(items);
}

export function parseNutritionItems(breakdownJson: string): NutritionItem[] {
  try {
    const parsed = JSON.parse(breakdownJson);
    const rawItems = Array.isArray(parsed) ? parsed : parsed.items;
    return Array.isArray(rawItems) ? rawItems.map(normalizeNutritionItem) : [];
  } catch {
    return [];
  }
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
