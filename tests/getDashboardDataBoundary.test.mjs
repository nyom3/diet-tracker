import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const source = await readFile(new URL('../gas/Code.gs', import.meta.url), 'utf8');
const start = source.indexOf('function getDashboardData(');
const end = source.indexOf('function getLatestWeeklyReview(');
const functionSource = source.slice(start, end);

function createDashboardContext() {
  const readCounts = { food_log: 0, health_data: 0, targets: 0 };
  const captured = {};
  const sheets = {
    food_log: createSheet('food_log', [
      ['meal_id', '2026-07-15T01:00:00Z', '朝', '食事', 500, 20, 10, 60],
    ], readCounts),
    health_data: createSheet('health_data', [
      ['date', 'steps', 'total_calories_kcal', 'weight_kg', 'body_fat_pct'],
      ['2026-07-15', 5000, 2200, 70, 20],
    ], readCounts),
    targets: createSheet('targets', [
      ['key', 'value'],
      ['calories_kcal', 1800],
    ], readCounts),
  };
  const context = {
    FOOD_LOG_SHEET_NAME: 'food_log',
    FOOD_LOG_HEADERS: Array.from({ length: 10 }, () => ''),
    HEALTH_DATA_SHEET_NAME: 'health_data',
    TARGETS_SHEET_NAME: 'targets',
    getSpreadsheet: () => ({ getSheetByName: (name) => sheets[name] || null }),
    Session: { getScriptTimeZone: () => 'Asia/Tokyo' },
    Utilities: {
      formatDate: (date) => date.toISOString().replace('Z', '+0000'),
    },
    buildDashboardData: (input) => {
      Object.assign(captured, input);
      return { days: [], range_days: input.rangeDays };
    },
  };

  vm.runInNewContext(functionSource + '\nthis.getDashboardData = getDashboardData;', context);
  return { context, readCounts, captured };
}

function createSheet(name, rows, readCounts) {
  return {
    getLastRow: () => rows.length + (name === 'food_log' ? 1 : 0),
    getLastColumn: () => rows.reduce((max, row) => Math.max(max, row.length), 0),
    getRange: () => ({
      getValues: () => {
        readCounts[name] += 1;
        return name === 'food_log' ? rows : rows;
      },
    }),
  };
}

test('getDashboardDataは範囲を検証し、3シートを各1回だけ読み純粋集計へ渡す', () => {
  const { context, readCounts, captured } = createDashboardContext();
  const result = context.getDashboardData(90);

  assert.deepEqual(JSON.parse(JSON.stringify(result)), { days: [], range_days: 90 });
  assert.deepEqual(readCounts, { food_log: 1, health_data: 1, targets: 1 });
  assert.equal(captured.rangeDays, 90);
  assert.equal(captured.foodLogs.length, 1);
  assert.deepEqual(captured.healthHeaders, ['date', 'steps', 'total_calories_kcal', 'weight_kg', 'body_fat_pct']);
  assert.equal(captured.healthRows.length, 1);
  assert.equal(captured.targets.length, 1);
  assert.match(captured.now, /^2026-|^\d{4}-/);
});

test('getDashboardDataは7/30/90以外を読み取り前に弾く', () => {
  const { context, readCounts } = createDashboardContext();
  assert.throws(() => context.getDashboardData(14), /期間は7、30、90日のいずれか/);
  assert.deepEqual(readCounts, { food_log: 0, health_data: 0, targets: 0 });
});
