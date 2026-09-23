import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

const source = await readFile(new URL('../src/nutritionItemEditing.ts', import.meta.url), 'utf8');
const appSource = await readFile(new URL('../src/App.tsx', import.meta.url), 'utf8');
const transpiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;
const moduleUrl = `data:text/javascript;charset=utf-8,${encodeURIComponent(transpiled)}`;
const editing = await import(moduleUrl);

const item = {
  name: 'パン',
  quantity_text: '2枚',
  basis: '入力された分量',
  calories_kcal: 300,
  protein_g: 12,
  fat_g: 6,
  carbs_g: 48,
};

function appFunction(name, nextName) {
  const start = appSource.indexOf(`function ${name}(`);
  const end = nextName ? appSource.indexOf(`function ${nextName}(`, start) : appSource.length;
  assert.notEqual(start, -1, `${name} should exist in App.tsx`);
  assert.notEqual(end, -1, `${nextName} should follow ${name} in App.tsx`);
  return appSource.slice(start, end);
}

test('kcalの直接編集はPFCを変更しない', () => {
  assert.deepEqual(
    editing.updateNutritionItemValue(item, 'calories_kcal', 150),
    { ...item, calories_kcal: 150 },
  );
});

test('量を半分にすると対象品目のkcal/PFCだけが半分になる', () => {
  const other = { ...item, name: '牛乳', calories_kcal: 100 };
  const result = editing.scaleNutritionItemAt([item, other], 0, 0.5);

  assert.deepEqual(result[0], {
    ...item,
    calories_kcal: 150,
    protein_g: 6,
    fat_g: 3,
    carbs_g: 24,
  });
  assert.strictEqual(result[1], other);
  assert.deepEqual(editing.calculateNutritionTotal(result), {
    calories_kcal: 250,
    protein_g: 18,
    fat_g: 9,
    carbs_g: 72,
  });
});

test('kcalを300から150へ直して保存し、編集時に読み戻しても150を保持する', () => {
  const edited = editing.updateNutritionItemValue(item, 'calories_kcal', 150);
  const savedJson = editing.serializeNutritionItems([edited]);
  const reloaded = editing.parseNutritionItems(savedJson);

  assert.equal(reloaded[0].calories_kcal, 150);
  assert.equal(editing.calculateNutritionTotal(reloaded).calories_kcal, 150);
  assert.match(appFunction('buildPayload', 'buildQuickPayload'), /serializeNutritionItems\(items\)/);
  assert.match(appFunction('loadMealForEdit', 'showQuickUndo'), /parseBreakdownItems\(meal\.breakdown_json\)/);
});

test('繰り返しの量調整は現在値に適用され、保存・再読込時に倍率を隠して持ち越さない', () => {
  const half = editing.scaleNutritionItem(item, 0.5);
  const savedJson = editing.serializeNutritionItems([half]);
  const reloaded = editing.parseNutritionItems(savedJson);
  const quarter = editing.scaleNutritionItem(reloaded[0], 0.5);

  assert.equal(half.calories_kcal, 150);
  assert.equal(reloaded[0].calories_kcal, 150);
  assert.equal(quarter.calories_kcal, 75);
  assert.equal(editing.calculateNutritionTotal([quarter]).calories_kcal, 75);
  assert.doesNotMatch(appSource, /\bservings\b|applyServings|updateServing/);
});

test('AI由来のkcal直接編集・量調整はapi_editedとなり、manualはmanualのまま', () => {
  const snapshot = editing.createNutritionSnapshot([item]);
  const kcalEdited = editing.updateNutritionItemValue(item, 'calories_kcal', 150);
  const scaled = editing.scaleNutritionItem(item, 0.5);

  assert.equal(editing.resolveMealSource('api', snapshot, [kcalEdited], 'api'), 'api_edited');
  assert.equal(editing.resolveMealSource('api', snapshot, [scaled], 'api'), 'api_edited');
  assert.equal(editing.resolveMealSource('manual', null, [kcalEdited], 'manual'), 'manual');
  assert.equal(editing.resolveMealSource('api', snapshot, [item], 'api_edited'), 'api_edited');
});

test('分量文字列だけの変更は栄養値・合計を変えない', () => {
  const edited = editing.updateNutritionItemQuantity(item, '1枚');

  assert.equal(edited.quantity_text, '1枚');
  assert.deepEqual(editing.calculateNutritionTotal([edited]), editing.calculateNutritionTotal([item]));
  assert.match(appFunction('updateItemQuantity', 'updateItemNutrition'), /updateNutritionItemQuantity/);
  assert.doesNotMatch(appFunction('updateItemQuantity', 'updateItemNutrition'), /setTotal\(/);
});

test('数値入力の空欄・負数・全角数字は安全側の0に正規化する', () => {
  assert.equal(editing.normalizeNutritionNumber(''), 0);
  assert.equal(editing.normalizeNutritionNumber('-1'), 0);
  assert.equal(editing.normalizeNutritionNumber('１５０'), 0);
});

test('編集画面は隠れた人前倍率を持たず、表示中の品目値を保存する', () => {
  assert.doesNotMatch(appSource, /\bservings\b|applyServings|updateServing/);
  assert.match(appSource, /breakdown_json: serializeNutritionItems\(items\)/);
});
