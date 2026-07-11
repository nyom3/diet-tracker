import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

const source = await readFile(new URL('../src/imageSizing.ts', import.meta.url), 'utf8');
const transpiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 },
}).outputText;
const moduleUrl = `data:text/javascript;charset=utf-8,${encodeURIComponent(transpiled)}`;
const { getResizedImageDimensions } = await import(moduleUrl);

test('大きい画像はアスペクト比を保って長辺1536pxに収まる', () => {
  assert.deepEqual(getResizedImageDimensions(4032, 3024, 1536), { widthPx: 1536, heightPx: 1152 });
});

test('小さい画像は拡大しない', () => {
  assert.deepEqual(getResizedImageDimensions(800, 600, 1536), { widthPx: 800, heightPx: 600 });
});

test('縦長画像もアスペクト比を保つ', () => {
  assert.deepEqual(getResizedImageDimensions(3024, 4032, 1536), { widthPx: 1152, heightPx: 1536 });
});

test('不正な画像サイズは拒否する', () => {
  assert.throws(() => getResizedImageDimensions(0, 100, 1536), /画像サイズを取得できませんでした/);
});
