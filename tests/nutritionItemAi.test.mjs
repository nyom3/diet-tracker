import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';
import vm from 'node:vm';

const appSource = await readFile(new URL('../src/nutritionItemAi.ts', import.meta.url), 'utf8');
const transpiled = ts.transpileModule(appSource, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;
const moduleUrl = `data:text/javascript;charset=utf-8,${encodeURIComponent(transpiled)}`;
const itemAi = await import(moduleUrl);

const gasSource = await readFile(new URL('../gas/Code.gs', import.meta.url), 'utf8');

function extractFunction(source, name) {
  const start = source.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `${name} が見つかりません`);
  const bodyStart = source.indexOf('{', start);
  let depth = 0;
  for (let index = bodyStart; index < source.length; index += 1) {
    if (source[index] === '{') depth += 1;
    if (source[index] === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(start, index + 1);
    }
  }
  throw new Error(`${name} の終端が見つかりません`);
}

const gasContext = {};
vm.runInNewContext([
  'const NUTRITION_ITEM_AI_MAX_INSTRUCTION_LENGTH = 500;',
  'const NUTRITION_ITEM_AI_MAX_MEAL_DESCRIPTION_LENGTH = 500;',
  'const NUTRITION_ITEM_AI_MAX_EXISTING_ITEMS = 50;',
  'const NUTRITION_ITEM_AI_MAX_ITEM_NAME_LENGTH = 120;',
  'function getTrustedImageInfo() { return null; }',
  extractFunction(gasSource, 'validateNutritionItemAiRequest'),
  extractFunction(gasSource, 'normalizeSingleNutritionItem'),
  extractFunction(gasSource, 'normalizeNutritionItem'),
  extractFunction(gasSource, 'toNonNegativeNumber'),
  'this.validateNutritionItemAiRequest = validateNutritionItemAiRequest;',
  'this.normalizeSingleNutritionItem = normalizeSingleNutritionItem;',
].join('\n'), gasContext);

const item = {
  name: '鶏もも肉',
  quantity_text: '120g',
  basis: '入力された分量',
  calories_kcal: 250,
  protein_g: 25,
  fat_g: 15,
  carbs_g: 0,
};

test('品目AIの修正は対象品目だけを置換し、順序と他品目を維持する', () => {
  const other = { ...item, name: 'ご飯' };
  const replacement = { ...item, name: '皮なし鶏むね肉' };
  const result = itemAi.replaceNutritionItemAt([item, other], 0, replacement);

  assert.deepEqual(result, [replacement, other]);
  assert.strictEqual(result[1], other);
});

test('品目AIの追加は既存品目を変更せず末尾へ追加する', () => {
  const existing = [{ ...item }];
  const added = { ...item, name: 'わかめの味噌汁' };
  const result = itemAi.appendNutritionItem(existing, added);

  assert.deepEqual(result, [existing[0], added]);
  assert.strictEqual(result[0], existing[0]);
});

test('GAS境界は操作種別・指示長・品目数・PFC非負値を検証する', () => {
  const request = {
    operation: 'edit',
    instruction: '皮なし鶏むね肉に変更',
    item,
    meal_description: '定食',
    existing_item_names: ['鶏もも肉', 'ご飯'],
    image_base64: '',
  };
  const valid = gasContext.validateNutritionItemAiRequest(request);
  assert.equal(valid.operation, 'edit');
  assert.equal(valid.item.name, '鶏もも肉');

  assert.throws(
    () => gasContext.validateNutritionItemAiRequest({ ...request, instruction: 'x'.repeat(501) }),
    /1〜500文字/,
  );
  assert.throws(
    () => gasContext.validateNutritionItemAiRequest({
      ...request,
      item: { ...item, protein_g: -1 },
    }),
    /0以上/,
  );
  assert.throws(
    () => gasContext.validateNutritionItemAiRequest({
      ...request,
      existing_item_names: Array.from({ length: 51 }, () => '品目'),
    }),
    /件数/,
  );
});

test('GAS境界はAIの複数品目応答を拒否する', () => {
  assert.throws(
    () => gasContext.normalizeSingleNutritionItem({ items: [item, { ...item, name: 'ご飯' }] }),
    /複数品目/,
  );
  assert.deepEqual(
    JSON.parse(JSON.stringify(gasContext.normalizeSingleNutritionItem({ item }))),
    item,
  );
});
