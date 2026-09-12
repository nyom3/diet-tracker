import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const codeSource = await readFile(new URL('../gas/Code.gs', import.meta.url), 'utf8');
const functionStart = codeSource.indexOf('function rowToFoodLog(');
const functionEnd = codeSource.indexOf('function readFavoritesFromSheet(');
const numberFunctionStart = codeSource.indexOf('function toNonNegativeNumber(');
const numberFunctionEnd = codeSource.indexOf('function toNullableNonNegativeNumber(');

assert.notEqual(functionStart, -1, 'rowToFoodLog の開始位置を取得できること');
assert.notEqual(functionEnd, -1, 'readFoodLogsFromSheet の終了位置を取得できること');
assert.notEqual(numberFunctionStart, -1, 'toNonNegativeNumber の開始位置を取得できること');
assert.notEqual(numberFunctionEnd, -1, 'toNonNegativeNumber の終了位置を取得できること');
const functionSource = codeSource.slice(functionStart, functionEnd);
const numberFunctionSource = codeSource.slice(numberFunctionStart, numberFunctionEnd);

function createContext() {
  const context = {
    FOOD_LOG_HEADERS: Array.from({ length: 10 }, () => ''),
  };
  vm.runInNewContext(
    `${numberFunctionSource}\n${functionSource}\nthis.readFoodLogsFromSheet = readFoodLogsFromSheet;`,
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

function dateKey(timestamp) {
  return new Date(timestamp).toISOString().slice(0, 10);
}

function addUtcDays(date, amount) {
  const result = new Date(`${date}T00:00:00Z`);
  result.setUTCDate(result.getUTCDate() + amount);
  return result.toISOString().slice(0, 10);
}

function windowIds(meals, rangeDays, now) {
  const end = dateKey(now);
  const start = addUtcDays(end, 1 - rangeDays);
  return meals
    .filter((meal) => {
      const timestamp = Date.parse(meal.timestamp);
      return Number.isFinite(timestamp) && timestamp <= now.getTime() &&
        dateKey(timestamp) >= start && dateKey(timestamp) <= end;
    })
    .map((meal) => meal.id);
}

function recentIds(meals, now, limit) {
  const today = dateKey(now);
  return meals
    .filter((meal) => {
      const timestamp = Date.parse(meal.timestamp);
      return Number.isFinite(timestamp) && timestamp <= now.getTime() && dateKey(timestamp) !== today;
    })
    .sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp))
    .slice(0, limit)
    .map((meal) => meal.id);
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
  const context = createContext();
  const now = new Date('2026-08-08T12:00:00Z');

  for (const rangeDays of [7, 30, 90]) {
    const start = addUtcDays('2026-08-08', 1 - rangeDays);
    const beforeStart = addUtcDays(start, -1);
    const rows = [
      foodRow(`inside-${rangeDays}`, `${start}T00:00:00Z`),
      foodRow(`outside-${rangeDays}`, `${beforeStart}T23:59:59Z`),
      foodRow(`now-${rangeDays}`, '2026-08-08T12:00:00Z'),
      foodRow(`future-same-day-${rangeDays}`, '2026-08-08T12:00:01Z'),
      foodRow(`future-day-${rangeDays}`, '2026-08-09T00:00:00Z'),
      foodRow(`sparse-old-${rangeDays}`, '2026-01-01T01:00:00Z'),
    ];
    const result = readIds(context, rows, {
      rangeDays,
      now,
    });
    assert.deepEqual(result.ids, independentMealIds(rows));
    assert.deepEqual(
      windowIds(context.readFoodLogsFromSheet(createSheet(rows), { rangeDays, now }), rangeDays, now),
      [`inside-${rangeDays}`, `now-${rangeDays}`],
    );
    assert.equal(result.ranges.length, 1);
  }
});

test('先頭側へ移動した当日記録と、行順に依存しない直近3件を各利用条件で取得できる', () => {
  const rows = Array.from({ length: 603 }, (_, index) =>
    foodRow(`old-${index}`, '2025-01-01T01:00:00Z'),
  );
  rows[0] = foodRow('edited-today', '2026-08-08T01:00:00Z');
  rows[1] = foodRow('recent-newest', '2026-08-07T23:00:00Z');
  rows[300] = foodRow('recent-middle', '2026-08-06T12:00:00Z');
  rows[601] = foodRow('recent-oldest', '2026-08-05T01:00:00Z');
  rows[602] = foodRow('appended-old', '2024-01-01T01:00:00Z');
  const context = createContext();
  const now = new Date('2026-08-08T02:00:00Z');
  const meals = context.readFoodLogsFromSheet(createSheet(rows), {
    rangeDays: 7,
    now,
    recentMealLimit: 3,
  });

  assert.deepEqual(windowIds(meals, 7, now), [
    'edited-today',
    'recent-newest',
    'recent-middle',
    'recent-oldest',
  ]);
  assert.deepEqual(recentIds(meals, now, 3), [
    'recent-newest',
    'recent-middle',
    'recent-oldest',
  ]);
});

test('今日・コーチ・週次の呼び出し条件と、推移の全件読取契約を維持する', () => {
  assert.match(codeSource, /function getHomeSnapshot\(\)[\s\S]*?readFoodLogsFromSheet\(getFoodLogSheet\(\), \{[\s\S]*?rangeDays: 7,[\s\S]*?recentMealLimit: 3,/);
  assert.match(codeSource, /function getCoachDashboardContext\(rangeDays, now\)[\s\S]*?readFoodLogsFromSheet\(getFoodLogSheet\(\), \{[\s\S]*?rangeDays: rangeDays,[\s\S]*?now: now,/);
  assert.match(codeSource, /function getWeeklyTrend\(\)[\s\S]*?listMealsForWindow\(windowStartDate, today\)/);
  assert.match(codeSource, /function listMealsForWindow\(windowStartDate, windowEndDate\)[\s\S]*?readFoodLogsFromSheet\(sheet, \{[\s\S]*?rangeDays: rangeDays,[\s\S]*?filterEmptyId: false,/);
  assert.match(codeSource, /function getDashboardData\(rangeDays\)[\s\S]*?foodSheet\.getRange\(2, 1, foodSheet\.getLastRow\(\) - 1, FOOD_LOG_HEADERS\.length\)\.getValues\(\)/);
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
