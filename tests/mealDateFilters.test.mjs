import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const source = await readFile(new URL('../gas/MealDateFilters.js', import.meta.url), 'utf8');
const moduleObject = { exports: {} };
vm.runInNewContext(source, { module: moduleObject });
const filters = moduleObject.exports;
const dateKeyForTimestamp = (timestamp) => new Date(timestamp).toISOString().slice(0, 10);

test('日付一致は未来時刻も含め、評価時点フィルタだけが未来時刻を除外する', () => {
  const meal = { timestamp: '2026-08-08T19:00:00+09:00' };
  const now = Date.parse('2026-08-08T18:00:00+09:00');

  assert.equal(filters.isMealOnDateValue(meal, '2026-08-08', dateKeyForTimestamp), true);
  assert.equal(filters.isMealOnDateUntilValue(meal, '2026-08-08', now, dateKeyForTimestamp), false);
});

test('不正な日時は日付一致・評価時点フィルタのどちらにも含めない', () => {
  const meal = { timestamp: 'not-a-date' };
  const now = Date.parse('2026-08-08T18:00:00+09:00');

  assert.equal(filters.isMealOnDateValue(meal, '2026-08-08', dateKeyForTimestamp), false);
  assert.equal(filters.isMealOnDateUntilValue(meal, '2026-08-08', now, dateKeyForTimestamp), false);
});

test('食事をタイムスタンプ降順に並べる', () => {
  const meals = [
    { id: 'old', timestamp: '2026-08-07T23:00:00Z' },
    { id: 'new', timestamp: '2026-08-08T01:00:00Z' },
    { id: 'invalid', timestamp: 'not-a-date' },
  ];

  assert.deepEqual(filters.sortMealsByTimestampDescending(meals).map((meal) => meal.id), ['new', 'old', 'invalid']);
  assert.equal(meals[0].id, 'old');
});

test('日付キーは実在日かつ指定した最新日以前だけを許可する', () => {
  assert.equal(filters.isValidDateKey('2026-02-28'), true);
  assert.equal(filters.isValidDateKey('2026-02-29'), false);
  assert.equal(filters.isDateKeyNotAfter('2026-08-07', '2026-08-08'), true);
  assert.equal(filters.isDateKeyNotAfter('2026-08-09', '2026-08-08'), false);
});
