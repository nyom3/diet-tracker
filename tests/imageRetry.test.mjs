import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

const source = await readFile(new URL('../src/imageRetry.ts', import.meta.url), 'utf8');
const transpiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 },
}).outputText;
const { withImageDecodeRetry } = await import(`data:text/javascript;base64,${Buffer.from(transpiled).toString('base64')}`);

test('画像デコード失敗は400ms待って1回だけ再試行する', async () => {
  let attempts = 0;
  const result = await withImageDecodeRetry(async () => {
    attempts += 1;
    if (attempts === 1) {
      throw new Error('temporary decode failure');
    }
    return 'ok';
  }, 0);

  assert.equal(result, 'ok');
  assert.equal(attempts, 2);
});

test('再試行後も失敗した場合は2回で打ち切る', async () => {
  let attempts = 0;
  await assert.rejects(
    withImageDecodeRetry(async () => {
      attempts += 1;
      throw new Error('decode failure');
    }, 0),
    /decode failure/,
  );

  assert.equal(attempts, 2);
});
