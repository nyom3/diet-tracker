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
});

test('保存後に再編集しても倍率を隠れて二重適用しない', () => {
  const half = editing.scaleNutritionItem(item, 0.5);
  const reloaded = { ...half };

  assert.equal(reloaded.calories_kcal, 150);
  assert.deepEqual(editing.scaleNutritionItem(reloaded, 0.5), {
    ...item,
    calories_kcal: 75,
    protein_g: 3,
    fat_g: 1.5,
    carbs_g: 12,
  });
});

test('編集画面は隠れた人前倍率を持たず、表示中の品目値を保存する', () => {
  assert.doesNotMatch(appSource, /\bservings\b|applyServings|updateServing/);
  assert.match(appSource, /breakdown_json: JSON\.stringify\(items\)/);
});
