import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

const source = await readFile(new URL('../src/saveReason.ts', import.meta.url), 'utf8');
const transpiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 },
}).outputText;
const moduleUrl = `data:text/javascript;charset=utf-8,${encodeURIComponent(transpiled)}`;
const { getSaveBlockedReason } = await import(moduleUrl);

const validTotal = {
  calories_kcal: 650,
  protein_g: 25,
  fat_g: 18,
  carbs_g: 92,
};

function validInput(overrides = {}) {
  return {
    inputMode: 'text',
    hasPhoto: false,
    estimationInput: '牛丼',
    estimateMode: 'api',
    hasNutrition: true,
    description: '牛丼',
    total: validTotal,
    ...overrides,
  };
}

test('不足条件を操作順の最初の1件だけ返す', () => {
  assert.equal(
    getSaveBlockedReason(validInput({ estimationInput: '', hasNutrition: false, description: '', total: { ...validTotal, protein_g: -1 } })),
    '食事内容または写真を入力してください',
  );
});

test('写真または写真補足がある場合は入力済みと判定する', () => {
  assert.equal(getSaveBlockedReason(validInput({ inputMode: 'photo', estimationInput: '', hasPhoto: true })), null);
  assert.equal(getSaveBlockedReason(validInput({ inputMode: 'photo', estimationInput: 'ご飯少なめ', hasPhoto: false })), null);
});

test('APIと手動で栄養値不足の案内を分ける', () => {
  assert.equal(
    getSaveBlockedReason(validInput({ hasNutrition: false })),
    '先にカロリーとPFCを推定してください',
  );
  assert.equal(
    getSaveBlockedReason(validInput({ estimateMode: 'manual', hasNutrition: false })),
    'カロリーとPFCを入力してください',
  );
});

test('食事名と不正な栄養値を順に案内する', () => {
  assert.equal(getSaveBlockedReason(validInput({ description: '' })), '食事名を入力してください');
  assert.equal(
    getSaveBlockedReason(validInput({ total: { ...validTotal, fat_g: Number.NaN } })),
    '数値を確認してください',
  );
});

test('条件を満たすと案内を返さない', () => {
  assert.equal(getSaveBlockedReason(validInput()), null);
});
