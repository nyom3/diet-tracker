import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';
import vm from 'node:vm';

const source = await readFile(new URL('../src/imageProcessing.ts', import.meta.url), 'utf8');
const sourceWithoutImports = source
  .replace(/^import[^\n]*\n/gm, '');
const transpiled = ts.transpileModule(sourceWithoutImports, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText;
const moduleObject = { exports: {} };
vm.runInNewContext(transpiled, { module: moduleObject, exports: moduleObject.exports });
const { MAX_MEAL_IMAGES, readSelectedImages } = moduleObject.exports;

const images = [
  { base64: 'first', mimeType: 'image/jpeg', widthPx: 100, heightPx: 80, previewUrl: 'blob:first' },
  { base64: 'second', mimeType: 'image/jpeg', widthPx: 120, heightPx: 90, previewUrl: 'blob:second' },
];

test('選択済み画像をプレビューURLなしの配列へ変換する', () => {
  assert.deepEqual(JSON.parse(JSON.stringify(readSelectedImages('photo', images, ''))), [
    { base64: 'first', mimeType: 'image/jpeg', widthPx: 100, heightPx: 80 },
    { base64: 'second', mimeType: 'image/jpeg', widthPx: 120, heightPx: 90 },
  ]);
});

test('写真0枚のテキスト入力と上限超過を正しく扱う', () => {
  assert.deepEqual(JSON.parse(JSON.stringify(readSelectedImages('text', [], ''))), []);
  assert.deepEqual(JSON.parse(JSON.stringify(readSelectedImages('photo', [], '味噌汁'))), []);
  assert.throws(() => readSelectedImages('photo', [], ''), /写真またはメモ/);
  assert.throws(
    () => readSelectedImages('photo', Array.from({ length: MAX_MEAL_IMAGES + 1 }, () => images[0]), ''),
    new RegExp(`写真は${MAX_MEAL_IMAGES}枚まで`),
  );
});
