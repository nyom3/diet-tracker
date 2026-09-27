import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

const source = await readFile(new URL('../src/mealDraft.ts', import.meta.url), 'utf8');
const editingSource = await readFile(new URL('../src/nutritionItemEditing.ts', import.meta.url), 'utf8');
const transpiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;
const editingTranspiled = ts.transpileModule(editingSource, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;
const mealDraft = await import(`data:text/javascript;charset=utf-8,${encodeURIComponent(transpiled)}`);
const editing = await import(`data:text/javascript;charset=utf-8,${encodeURIComponent(editingTranspiled)}`);

const item = {
  name: 'パン',
  quantity_text: '2枚',
  basis: '入力された分量',
  calories_kcal: 300,
  protein_g: 12,
  fat_g: 6,
  carbs_g: 48,
};

function createDraft(overrides = {}) {
  return {
    mealType: '昼',
    datetime: '2026-09-27T12:00',
    inputMode: 'text',
    mealText: 'パン',
    photoNote: '',
    displayName: '昼食',
    items: [{ ...item, baseValues: { ...item }, scaleFactor: 1.5 }],
    total: { calories_kcal: 450, protein_g: 18, fat_g: 9, carbs_g: 72 },
    estimateMode: 'api',
    apiEstimateSnapshot: {
      items: [{ ...item }],
    },
    persistedSource: 'api_edited',
    hasItemBreakdown: true,
    standaloneTotalActive: false,
    standaloneItemAdded: false,
    hasNutrition: true,
    selectedMealId: 'meal_1',
    savedMealFingerprint: {
      timestamp: '2026-09-27T12:00:00.000+09:00',
      meal_type: '昼',
      description: '昼食',
      calories_kcal: 300,
      protein_g: 12,
      fat_g: 6,
      carbs_g: 48,
      source: 'api',
      breakdown_json: JSON.stringify([item]),
    },
    ...overrides,
  };
}

test('新規枠と編集枠を分離し、api snapshotと倍率を往復する', () => {
  const store = mealDraft.putMealDraft(
    mealDraft.putMealDraft(mealDraft.createEmptyMealDraftStore(), { ...createDraft(), selectedMealId: null, savedMealFingerprint: null }),
    createDraft(),
  );
  const restored = mealDraft.parseMealDraftStore(mealDraft.serializeMealDraftStore(store), null);

  assert.equal(restored.active, 'edit');
  assert.equal(restored.newDraft.displayName, '昼食');
  assert.equal(restored.editDraft.selectedMealId, 'meal_1');
  assert.equal(restored.editDraft.items[0].scaleFactor, 1.5);
  assert.equal(restored.editDraft.items[0].baseValues.calories_kcal, 300);
  assert.equal(restored.editDraft.apiEstimateSnapshot.items[0].name, 'パン');
  assert.equal(restored.editDraft.persistedSource, 'api_edited');
});

test('v1形式は新規下書きとして移行し、破損JSONは空状態にする', () => {
  const legacy = JSON.stringify({
    mealType: '朝',
    datetime: '2026-09-27T08:00',
    inputMode: 'text',
    mealText: 'おにぎり',
    photoNote: '',
    displayName: '朝食',
  });
  const migrated = mealDraft.parseMealDraftStore(null, legacy);
  const broken = mealDraft.parseMealDraftStore('{broken', null);

  assert.equal(migrated.active, 'new');
  assert.equal(migrated.newDraft.displayName, '朝食');
  assert.deepEqual(migrated.newDraft.items, []);
  assert.equal(migrated.newDraft.hasNutrition, false);
  assert.equal(broken.active, null);
  assert.equal(broken.newDraft, null);
});

test('倍率の型違い・範囲外とbaseValues欠落は表示値を基準値×1へ戻す', () => {
  const raw = JSON.stringify({
    version: 2,
    active: 'new',
    newDraft: {
      ...createDraft({ selectedMealId: null, savedMealFingerprint: null }),
      items: [
        { ...item, calories_kcal: 150.5, baseValues: { name: '欠落' }, scaleFactor: '2' },
        { ...item, calories_kcal: 200, baseValues: { ...item }, scaleFactor: 4 },
      ],
    },
    editDraft: null,
  });
  const restored = mealDraft.parseMealDraftStore(raw, null).newDraft;

  assert.equal(restored.items[0].calories_kcal, 151);
  assert.equal(restored.items[0].baseValues.calories_kcal, 151);
  assert.equal(restored.items[0].scaleFactor, 1);
  assert.equal(restored.items[1].baseValues.calories_kcal, 200);
  assert.equal(restored.items[1].scaleFactor, 1);
});

test('指紋比較はGASのnull欠落と数値文字列化を正規化し、実変更は検知する', () => {
  const expected = createDraft().savedMealFingerprint;
  const actual = {
    ...expected,
    calories_kcal: '300',
    protein_g: '12',
    fat_g: '6',
    carbs_g: '48',
  };
  const changed = { ...actual, description: '変更後' };

  assert.equal(mealDraft.savedMealFingerprintEqual(expected, actual), true);
  assert.equal(mealDraft.savedMealFingerprintEqual(expected, changed), false);
  assert.equal(mealDraft.savedMealFingerprintEqual(expected, { ...actual, breakdown_json: null }), false);
});

test('対象日の取得キーはJSTで作り、写真や画像データを下書きに含めない', () => {
  const draft = createDraft({ inputMode: 'photo', photoNote: 'ご飯少なめ' });
  const serialized = mealDraft.serializeMealDraftStore(
    mealDraft.putMealDraft(mealDraft.createEmptyMealDraftStore(), { ...draft, selectedMealId: null, savedMealFingerprint: null }),
  );

  assert.equal(mealDraft.getMealSnapshotDate('2026-09-26T16:00:00.000Z'), '2026-09-27');
  assert.match(serialized, /photoNote/);
  assert.doesNotMatch(serialized, /base64|previewUrl|apiResponse/);
});

test('保存したapi snapshotを使ってapi_edited判定を維持する', () => {
  const draft = createDraft({
    persistedSource: 'api',
    items: [{ ...item, calories_kcal: 450, baseValues: { ...item }, scaleFactor: 1.5 }],
    apiEstimateSnapshot: { items: [{ ...item }] },
  });
  const restored = mealDraft.parseMealDraftStore(
    mealDraft.serializeMealDraftStore(mealDraft.putMealDraft(mealDraft.createEmptyMealDraftStore(), draft)),
    null,
  ).editDraft;

  assert.equal(
    editing.resolveMealSource('api', restored.apiEstimateSnapshot, restored.items, restored.persistedSource),
    'api_edited',
  );
});
