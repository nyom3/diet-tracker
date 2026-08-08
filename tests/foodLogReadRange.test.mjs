import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const codeSource = await readFile(new URL('../gas/Code.gs', import.meta.url), 'utf8');
const filtersSource = await readFile(new URL('../gas/MealDateFilters.js', import.meta.url), 'utf8');
const functionStart = codeSource.indexOf('function rowToFoodLog(');
const functionEnd = codeSource.indexOf('function readFavoritesFromSheet(');
const functionSource = codeSource.slice(functionStart, functionEnd);

function createContext() {
  const context = {
    FOOD_LOG_HEADERS: Array.from({ length: 10 }, () => ''),
    Session: { getScriptTimeZone: () => 'UTC' },
    Utilities: {
      formatDate: (date) => new Date(date).toISOString().slice(0, 10),
    },
    toNonNegativeNumber: (value) => {
      const number = Number(value);
      return Number.isFinite(number) && number >= 0 ? number : 0;
    },
  };
  vm.runInNewContext(
    `${filtersSource}\n${functionSource}\nthis.readFoodLogsFromSheet = readFoodLogsFromSheet;`,
    context,
  );
  return context;
}

function createSheet(rows) {
  const ranges = [];
  return {
    ranges,
    getLastRow: () => rows.length + 1,
    getRange: (startRow, column, rowCount, columnCount) => {
      ranges.push({ startRow, column, rowCount, columnCount });
      return {
        getValues: () => rows.slice(startRow - 2, startRow - 2 + rowCount),
      };
    },
  };
}

function foodRow(id, timestamp, description = '食事') {
  return [id, timestamp, '朝', description, 500, 20, 10, 60, 'manual', ''];
}

function fullRead(context, rows) {
  return context.readFoodLogsFromSheet(createSheet(rows), {
    rangeDays: 100,
  });
}

function homeRelevantMeals(meals) {
  const now = Date.parse('2026-08-08T02:00:00Z');
  const dateKey = (timestamp) => new Date(timestamp).toISOString().slice(0, 10);
  const recent = meals
    .filter((meal) => {
      const timestamp = Date.parse(meal.timestamp);
      return timestamp <= now && dateKey(meal.timestamp) !== '2026-08-08';
    })
    .sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp))
    .slice(0, 3)
    .map((meal) => meal.id);
  const window = meals
    .filter((meal) => dateKey(meal.timestamp) >= '2026-08-02' && dateKey(meal.timestamp) <= '2026-08-08')
    .map((meal) => meal.id);

  return { window, recent };
}

test('readFoodLogsFromSheetは末尾の古い日時追記を含む範囲を全件読みと同じ結果にする', () => {
  const rows = Array.from({ length: 603 }, (_, index) =>
    foodRow(`meal-${index}`, '2026-01-01T01:00:00Z'),
  );
  rows[594] = foodRow('recent-1', '2026-08-01T01:00:00Z');
  rows[595] = foodRow('recent-2', '2026-07-20T01:00:00Z');
  rows[596] = foodRow('recent-3', '2026-07-10T01:00:00Z');
  rows[602] = foodRow('appended-old', '2025-01-01T01:00:00Z');
  const context = createContext();
  const sheet = createSheet(rows);

  const ranged = context.readFoodLogsFromSheet(sheet, {
    rangeDays: 7,
    now: new Date('2026-08-08T02:00:00Z'),
    recentMealLimit: 3,
  });

  assert.deepEqual(homeRelevantMeals(ranged), homeRelevantMeals(fullRead(context, rows)));
  assert.equal(sheet.ranges[0].startRow, 105);
  assert.equal(sheet.ranges[0].rowCount, 500);
  assert.equal(sheet.ranges.length, 1);
});

test('readFoodLogsFromSheetは初回範囲外の直近3件を見つけるまで拡張する', () => {
  const rows = Array.from({ length: 603 }, (_, index) =>
    foodRow(`meal-${index}`, '2026-08-08T01:00:00Z'),
  );
  rows[0] = foodRow('recent-1', '2026-08-01T01:00:00Z');
  rows[1] = foodRow('recent-2', '2026-07-20T01:00:00Z');
  rows[2] = foodRow('recent-3', '2026-07-10T01:00:00Z');
  const context = createContext();
  const sheet = createSheet(rows);

  const ranged = context.readFoodLogsFromSheet(sheet, {
    rangeDays: 7,
    now: new Date('2026-08-08T02:00:00Z'),
    recentMealLimit: 3,
  });

  assert.deepEqual(homeRelevantMeals(ranged), homeRelevantMeals(fullRead(context, rows)));
  assert.deepEqual(sheet.ranges.map(({ startRow, rowCount }) => ({ startRow, rowCount })), [
    { startRow: 105, rowCount: 500 },
    { startRow: 2, rowCount: 603 },
  ]);
});

test('readFoodLogsFromSheetは空シートで読み取りを行わず空配列を返す', () => {
  const context = createContext();
  const sheet = createSheet([]);

  assert.equal(context.readFoodLogsFromSheet(sheet, { rangeDays: 7 }).length, 0);
  assert.deepEqual(sheet.ranges, []);
});
