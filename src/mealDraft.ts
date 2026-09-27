import type {
  EstimateMode,
  InputMode,
  MealSource,
  MealType,
  NutritionItem,
  NutritionTotal,
  SavedMeal,
} from './types';
import type { NutritionItemEditState, NutritionSnapshot } from './nutritionItemEditing';

export const mealDraftStorageKey = 'diet-tracker-meal-draft-v2';
export const legacyMealDraftStorageKey = 'diet-tracker-meal-draft-v1';

export type SavedMealFingerprint = Pick<
  SavedMeal,
  'timestamp' | 'meal_type' | 'description' | 'calories_kcal' | 'protein_g' | 'fat_g' | 'carbs_g' | 'source' | 'breakdown_json'
>;

export type MealDraftData = {
  mealType: MealType;
  datetime: string;
  inputMode: InputMode;
  mealText: string;
  photoNote: string;
  displayName: string;
  items: NutritionItemEditState[];
  total: NutritionTotal;
  estimateMode: EstimateMode;
  apiEstimateSnapshot: NutritionSnapshot | null;
  persistedSource: MealSource | null;
  hasItemBreakdown: boolean;
  standaloneTotalActive: boolean;
  standaloneItemAdded: boolean;
  hasNutrition: boolean;
  selectedMealId: string | null;
  savedMealFingerprint: SavedMealFingerprint | null;
};

export type MealDraftStore = {
  version: 2;
  active: 'new' | 'edit' | null;
  newDraft: MealDraftData | null;
  editDraft: MealDraftData | null;
};

export type MealDraftResetResult = {
  store: MealDraftStore;
  draftToRestore: MealDraftData | null;
};

const mealTypes: MealType[] = ['朝', '昼', '夜', '間食'];
const nutritionKeys: Array<keyof NutritionItem> = [
  'calories_kcal',
  'protein_g',
  'fat_g',
  'carbs_g',
];

export function createEmptyMealDraftStore(): MealDraftStore {
  return {
    version: 2,
    active: null,
    newDraft: null,
    editDraft: null,
  };
}

export function parseMealDraftStore(rawV2: string | null, rawV1: string | null): MealDraftStore {
  const parsedV2 = parseJson(rawV2);
  if (isRecord(parsedV2) && parsedV2.version === 2) {
    return normalizeStore(parsedV2);
  }

  const parsedV1 = parseJson(rawV1);
  if (isRecord(parsedV1)) {
    const legacyDraft = normalizeDraft(parsedV1, null);
    return {
      version: 2,
      active: 'new',
      newDraft: legacyDraft,
      editDraft: null,
    };
  }

  return createEmptyMealDraftStore();
}

export function serializeMealDraftStore(store: MealDraftStore): string {
  return JSON.stringify(store);
}

export function putMealDraft(store: MealDraftStore, draft: MealDraftData): MealDraftStore {
  if (draft.selectedMealId) {
    return {
      ...store,
      version: 2,
      active: 'edit',
      editDraft: draft,
    };
  }

  return {
    ...store,
    version: 2,
    active: 'new',
    newDraft: draft,
  };
}

export function clearMealDraftSlot(store: MealDraftStore, slot: 'new' | 'edit'): MealDraftStore {
  const nextStore: MealDraftStore = {
    ...store,
    newDraft: slot === 'new' ? null : store.newDraft,
    editDraft: slot === 'edit' ? null : store.editDraft,
  };

  if (nextStore.active === slot) {
    nextStore.active = nextStore.newDraft ? 'new' : nextStore.editDraft ? 'edit' : null;
  }

  return nextStore;
}

export function prepareMealDraftReset(
  store: MealDraftStore,
  slot: 'new' | 'edit',
  restoreNewDraft: boolean,
): MealDraftResetResult {
  const clearedStore = clearMealDraftSlot(store, slot);
  if (slot === 'edit' && restoreNewDraft && clearedStore.newDraft) {
    return {
      store: { ...clearedStore, active: 'new' },
      draftToRestore: clearedStore.newDraft,
    };
  }

  return {
    store: {
      ...clearedStore,
      active: clearedStore.newDraft ? 'new' : clearedStore.editDraft ? 'edit' : null,
    },
    draftToRestore: null,
  };
}

export function canRestoreEditDraft(
  store: MealDraftStore,
  draft: MealDraftData,
  restoreGeneration: number,
  currentGeneration: number,
): boolean {
  return restoreGeneration === currentGeneration && store.editDraft === draft;
}

export function createSavedMealFingerprint(meal: SavedMeal): SavedMealFingerprint {
  return normalizeFingerprint(meal);
}

export function savedMealFingerprintEqual(
  expected: SavedMealFingerprint | null,
  actual: SavedMealFingerprint | null,
): boolean {
  if (!expected || !actual) return false;
  return JSON.stringify(normalizeFingerprint(expected)) === JSON.stringify(normalizeFingerprint(actual));
}

export function getMealSnapshotDate(timestamp: string, timeZone = 'Asia/Tokyo'): string | null {
  const parsed = new Date(timestamp);
  if (Number.isNaN(parsed.getTime())) return null;

  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(parsed);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  if (!values.year || !values.month || !values.day) return null;
  return `${values.year}-${values.month}-${values.day}`;
}

function normalizeStore(raw: Record<string, unknown>): MealDraftStore {
  const parsedNewDraft = normalizeDraft(raw.newDraft, null);
  const newDraft = parsedNewDraft
    ? { ...parsedNewDraft, selectedMealId: null, savedMealFingerprint: null }
    : null;
  const editDraft = normalizeDraft(raw.editDraft, null);
  const active = raw.active === 'new' || raw.active === 'edit'
    ? raw.active
    : editDraft?.selectedMealId
      ? 'edit'
      : newDraft
        ? 'new'
        : null;

  return {
    version: 2,
    active: active === 'edit' && !editDraft?.selectedMealId
      ? newDraft ? 'new' : null
      : active === 'new' && !newDraft
        ? editDraft?.selectedMealId ? 'edit' : null
        : active,
    newDraft,
    editDraft: editDraft?.selectedMealId ? editDraft : null,
  };
}

function normalizeDraft(value: unknown, selectedMealId: string | null): MealDraftData | null {
  if (!isRecord(value)) return null;

  const items = normalizeItems(value.items);
  const draftSelectedMealId = readNonEmptyString(value.selectedMealId) || selectedMealId;
  const rawFingerprint = isRecord(value.savedMealFingerprint) ? value.savedMealFingerprint : null;

  return {
    mealType: mealTypes.includes(value.mealType as MealType) ? value.mealType as MealType : '間食',
    datetime: readString(value.datetime),
    inputMode: value.inputMode === 'text' ? 'text' : 'photo',
    mealText: readString(value.mealText),
    photoNote: readString(value.photoNote),
    displayName: readString(value.displayName),
    items,
    total: normalizeTotal(value.total),
    estimateMode: value.estimateMode === 'manual' ? 'manual' : 'api',
    apiEstimateSnapshot: normalizeSnapshot(value.apiEstimateSnapshot),
    persistedSource: normalizeMealSource(value.persistedSource),
    hasItemBreakdown: typeof value.hasItemBreakdown === 'boolean' ? value.hasItemBreakdown : items.length > 0,
    standaloneTotalActive: value.standaloneTotalActive === true,
    standaloneItemAdded: value.standaloneItemAdded === true,
    hasNutrition: value.hasNutrition === true,
    selectedMealId: draftSelectedMealId,
    savedMealFingerprint: rawFingerprint ? normalizeFingerprint(rawFingerprint) : null,
  };
}

function normalizeItems(value: unknown): NutritionItemEditState[] {
  if (!Array.isArray(value)) return [];
  return value.filter(isRecord).map((item) => {
    const displayed = normalizeNutritionItem(item);
    const scaleFactor = item.scaleFactor;
    const rawBaseValues = isRecord(item.baseValues) ? item.baseValues : null;
    const hasValidBaseValues = rawBaseValues !== null && hasAllNutritionItemFields(rawBaseValues);
    const baseValues = hasValidBaseValues
      ? normalizeNutritionItem(rawBaseValues)
      : displayed;
    const hasValidScale = typeof scaleFactor === 'number'
      && Number.isFinite(scaleFactor)
      && scaleFactor >= 0.1
      && scaleFactor <= 3;

    if (!hasValidScale || !hasValidBaseValues) {
      return {
        ...displayed,
        baseValues: { ...displayed },
        scaleFactor: 1,
      };
    }

    return {
      ...displayed,
      baseValues,
      scaleFactor,
    };
  });
}

function normalizeNutritionItem(value: Record<string, unknown>): NutritionItem {
  return {
    name: String(value.name || '品名未設定'),
    quantity_text: String(value.quantity_text || '').trim(),
    basis: String(value.basis || '').trim().slice(0, 40),
    calories_kcal: Math.round(normalizeNumber(value.calories_kcal)),
    protein_g: roundToTenth(normalizeNumber(value.protein_g)),
    fat_g: roundToTenth(normalizeNumber(value.fat_g)),
    carbs_g: roundToTenth(normalizeNumber(value.carbs_g)),
  };
}

function hasAllNutritionItemFields(value: Record<string, unknown>): boolean {
  return ['name', 'quantity_text', 'basis', ...nutritionKeys].every((key) => Object.prototype.hasOwnProperty.call(value, key));
}

function normalizeTotal(value: unknown): NutritionTotal {
  const source = isRecord(value) ? value : {};
  return {
    calories_kcal: Math.round(normalizeNumber(source.calories_kcal)),
    protein_g: roundToTenth(normalizeNumber(source.protein_g)),
    fat_g: roundToTenth(normalizeNumber(source.fat_g)),
    carbs_g: roundToTenth(normalizeNumber(source.carbs_g)),
  };
}

function normalizeSnapshot(value: unknown): NutritionSnapshot | null {
  if (!isRecord(value) || !Array.isArray(value.items)) return null;
  return {
    items: value.items.filter(isRecord).map((item) => {
      const normalized = normalizeNutritionItem(item);
      return {
        name: normalized.name,
        quantity_text: normalized.quantity_text,
        calories_kcal: normalized.calories_kcal,
        protein_g: normalized.protein_g,
        fat_g: normalized.fat_g,
        carbs_g: normalized.carbs_g,
      };
    }),
  };
}

function normalizeMealSource(value: unknown): MealSource | null {
  return value === 'api' || value === 'manual' || value === 'api_edited' ? value : null;
}

function normalizeFingerprint(value: Record<string, unknown>): SavedMealFingerprint {
  return {
    timestamp: readString(value.timestamp),
    meal_type: mealTypes.includes(value.meal_type as MealType) ? value.meal_type as MealType : '間食',
    description: readString(value.description),
    calories_kcal: normalizeNumber(value.calories_kcal),
    protein_g: normalizeNumber(value.protein_g),
    fat_g: normalizeNumber(value.fat_g),
    carbs_g: normalizeNumber(value.carbs_g),
    source: value.source === 'api' || value.source === 'manual' || value.source === 'api_edited'
      ? value.source
      : 'manual',
    breakdown_json: readString(value.breakdown_json),
  };
}

function normalizeNumber(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

function roundToTenth(value: number): number {
  return Math.round(value * 10) / 10;
}

function readString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function readNonEmptyString(value: unknown): string | null {
  const stringValue = readString(value).trim();
  return stringValue ? stringValue : null;
}

function parseJson(value: string | null): unknown {
  if (!value) return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
