import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const dashboardSource = await readFile(new URL('../gas/DashboardMetrics.js', import.meta.url), 'utf8');
const coachSource = await readFile(new URL('../gas/CoachRules.js', import.meta.url), 'utf8');
const context = { module: { exports: {} } };
vm.runInNewContext(dashboardSource, context);
const dashboard = context.module.exports;
context.module = { exports: {} };
vm.runInNewContext(coachSource, context);
const coach = context.module.exports;

const dateAt = (start, offset) => new Date(Date.parse(`${start}T00:00:00Z`) + offset * 86400000)
  .toISOString().slice(0, 10);

const makeDay = (date, overrides = {}) => ({
  date,
  intake: { calories_kcal: 1700, protein_g: 60, fat_g: 50, carbs_g: 200, ...overrides.intake },
  meal_count: 2,
  coverage: { ratio: 2 / 3, adequate: true, ...overrides.coverage },
  weight_kg: null,
  weight_trend_kg: null,
  body_fat_pct: null,
  steps: null,
  expenditure_kcal: 2000,
  energy_balance_kcal: -300,
  ...overrides,
});

const makeDays = (count = 21) => Array.from({ length: count }, (_, index) => {
  const date = dateAt('2026-06-25', index);
  const day = makeDay(date);
  if (index === 0) day.weight_kg = 70;
  if (index === count - 2) day.weight_kg = 70;
  if (index === count - 1) day.weight_kg = 69;
  if (index >= count - 7 && index < count - 2) day.steps = 5000;
  return day;
});

const goals = {
  calories_kcal: 2000,
  protein_g: 100,
  fat_g: 70,
  carbs_g: 250,
  target_weight_kg: 65,
};

const food = (date, mealType) => [
  'meal_id', `${date}T01:00:00+09:00`, mealType, '食事', 500, 20, 10, 40, 'manual', '',
];

const health = (date, steps, weight = '', expenditure = 2000) => [date, steps, expenditure, weight, ''];
const headers = ['date', 'steps', 'total_calories_kcal', 'weight_kg', 'body_fat_pct'];

function dashboardFor(adequateDays, weightDays = 0, activityDays = 0) {
  const dates = Array.from({ length: 7 }, (_, index) => dateAt('2026-07-09', index));
  const foodLogs = dates.slice(0, adequateDays).flatMap((date) => [food(date, '朝'), food(date, '昼')]);
  const healthRows = dates.slice(0, Math.max(weightDays, activityDays)).map((date, index) =>
    health(date, index < activityDays ? 1000 : '', index < weightDays ? 70 : '', index < activityDays ? 2000 : ''));
  return dashboard.buildDashboardData({
    rangeDays: 7,
    now: '2026-07-15',
    foodLogs,
    healthRows,
    healthHeaders: headers,
    targets: [],
  });
}

test('CoachRules.jsはDashboardMetricsの確度計算を共有し、境界値を保つ', () => {
  assert.doesNotMatch(coachSource, /(?:^|\n)\s*(?:import|export)\s/m);
  assert.match(coachSource, /calculateDashboardConfidence\(normalizedDays, rangeDays\)/);
  assert.equal(dashboardFor(2, 0, 2).confidence.nutrition, 'low');
  assert.equal(dashboardFor(3, 1, 3).confidence.nutrition, 'medium');
  assert.equal(dashboardFor(5, 3, 5).confidence.nutrition, 'high');
  assert.equal(dashboardFor(5, 1, 5).confidence.weight, 'medium');
  assert.equal(dashboardFor(5, 3, 5).confidence.weight, 'high');
  assert.equal(dashboardFor(5, 3, 2).confidence.activity, 'low');
  assert.equal(dashboardFor(5, 3, 3).confidence.activity, 'medium');
  assert.equal(dashboardFor(5, 3, 5).confidence.activity, 'high');

  const insight = coach.buildCoachInsight('trend', dashboardFor(2, 0, 2).days, {}, null);
  assert.equal(insight.source, 'rules');
  assert.equal(insight.confidence, 'low');
  assert.equal(insight.evidence[0].key, 'data_quality');
});

test('7種類の示唆を適用可否と優先順位付きで生成する', () => {
  const days = makeDays();
  const suggestions = coach.buildCoachEvidence('trend', days, goals, days.at(-1));
  assert.deepEqual(JSON.parse(JSON.stringify(suggestions.map(({ type }) => type))), [
    'today_next_meal',
    'weight_trend',
    'energy_pattern',
    'protein',
    'activity',
    'progress',
  ]);
  suggestions.forEach((suggestion) => {
    assert.ok(suggestion.evidence.length > 0);
    assert.equal(typeof suggestion.evidence[0].value, 'number');
    assert.ok(['low', 'medium', 'high'].includes(suggestion.confidence));
  });

  const todayOnly = coach.buildCoachEvidence('today', days, goals, days.at(-1));
  assert.deepEqual(JSON.parse(JSON.stringify(todayOnly.map(({ type }) => type))), ['today_next_meal']);
  const incompleteToday = makeDay(days.at(-1).date, { coverage: { ratio: 1 / 3, adequate: false } });
  assert.equal(coach.buildCoachEvidence('today', days, goals, incompleteToday)[0].type, 'data_quality');
});

test('行動候補は5テンプレートの条件を満たす場合だけ生成する', () => {
  const days = makeDays();
  const candidates = coach.buildCoachActionCandidates(days, goals, days.at(-1));
  assert.deepEqual(JSON.parse(JSON.stringify(candidates.map(({ key }) => key))), ['logging', 'energy', 'protein', 'macro_balance', 'activity']);
  assert.match(candidates.find(({ key }) => key === 'energy').text, /残り300kcal/);
  assert.equal(candidates.find(({ key }) => key === 'activity').text, '明日は5000歩を目安にする');

  const noNumericConditions = days.map((day) => ({
    ...day,
    steps: null,
  }));
  const completeToday = makeDay(days.at(-1).date, {
    intake: { calories_kcal: 2100, protein_g: 100, fat_g: 70, carbs_g: 250 },
  });
  const restricted = coach.buildCoachActionCandidates(noNumericConditions, goals, completeToday);
  assert.deepEqual(JSON.parse(JSON.stringify(restricted.map(({ key }) => key))), ['logging']);
});

test('候補は優先順位順に最大3組へ組み立てられる', () => {
  const days = makeDays();
  const evidence = coach.buildCoachEvidence('trend', days, goals, days.at(-1));
  const actions = coach.buildCoachActionCandidates(days, goals, days.at(-1));
  const pairs = coach.buildCoachCandidatePairs(evidence, actions);
  assert.equal(pairs.length, 3);
  assert.deepEqual(JSON.parse(JSON.stringify(pairs.map(({ type }) => type))), ['today_next_meal', 'weight_trend', 'energy_pattern']);
  pairs.forEach((pair) => {
    assert.ok(pair.evidence_key);
    assert.ok(pair.action_key);
  });
});

test('AI応答は未知キー、組み合わせ不一致、長さ超過、数字混入を拒否する', () => {
  const candidates = [
    { evidence_key: 'protein', action_key: 'protein' },
    { evidence_key: 'activity', action_key: 'activity' },
  ];
  const valid = {
    headline: 'タンパク質を補う機会をつくる',
    summary: '次の一食でタンパク質源を意識しましょう。',
    evidence_key: 'protein',
    action_key: 'protein',
  };
  assert.deepEqual(JSON.parse(JSON.stringify(coach.validateCoachAiResponse(candidates, valid))), valid);
  assert.equal(coach.validateCoachAiResponse(candidates, { ...valid, evidence_key: 'unknown' }), null);
  assert.equal(coach.validateCoachAiResponse(candidates, { ...valid, action_key: 'activity' }), null);
  assert.equal(coach.validateCoachAiResponse(candidates, { ...valid, headline: 'あ'.repeat(41) }), null);
  assert.equal(coach.validateCoachAiResponse(candidates, { ...valid, summary: 'あ'.repeat(161) }), null);
  assert.equal(coach.validateCoachAiResponse(candidates, { ...valid, summary: '残り300kcalです。' }), null);
  assert.equal(coach.validateCoachAiResponse(candidates, { ...valid, summary: '残り３００キロカロリーです。' }), null);
  assert.equal(coach.validateCoachAiResponse(candidates, { ...valid, evidence_key: '' }), null);
  assert.equal(coach.validateCoachAiResponse([], valid), null);
  assert.equal(coach.validateCoachAiResponse(candidates, null), null);
});

test('buildCoachInsightはrules由来の主候補と代替候補を返す', () => {
  const days = makeDays();
  const insight = coach.buildCoachInsight('trend', days, goals, days.at(-1));
  assert.equal(insight.scope, 'trend');
  assert.equal(insight.source, 'rules');
  assert.equal(insight.selected_action.key, 'macro_balance');
  assert.equal(insight.alternative_action.key, 'activity');
  assert.equal(insight.evidence[0].key, 'today_next_meal');
  assert.match(insight.generated_at, /^2026-07-15T00:00:00\.000\+09:00$/);
});
