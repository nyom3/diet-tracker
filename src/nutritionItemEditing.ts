import type { EstimateMode, MealSource, NutritionItem, NutritionKey, NutritionTotal } from './types';

export type NutritionSnapshot = {
  items: Array<Pick<NutritionItem, 'name' | 'quantity_text' | 'calories_kcal' | 'protein_g' | 'fat_g' | 'carbs_g'>>;
};

export type NutritionItemEditState = NutritionItem & {
  baseValues: NutritionItem;
  scaleFactor: number;
};

const scalableNutritionKeys: readonly NutritionKey[] = [
  'calories_kcal',
  'protein_g',
  'fat_g',
  'carbs_g',
];

export function updateNutritionItemValue(
  item: NutritionItemEditState,
  key: NutritionKey,
  value: number,
): NutritionItemEditState;
export function updateNutritionItemValue(
  item: NutritionItem,
  key: NutritionKey,
  value: number,
): NutritionItem;
export function updateNutritionItemValue(
  item: NutritionItem,
  key: NutritionKey,
  value: number,
): NutritionItem {
  const nextItem = normalizeNutritionItem({ ...item, [key]: value });
  return isNutritionItemEditState(item) ? createNutritionItemEditState(nextItem) : nextItem;
}

export function updateNutritionItemQuantity(item: NutritionItemEditState, quantityText: string): NutritionItemEditState;
export function updateNutritionItemQuantity(item: NutritionItem, quantityText: string): NutritionItem;
export function updateNutritionItemQuantity(item: NutritionItem, quantityText: string): NutritionItem {
  const nextItem = { ...getDisplayedNutritionItem(item), quantity_text: quantityText };
  if (!isNutritionItemEditState(item)) return nextItem;
  return {
    ...nextItem,
    baseValues: { ...item.baseValues, quantity_text: quantityText },
    scaleFactor: item.scaleFactor,
  } as NutritionItemEditState;
}

export function updateNutritionItemName(item: NutritionItemEditState, name: string): NutritionItemEditState;
export function updateNutritionItemName(item: NutritionItem, name: string): NutritionItem;
export function updateNutritionItemName(item: NutritionItem, name: string): NutritionItem {
  const nextItem = { ...getDisplayedNutritionItem(item), name };
  if (!isNutritionItemEditState(item)) return nextItem;
  return {
    ...nextItem,
    baseValues: { ...item.baseValues, name },
    scaleFactor: item.scaleFactor,
  } as NutritionItemEditState;
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
    calories_kcal: Math.round(normalizeNutritionNumber(item.calories_kcal)),
    protein_g: roundToTenth(normalizeNutritionNumber(item.protein_g)),
    fat_g: roundToTenth(normalizeNutritionNumber(item.fat_g)),
    carbs_g: roundToTenth(normalizeNutritionNumber(item.carbs_g)),
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
    items: items.map((item) => {
      const displayedItem = getDisplayedNutritionItem(item);
      return {
        name: displayedItem.name,
        quantity_text: displayedItem.quantity_text,
        calories_kcal: displayedItem.calories_kcal,
        protein_g: displayedItem.protein_g,
        fat_g: displayedItem.fat_g,
        carbs_g: displayedItem.carbs_g,
      };
    }),
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
  return JSON.stringify(items.map(getDisplayedNutritionItem));
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

  const baseItem = normalizeNutritionItem(item);
  const nextItem = { ...baseItem };
  scalableNutritionKeys.forEach((key) => {
    nextItem[key] = key === 'calories_kcal'
      ? Math.round(baseItem[key] * multiplier)
      : roundToTenth(baseItem[key] * multiplier);
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

export function createNutritionItemEditState(
  item: Partial<NutritionItem>,
  scaleFactor = 1,
): NutritionItemEditState {
  return createNutritionItemEditStateWithScale(item, scaleFactor, true);
}

export function scaleNutritionItemAtState(
  items: NutritionItemEditState[],
  index: number,
  scaleFactor: number,
): NutritionItemEditState[] {
  return items.map((item, itemIndex) => (
    itemIndex === index
      ? createNutritionItemEditStateWithScale(item.baseValues, scaleFactor, true)
      : item
  ));
}

export function multiplyNutritionItemScaleAtState(
  items: NutritionItemEditState[],
  index: number,
  multiplier: number,
): NutritionItemEditState[] {
  if (!Number.isFinite(multiplier) || multiplier <= 0) {
    throw new RangeError('栄養値の倍率は0より大きい有限値で指定してください。');
  }
  const currentScaleFactor = items[index]?.scaleFactor ?? 1;
  const nextScaleFactor = currentScaleFactor * multiplier;
  if (!isScaleFactorInRange(nextScaleFactor)) return items;

  return items.map((item, itemIndex) => (
    itemIndex === index
      ? createNutritionItemEditStateWithScale(item.baseValues, nextScaleFactor, false)
      : item
  ));
}

export function getDisplayedNutritionItem(item: NutritionItem): NutritionItem {
  return normalizeNutritionItem(item);
}

function isNutritionItemEditState(item: NutritionItem): item is NutritionItemEditState {
  return 'baseValues' in item && 'scaleFactor' in item;
}

function createNutritionItemEditStateWithScale(
  item: Partial<NutritionItem>,
  scaleFactor: number,
  roundScale: boolean,
): NutritionItemEditState {
  const baseValues = normalizeNutritionItem(item);
  const normalizedScaleFactor = normalizeScaleFactor(scaleFactor, roundScale);
  return {
    ...scaleNutritionItem(baseValues, normalizedScaleFactor),
    baseValues,
    scaleFactor: normalizedScaleFactor,
  };
}

function normalizeScaleFactor(value: number, roundScale: boolean): number {
  if (!isScaleFactorInRange(value)) {
    throw new RangeError('栄養値の倍率は0.1〜3.0の範囲で指定してください。');
  }
  return roundScale ? roundToTenth(value) : value;
}

function isScaleFactorInRange(value: number): boolean {
  return Number.isFinite(value) && value >= 0.1 && value <= 3;
}

function roundToTenth(value: number): number {
  return Math.round(value * 10) / 10;
}
