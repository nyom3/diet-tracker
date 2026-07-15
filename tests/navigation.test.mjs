import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

const source = await readFile(new URL('../src/navigation.ts', import.meta.url), 'utf8');
const compiledSource = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.ESNext,
    target: ts.ScriptTarget.ES2022,
  },
}).outputText;
const navigation = await import(`data:text/javascript;base64,${Buffer.from(compiledSource).toString('base64')}`);
const {
  appViewStorageKey,
  isAppView,
  persistAppView,
  readInitialAppView,
} = navigation;

function createStorage(initialValue = null) {
  let value = initialValue;
  return {
    getItem(key) {
      assert.equal(key, appViewStorageKey);
      return value;
    },
    setItem(key, nextValue) {
      assert.equal(key, appViewStorageKey);
      value = nextValue;
    },
  };
}

test('new sessions start on today and reject unknown stored values', () => {
  assert.equal(readInitialAppView(createStorage()), 'today');
  assert.equal(readInitialAppView(createStorage('unknown')), 'today');
  assert.equal(isAppView('today'), true);
  assert.equal(isAppView('record'), true);
  assert.equal(isAppView('trend'), true);
  assert.equal(isAppView('settings'), false);
});

test('selected views persist in the supplied session storage', () => {
  const storage = createStorage();
  persistAppView('trend', storage);
  assert.equal(readInitialAppView(storage), 'trend');
});

test('storage failures fall back without breaking navigation', () => {
  const unavailableStorage = {
    getItem() {
      throw new Error('unavailable');
    },
    setItem() {
      throw new Error('unavailable');
    },
  };

  assert.equal(readInitialAppView(unavailableStorage), 'today');
  assert.doesNotThrow(() => persistAppView('record', unavailableStorage));
});
