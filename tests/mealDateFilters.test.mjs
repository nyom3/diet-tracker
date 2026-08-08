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

test('食事ログの範囲は末尾から行数ベースで広げ、日時の古さでは停止しない', () => {
  const firstRange = filters.resolveFoodLogReadRange(1001, 0, {
    initialRows: 500,
    growthFactor: 4,
  });
  assert.equal(firstRange.startRow, 502);
  assert.equal(firstRange.rowCount, 500);
  assert.equal(firstRange.isFull, false);

  const secondRange = filters.resolveFoodLogReadRange(1001, 1, {
    initialRows: 500,
    growthFactor: 4,
  });
  assert.equal(secondRange.startRow, 2);
  assert.equal(secondRange.rowCount, 1000);
  assert.equal(secondRange.isFull, true);
});

test('末尾に古い日時を後から追記しても、範囲読み込みの結果は全件読み込みと一致する', () => {
  const meals = [
    { id: 'window-old', timestamp: '2026-08-02T01:00:00Z' },
    { id: 'window-new', timestamp: '2026-08-08T01:00:00Z' },
    { id: 'appended-old', timestamp: '2026-07-01T01:00:00Z' },
  ];
  const dateKey = (timestamp) => new Date(timestamp).toISOString().slice(0, 10);
  const filterWindow = (rows) => rows.filter((meal) => {
    const date = dateKey(meal.timestamp);
    return date >= '2026-08-02' && date <= '2026-08-08';
  });
  const range = filters.resolveFoodLogReadRange(meals.length + 1, 1, {
    initialRows: 2,
    growthFactor: 4,
  });
  const rangeMeals = meals.slice(meals.length - range.rowCount);

  assert.deepEqual(filterWindow(rangeMeals), filterWindow(meals));
  assert.equal(filters.countRecentMealsForReadValue(
    rangeMeals,
    Date.parse('2026-08-08T02:00:00Z'),
    '2026-08-08',
    dateKey,
    3,
  ), 2);
});

test('記録が空いていても、必要な直近3件がそろうまで範囲を拡張できる', () => {
  const meals = [
    { id: 'very-old', timestamp: '2026-01-01T01:00:00Z' },
    { id: 'recent-1', timestamp: '2026-08-01T01:00:00Z' },
    { id: 'recent-2', timestamp: '2026-07-20T01:00:00Z' },
    { id: 'today', timestamp: '2026-08-08T01:00:00Z' },
    { id: 'recent-3', timestamp: '2026-07-10T01:00:00Z' },
  ];
  const dateKey = (timestamp) => new Date(timestamp).toISOString().slice(0, 10);
  const range = filters.resolveFoodLogReadRange(meals.length + 1, 1, {
    initialRows: 2,
    growthFactor: 2,
  });
  const rangeMeals = meals.slice(meals.length - range.rowCount);

  assert.equal(filters.countRecentMealsForReadValue(
    rangeMeals,
    Date.parse('2026-08-08T02:00:00Z'),
    '2026-08-08',
    dateKey,
    3,
  ), 3);
});
