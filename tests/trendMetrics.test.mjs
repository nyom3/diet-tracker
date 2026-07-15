import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ts = require('typescript');
const source = await readFile(new URL('../src/trendMetrics.ts', import.meta.url), 'utf8');
const transpiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText;
const module = { exports: {} };
new Function('exports', 'module', transpiled)(module.exports, module);
const metrics = module.exports;

const baseDay = (overrides = {}) => ({
  date: '2026-07-15',
  intake: { calories_kcal: 500, protein_g: 30, fat_g: 10, carbs_g: 40 },
  meal_count: 2,
  coverage: { logged_main_meal_types: ['朝', '昼'], ratio: 2 / 3, adequate: true },
  weight_kg: null,
  weight_trend_kg: null,
  body_fat_pct: null,
  steps: null,
  expenditure_kcal: null,
  energy_balance_kcal: null,
  ...overrides,
});

test('欠測を区切って折れ線をつなげない', () => {
  const segments = metrics.splitTrendSegments([
    { date: '2026-07-13', value: 70 },
    { date: '2026-07-14', value: null },
    { date: '2026-07-15', value: 71 },
    { date: '2026-07-16', value: 72 },
  ]);
  assert.deepEqual(segments, [
    [{ date: '2026-07-13', value: 70 }],
    [{ date: '2026-07-15', value: 71 }, { date: '2026-07-16', value: 72 }],
  ]);
});

test('PFCは目標ありなら比率、なしならグラムを返す', () => {
  const day = baseDay();
  const goals = { calories_kcal: 2000, protein_g: 60, fat_g: null, carbs_g: null, target_weight_kg: null };
  assert.equal(metrics.getPfcDisplayMode(goals, 'protein_g'), 'ratio');
  assert.equal(metrics.getPfcChartValue(day, goals, 'protein_g'), 50);
  assert.equal(metrics.getPfcDisplayMode(goals, 'fat_g'), 'grams');
  assert.equal(metrics.getPfcChartValue(day, goals, 'fat_g'), 10);
});

test('エネルギーはカバレッジ不足または消費欠測なら判定保留', () => {
  assert.equal(metrics.isEnergyDecisionPending(baseDay()), true);
  assert.equal(metrics.isEnergyDecisionPending(baseDay({
    expenditure_kcal: 2100,
    energy_balance_kcal: -1600,
  })), false);
  assert.equal(metrics.isEnergyDecisionPending(baseDay({
    expenditure_kcal: 2100,
    coverage: { logged_main_meal_types: ['朝'], ratio: 1 / 3, adequate: false },
  })), true);
});

test('体重は7日窓に3件以上ある日だけトレンドを描く', () => {
  const days = [
    baseDay({ date: '2026-07-12', weight_kg: 70 }),
    baseDay({ date: '2026-07-13', weight_kg: null }),
    baseDay({ date: '2026-07-14', weight_kg: 71 }),
    baseDay({ date: '2026-07-15', weight_kg: 72 }),
  ];
  const trend = metrics.calculateRollingAverage(days, 'weight_kg', 7, 3);
  assert.deepEqual(trend.map((point) => point.value), [null, null, null, 71]);
});

test('ローリング平均は欠測を0として扱わない', () => {
  const days = [
    baseDay({ date: '2026-07-12', steps: 1000 }),
    baseDay({ date: '2026-07-13', steps: null }),
    baseDay({ date: '2026-07-14', steps: 3000 }),
  ];
  const average = metrics.calculateRollingAverage(days, 'steps');
  assert.deepEqual(average.map((point) => point.value), [1000, 1000, 2000]);
});

test('スケールの最小幅と欠測のみのフォールバックを保証する', () => {
  assert.deepEqual(metrics.calculateTrendDomain([null, null]), { min: 0, max: 1 });
  const domain = metrics.calculateTrendDomain([70, 70.4]);
  assert.ok(domain.max - domain.min >= 1);
});

test('日付選択は期間内に丸め、前日・翌日を範囲外へ進めない', () => {
  const dates = ['2026-07-13', '2026-07-14', '2026-07-15'];
  assert.equal(metrics.normalizeSelectedDate(dates, '2026-07-10'), '2026-07-15');
  assert.equal(metrics.getAdjacentDate(dates, '2026-07-14', -1), '2026-07-13');
  assert.equal(metrics.getAdjacentDate(dates, '2026-07-15', 1), '2026-07-15');
});
