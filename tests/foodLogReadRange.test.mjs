import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const codeSource = await readFile(new URL('../gas/Code.gs', import.meta.url), 'utf8');
const functionStart = codeSource.indexOf('function rowToFoodLog(');
const functionEnd = codeSource.indexOf('function readFavoritesFromSheet(');
const functionSource = codeSource.slice(functionStart, functionEnd);

function createContext() {
  const context = {
    FOOD_LOG_HEADERS: Array.from({ length: 10 }, () => ''),
    toNonNegativeNumber: (value) => {
      const number = Number(value);
      return Number.isFinite(number) && number >= 0 ? number : 0;
    },
  };
  vm.runInNewContext(
    `${functionSource}\nthis.readFoodLogsFromSheet = readFoodLogsFromSheet;`,
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

// 本番の readFoodLogsFromSheet とは別に、テスト入力そのものから期待値を作る。
// 同じ読取関数を「全件基準」として再利用すると、範囲漏れの退行を検出できない。
function independentMealIds(rows) {
  return rows.map((row) => String(row[0] || '').trim()).filter(Boolean);
}

function readIds(context, rows, options) {
  const sheet = createSheet(rows);
  const meals = context.readFoodLogsFromSheet(sheet, options);
  return { ids: meals.map((meal) => meal.id), ranges: sheet.ranges };
}

test('行順・日時順が一致しない603件でも日付編集・古い末尾追記を含む全行を読む', () => {
  const rows = Array.from({ length: 603 }, (_, index) =>
    foodRow(`meal-${index}`, '2026-01-01T01:00:00Z'),
  );
  rows[0] = foodRow('edited-today', '2026-08-08T01:00:00Z');
  rows[594] = foodRow('recent-1', '2026-08-01T01:00:00Z');
  rows[595] = foodRow('recent-2', '2026-07-20T01:00:00Z');
  rows[596] = foodRow('recent-3', '2026-07-10T01:00:00Z');
  rows[602] = foodRow('appended-old', '2025-01-01T01:00:00Z');
  const context = createContext();

  for (const options of [
    { rangeDays: 7, now: new Date('2026-08-08T02:00:00Z'), recentMealLimit: 3 },
    { rangeDays: 7, now: new Date('2026-08-08T02:00:00Z') },
  ]) {
    const result = readIds(context, rows, options);

    assert.deepEqual(result.ids, independentMealIds(rows));
    assert.equal(result.ranges.length, 1);
    assert.deepEqual(result.ranges[0], {
      startRow: 2,
      column: 1,
      rowCount: 603,
      columnCount: 10,
    });
  }
});

test('7/30/90日と境界・疎な期間でも読取結果は全件基準と一致する', () => {
  const rows = [
    foodRow('boundary-start', '2026-08-02T00:00:00Z'),
    foodRow('boundary-end', '2026-08-08T23:59:59Z'),
    foodRow('future', '2026-08-09T00:00:00Z'),
    foodRow('sparse-old', '2026-01-01T01:00:00Z'),
  ];
  const context = createContext();

  for (const rangeDays of [7, 30, 90]) {
    const result = readIds(context, rows, {
      rangeDays,
      now: new Date('2026-08-08T02:00:00Z'),
    });
    assert.deepEqual(result.ids, independentMealIds(rows));
    assert.equal(result.ranges.length, 1);
  }
});

test('filterEmptyIdの意味を維持し、空ID経路だけ明示的に残す', () => {
  const rows = [
    foodRow('', '2026-08-08T01:00:00Z'),
    foodRow('with-id', '2026-08-08T02:00:00Z'),
  ];
  const context = createContext();

  assert.deepEqual(
    readIds(context, rows, { filterEmptyId: true }).ids,
    ['with-id'],
  );
  assert.deepEqual(
    readIds(context, rows, { filterEmptyId: false }).ids,
    ['', 'with-id'],
  );
});

test('空シートでは読み取りを行わず空配列を返す', () => {
  const context = createContext();
  const result = readIds(context, [], { rangeDays: 7 });

  assert.equal(result.ids.length, 0);
  assert.equal(result.ranges.length, 0);
});
