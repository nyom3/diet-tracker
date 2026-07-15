import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

const source = await readFile(new URL('../src/dashboardMetrics.ts', import.meta.url), 'utf8');
const transpiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;
const moduleUrl = `data:text/javascript;charset=utf-8,${encodeURIComponent(transpiled)}`;
const metrics = await import(moduleUrl);

const food = (timestamp, mealType, calories, protein = 0, fat = 0, carbs = 0) => [
  'meal_id', timestamp, mealType, '食事', calories, protein, fat, carbs, 'manual', '',
];
const health = (date, steps, expenditure, weight, bodyFat = '') => [
  date, steps, expenditure, weight, bodyFat, '', '', '',
];
const target = (key, value) => [key, value];

test('getDashboardPeriod: JST日付境界と7/30/90日をDST非依存で生成する', () => {
  assert.deepEqual(metrics.getDashboardPeriod(7, '2026-03-08T14:59:59Z'), {
    window_start: '2026-03-02',
    window_end: '2026-03-08',
  });
  assert.deepEqual(metrics.getDashboardPeriod(30, '2026-07-15T14:59:59Z'), {
    window_start: '2026-06-16',
    window_end: '2026-07-15',
  });
  assert.deepEqual(metrics.getDashboardPeriod(90, '2026-07-15'), {
    window_start: '2026-04-17',
    window_end: '2026-07-15',
  });
});

test('buildDashboardData: 複数食、coverage、未来食、JST境界を集計する', () => {
  const result = metrics.buildDashboardData({
    rangeDays: 7,
    now: '2026-07-15T15:00:00Z',
    foodLogs: [
      food('2026-07-14T15:00:00Z', '朝', 500, 20),
      food('2026-07-15T00:00:00Z', '朝', 100, 5),
      food('2026-07-15T01:00:00Z', '昼', 600, 30),
      food('2026-07-15T16:00:00Z', '夜', 999),
      food('2026-07-15T10:00:00Z', '間食', 100),
    ],
    healthRows: [],
    targets: [],
  });
  const day = result.days.at(-1);
  assert.equal(result.window_end, '2026-07-16');
  assert.equal(day.date, '2026-07-16');
  assert.equal(day.meal_count, 0);
  assert.deepEqual(day.coverage, {
    logged_main_meal_types: [],
    ratio: 0,
    adequate: false,
  });
  assert.equal(day.intake.calories_kcal, 0);
  assert.equal(result.days.at(-2).intake.calories_kcal, 1300);
  assert.equal(result.days.at(-2).coverage.adequate, true);
});

test('buildDashboardData: health_data同日重複は下側の非空値を項目単位で優先する', () => {
  const result = metrics.buildDashboardData({
    rangeDays: 7,
    now: '2026-07-15',
    foodLogs: [],
    healthRows: [
      health('2026-07-14', 1000, 2000, 70, 20),
      health('2026-07-14', '', 2100, 71, ''),
      health('2026-07-14', 1500, '', '', 21),
      health('2026-07-13', 1000, 2000, 0),
      health('2026-07-12', 1000, 2000, 70),
      health('2026-07-12', '', '', 0),
    ],
    targets: [
      target('calories_kcal', 1800),
      target('protein_g', 120),
      target('target_weight_kg', 65),
    ],
  });
  const day = result.days.find(({ date }) => date === '2026-07-14');
  assert.deepEqual(day && {
    steps: day.steps,
    expenditure_kcal: day.expenditure_kcal,
    weight_kg: day.weight_kg,
    body_fat_pct: day.body_fat_pct,
  }, { steps: 1500, expenditure_kcal: 2100, weight_kg: 71, body_fat_pct: 21 });
  assert.equal(result.days.find(({ date }) => date === '2026-07-13').weight_kg, null);
  assert.equal(result.days.find(({ date }) => date === '2026-07-12').weight_kg, null);
  assert.deepEqual(result.goals, {
    calories_kcal: 1800,
    protein_g: 120,
    fat_g: null,
    carbs_g: null,
    target_weight_kg: 65,
  });
});

test('体重トレンド: 7日窓で3件未満はnull、欠測を補間しない', () => {
  const result = metrics.buildDashboardData({
    rangeDays: 7,
    now: '2026-07-15',
    foodLogs: [],
    healthRows: [
      health('2026-07-09', '', '', 70),
      health('2026-07-11', '', '', 71),
      health('2026-07-15', '', '', 72),
    ],
    targets: [],
  });
  assert.equal(result.days.find(({ date }) => date === '2026-07-10').weight_trend_kg, null);
  assert.equal(result.days.find(({ date }) => date === '2026-07-15').weight_trend_kg, 71);
  assert.equal(result.summary.latest_weight_trend_kg, 71);
  assert.equal(result.summary.weight_change_kg, null);
});

test('energy balanceはadequate日かつ消費データがある場合だけ算出する', () => {
  const result = metrics.buildDashboardData({
    rangeDays: 7,
    now: '2026-07-15',
    foodLogs: [food('2026-07-15T01:00:00Z', '朝', 500), food('2026-07-15T02:00:00Z', '昼', 600)],
    healthRows: [health('2026-07-15', 5000, 2000, '')],
    targets: [],
  });
  const day = result.days.at(-1);
  assert.equal(day.energy_balance_kcal, -900);
  assert.equal(day.expenditure_kcal, 2000);
});

test('確度は40%/70%の境界を含み、summaryはnullを分母に含めない', () => {
  const foodLogs = [
    food('2026-07-09T01:00:00Z', '朝', 300, 10),
    food('2026-07-09T02:00:00Z', '昼', 300, 20),
    food('2026-07-10T01:00:00Z', '朝', 600, 30),
    food('2026-07-10T02:00:00Z', '昼', 600, 40),
    food('2026-07-11T01:00:00Z', '朝', 900, 50),
    food('2026-07-11T02:00:00Z', '昼', 900, 60),
    food('2026-07-12T01:00:00Z', '間食', 100, 10),
  ];
  const result = metrics.buildDashboardData({
    rangeDays: 7,
    now: '2026-07-15',
    foodLogs,
    healthRows: [
      health('2026-07-09', 1, '', ''),
      health('2026-07-10', 1, '', ''),
      health('2026-07-11', 1, '', ''),
    ],
    targets: [],
  });
  assert.equal(result.confidence.nutrition, 'medium');
  assert.equal(result.confidence.activity, 'medium');
  assert.equal(result.summary.logging_days, 4);
  assert.equal(result.summary.adequate_days, 3);
  assert.equal(result.summary.average_intake_kcal, 925);
  assert.equal(result.summary.average_protein_g, 55);
  assert.equal(result.summary.average_steps, 1);
  assert.equal(result.summary.recording_coverage_ratio, 0.29);
});

test('DashboardMetrics: 10000 food + 5000 health rowsを純粋集計する', () => {
  const foodLogs = Array.from({ length: 10_000 }, (_, index) =>
    food(`2026-07-${String((index % 15) + 1).padStart(2, '0')}T03:00:00Z`, '朝', 1),
  );
  const healthRows = Array.from({ length: 5_000 }, (_, index) =>
    health(`2026-07-${String((index % 15) + 1).padStart(2, '0')}`, 1, 2, 70),
  );
  const startedAt = performance.now();
  const result = metrics.buildDashboardData({
    rangeDays: 7,
    now: '2026-07-15',
    foodLogs,
    healthRows,
    targets: [],
  });
  const elapsedMs = performance.now() - startedAt;
  assert.equal(result.days.length, 7);
  assert.ok(elapsedMs < 100, `集計が${elapsedMs.toFixed(1)}msかかりました`);
});
