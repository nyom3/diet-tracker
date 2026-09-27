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

test('再現: 奇数kcalの半分が小数にならず、PFCの丸め誤差を累積させない', () => {
  const oddKcalItem = { ...item, calories_kcal: 301, protein_g: 12.34 };
  const initial = editing.createNutritionItemEditState(oddKcalItem);
  const half = editing.scaleNutritionItemAtState([initial], 0, 0.5)[0];
  const restored = editing.scaleNutritionItemAtState([half], 0, 1)[0];
  const doubled = editing.multiplyNutritionItemScaleAtState([half], 0, 2)[0];

  assert.equal(half.calories_kcal, 151);
  assert.equal(restored.calories_kcal, 301);
  assert.equal(restored.protein_g, 12.3);
  assert.equal(restored.scaleFactor, 1);
  assert.equal(doubled.calories_kcal, 301);
  assert.equal(doubled.protein_g, 12.3);
  assert.equal(doubled.scaleFactor, 1);
});

test('相対倍率は小数を保持し、半分と2倍を往復できる', () => {
  const initial = editing.createNutritionItemEditState(item);
  const oneAndHalf = editing.scaleNutritionItemAtState([initial], 0, 1.5)[0];
  const half = editing.multiplyNutritionItemScaleAtState([oneAndHalf], 0, 0.5)[0];
  const restored = editing.multiplyNutritionItemScaleAtState([half], 0, 2)[0];

  assert.equal(half.scaleFactor, 0.75);
  assert.equal(restored.scaleFactor, 1.5);
  assert.equal(restored.calories_kcal, oneAndHalf.calories_kcal);
  assert.equal(restored.protein_g, oneAndHalf.protein_g);
});

test('相対倍率が範囲外になる操作は状態を変更せず例外にしない', () => {
  const initial = editing.createNutritionItemEditState(item, 1.6);
  const items = [initial];
  const unchanged = editing.multiplyNutritionItemScaleAtState(items, 0, 2);

  assert.strictEqual(unchanged, items);
  assert.equal(unchanged[0].scaleFactor, 1.6);
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

test('保存後の再読込は表示値を基準値とし、倍率を隠して持ち越さない', () => {
  const initial = editing.createNutritionItemEditState(item);
  const half = editing.scaleNutritionItemAtState([initial], 0, 0.5)[0];
  const savedJson = editing.serializeNutritionItems([half]);
  const reloaded = editing.parseNutritionItems(savedJson);
  const reloadedState = editing.createNutritionItemEditState(reloaded[0]);
  const quarter = editing.scaleNutritionItemAtState([reloadedState], 0, 0.5)[0];

  assert.equal(half.calories_kcal, 150);
  assert.equal(reloaded[0].calories_kcal, 150);
  assert.equal(reloadedState.scaleFactor, 1);
  assert.equal(quarter.calories_kcal, 75);
  assert.equal(editing.calculateNutritionTotal([quarter]).calories_kcal, 75);
  assert.equal(JSON.parse(savedJson)[0].scaleFactor, undefined);
  assert.equal(JSON.parse(savedJson)[0].baseValues, undefined);
  assert.doesNotMatch(appSource, /\bservings\b|applyServings|updateServing/);
});

test('直接入力は表示値を新しい基準値にして倍率を1.0へ戻す', () => {
  const half = editing.scaleNutritionItemAtState([
    editing.createNutritionItemEditState(item),
  ], 0, 0.5)[0];
  const edited = editing.updateNutritionItemValue(half, 'calories_kcal', 120);
  const doubled = editing.scaleNutritionItemAtState([edited], 0, 2)[0];

  assert.equal(edited.calories_kcal, 120);
  assert.equal(edited.scaleFactor, 1);
  assert.equal(edited.baseValues.calories_kcal, 120);
  assert.equal(doubled.calories_kcal, 240);
});

test('品目の削除後も残った品目の基準値と倍率を保つ', () => {
  const first = editing.createNutritionItemEditState(item);
  const second = editing.createNutritionItemEditState({ ...item, name: '牛乳', calories_kcal: 200 });
  const adjusted = editing.scaleNutritionItemAtState([first, second], 1, 1.5);
  const remaining = adjusted.filter((_, index) => index === 1);
  const reset = editing.scaleNutritionItemAtState(remaining, 0, 1)[0];

  assert.equal(adjusted[1].scaleFactor, 1.5);
  assert.equal(reset.calories_kcal, 200);
  assert.equal(reset.scaleFactor, 1);
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

test('正規化済みの基準値へ倍率1.0を戻すとapiのスナップショットに一致する', () => {
  const normalized = editing.createNutritionItemEditState({ ...item, protein_g: 12.35 });
  const snapshot = editing.createNutritionSnapshot([normalized]);
  const reset = editing.scaleNutritionItemAtState([normalized], 0, 1)[0];

  assert.equal(reset.protein_g, 12.4);
  assert.equal(editing.resolveMealSource('api', snapshot, [reset], 'api'), 'api');
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

test('倍率は編集画面だけで保持し、表示中の品目値を保存する', () => {
  assert.doesNotMatch(appSource, /\bservings\b|applyServings|updateServing/);
  assert.match(appSource, /multiplyItemScale/);
  assert.match(appSource, /scaleFactor/);
  assert.match(appSource, /現在の½/);
  assert.match(appSource, /×1\.5/);
  assert.match(appSource, /現在の2倍/);
  assert.match(appSource, /元に戻す（×1\.0）/);
  assert.match(appSource, /breakdown_json: serializeNutritionItems\(items\)/);
});

test('品目編集状態の生成関数をmapへ直接渡してindexを倍率にしない', () => {
  assert.doesNotMatch(appSource, /\.map\(createNutritionItemEditState\)/);
  assert.match(appSource, /\.map\(\(item\) => createNutritionItemEditState\(item\)\)/);
});
