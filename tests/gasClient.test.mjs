import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

const source = await readFile(new URL('../src/gasClient.ts', import.meta.url), 'utf8');
const transpiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;
const moduleUrl = `data:text/javascript;charset=utf-8,${encodeURIComponent(transpiled)}`;
const gasClient = await import(moduleUrl);

test('DashboardData境界は欠落日・null drop・型不正を安全側へ正規化する', () => {
  const result = gasClient.normalizeDashboardData({
    range_days: 30,
    window_start: '2026-06-16',
    window_end: '2026-07-15',
    goals: {
      calories_kcal: undefined,
      protein_g: '120',
      fat_g: -1,
      carbs_g: 250,
      target_weight_kg: 70,
    },
    confidence: { nutrition: 'high', weight: 'unknown', activity: undefined },
    summary: {
      logging_days: '3',
      adequate_days: 2,
      recording_coverage_ratio: 1.4,
      average_intake_kcal: undefined,
      average_protein_g: 100,
      average_steps: -1,
      latest_weight_trend_kg: undefined,
      weight_change_kg: -2.5,
    },
    days: [{
      date: '2026-07-15',
      intake: { calories_kcal: 1800, protein_g: 'bad', fat_g: -1, carbs_g: 200 },
      meal_count: 2.8,
      coverage: { logged_main_meal_types: ['朝', '朝', '未知'], ratio: 1.4, adequate: true },
      weight_kg: 70,
      weight_trend_kg: undefined,
      body_fat_pct: 20,
      steps: 'bad',
      expenditure_kcal: 2200,
      energy_balance_kcal: -400,
    }],
  });

  assert.equal(result.days.length, 30);
  assert.equal(result.days[29].date, '2026-07-15');
  assert.equal(result.days[29].meal_count, 2);
  assert.deepEqual(result.days[29].coverage, {
    logged_main_meal_types: ['朝'],
    ratio: 1,
    adequate: true,
  });
  assert.equal(result.days[29].intake.protein_g, 0);
  assert.equal(result.days[29].steps, null);
  assert.equal(result.days[0].meal_count, 0);
  assert.equal(result.goals.protein_g, null);
  assert.equal(result.goals.target_weight_kg, 70);
  assert.equal(result.summary.logging_days, 0);
  assert.equal(result.summary.average_steps, null);
  assert.equal(result.confidence.weight, 'low');
});

test('getDashboardDataはgoogle.script.runの結果を正規化して返す', async () => {
  const previousWindow = globalThis.window;
  let requestedRange;
  let successHandler;
  const runner = {
    withSuccessHandler(handler) {
      successHandler = handler;
      return this;
    },
    withFailureHandler() {
      return this;
    },
    getDashboardData(rangeDays) {
      requestedRange = rangeDays;
      successHandler({ range_days: 7, window_start: '2026-07-09', window_end: '2026-07-15' });
    },
  };

  globalThis.window = { google: { script: { run: runner } } };
  try {
    const result = await gasClient.getDashboardData(7);
    assert.equal(requestedRange, 7);
    assert.equal(result.days.length, 7);
    assert.equal(result.days.every((day) => day.meal_count === 0), true);
  } finally {
    globalThis.window = previousWindow;
  }
});

test('HomeSnapshot境界は未記録日・null drop・欠落配列を安全側へ正規化する', () => {
  const result = gasClient.normalizeHomeSnapshot({
    date: '2026-07-15',
    today: {
      date: '2026-07-15',
      count: undefined,
      total: { calories_kcal: 320, protein_g: 'bad', fat_g: null, carbs_g: 40 },
    },
    goals: {
      calories_kcal: undefined,
      protein_g: null,
      fat_g: -1,
      carbs_g: 200,
      target_weight_kg: undefined,
    },
    today_meals: undefined,
    recent_meals: null,
    favorites: [{ id: 'fav_1', description: 'おにぎり', calories_kcal: 180 }],
    active_action: undefined,
    rule_focus: {
      source: 'rules',
      headline: 'まずは記録',
      summary: '記録しましょう',
      evidence: undefined,
      selected_action: null,
      alternative_action: null,
    },
  });

  assert.deepEqual(result.goals, {
    calories_kcal: null,
    protein_g: null,
    fat_g: null,
    carbs_g: 200,
    target_weight_kg: null,
  });
  assert.deepEqual(result.today, {
    date: '2026-07-15',
    count: 0,
    total: { calories_kcal: 320, protein_g: 0, fat_g: 0, carbs_g: 40 },
  });
  assert.deepEqual(result.today_meals, []);
  assert.deepEqual(result.recent_meals, []);
  assert.equal(result.favorites.length, 1);
  assert.equal(result.active_action, null);
  assert.deepEqual(result.rule_focus.evidence, []);
});

test('getGoals/saveGoals/getHomeSnapshotは専用RPCを呼び、応答を正規化する', async () => {
  const previousWindow = globalThis.window;
  const calls = [];
  const runner = {
    withSuccessHandler(handler) {
      this.successHandler = handler;
      return this;
    },
    withFailureHandler() {
      return this;
    },
    getGoals() {
      calls.push('getGoals');
      this.successHandler({ target_weight_kg: 68 });
    },
    saveGoals(payload) {
      calls.push(['saveGoals', payload.target_weight_kg]);
      this.successHandler({ ok: true, goals: payload });
    },
    getHomeSnapshot() {
      calls.push('getHomeSnapshot');
      this.successHandler({ date: '2026-07-15' });
    },
  };

  globalThis.window = { google: { script: { run: runner } } };
  try {
    const goals = await gasClient.getGoals();
    const saved = await gasClient.saveGoals({
      calories_kcal: null,
      protein_g: 60,
      fat_g: null,
      carbs_g: 200,
      target_weight_kg: null,
    });
    const snapshot = await gasClient.getHomeSnapshot();

    assert.equal(goals.target_weight_kg, 68);
    assert.equal(saved.goals.target_weight_kg, null);
    assert.equal(snapshot.date, '2026-07-15');
    assert.deepEqual(calls, ['getGoals', ['saveGoals', null], 'getHomeSnapshot']);
  } finally {
    globalThis.window = previousWindow;
  }
});

test('generateCoachInsightはscopeを渡し、欠落配列・nullable・負の根拠値を境界で正規化する', async () => {
  const previousWindow = globalThis.window;
  let requested;
  const runner = {
    withSuccessHandler(handler) {
      this.successHandler = handler;
      return this;
    },
    withFailureHandler() {
      return this;
    },
    generateCoachInsight(request) {
      requested = request;
      this.successHandler({
        scope: 'trend',
        source: 'ai',
        headline: '体重の傾向を見る',
        summary: '記録を続けて変化を確認しましょう。',
        confidence: 'high',
        evidence: [{
          key: 'weight_trend',
          value: -1.5,
          unit: 'kg',
          comparison_value: 70,
          period_start: '2026-07-01',
          period_end: '2026-07-15',
        }],
        selected_action: undefined,
        alternative_action: null,
        fallback_notice: undefined,
      });
    },
  };

  globalThis.window = { google: { script: { run: runner } } };
  try {
    const result = await gasClient.generateCoachInsight({ scope: 'trend', range_days: 30 });
    assert.deepEqual(requested, { scope: 'trend', range_days: 30 });
    assert.equal(result.evidence[0].value, -1.5);
    assert.deepEqual(result.selected_action, null);
    assert.deepEqual(result.alternative_action, null);
    assert.equal(result.fallback_notice, undefined);
  } finally {
    globalThis.window = previousWindow;
  }
});
