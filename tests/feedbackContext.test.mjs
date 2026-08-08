import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const feedbackSource = await readFile(new URL('../gas/FeedbackContext.js', import.meta.url), 'utf8');
const codeSource = await readFile(new URL('../gas/Code.gs', import.meta.url), 'utf8');
const feedbackModule = { exports: {} };
vm.runInNewContext(feedbackSource, { module: feedbackModule });
const feedback = feedbackModule.exports;

const meal = (meal_type, description = meal_type) => ({
  meal_type,
  description,
  calories_kcal: 500,
  protein_g: 20,
  fat_g: 10,
  carbs_g: 60,
});

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

test('FeedbackContext.jsはGAS互換の単一モジュールである', () => {
  assert.doesNotMatch(feedbackSource, /(?:^|\n)\s*(?:import|export)\s/m);
  assert.equal(typeof feedback.buildTodayFeedbackContext, 'function');
  assert.equal(typeof feedback.buildTodayFeedbackPrompt, 'function');
});

test('3食そろい: 締めの講評と明日への一手を要求し、次の一食を要求しない', () => {
  const context = feedback.buildTodayFeedbackContext(
    [meal('朝'), meal('昼'), meal('夜')],
    { calories_kcal: 1800, protein_g: 90, fat_g: 60, carbs_g: 220 },
    '19:30',
  );
  const prompt = feedback.buildTodayFeedbackPrompt(context);

  assert.equal(context.main_meal_count, 3);
  assert.equal(context.is_main_meals_complete, true);
  assert.match(prompt, /評価時点: 19:30/);
  assert.match(prompt, /記録済み食事タイプ: 朝、昼、夜/);
  assert.match(prompt, /締めの講評と明日への一手/);
  assert.doesNotMatch(prompt, /次の一食の提案/);
  assert.match(prompt, /できている点を先に1つ挙げて/);
  assert.match(prompt, /断定しすぎず、医療助言ではなく/);
});

test('昼まで: 残り予算を踏まえた次の一食を要求する', () => {
  const context = feedback.buildTodayFeedbackContext(
    [meal('朝'), meal('昼')],
    { calories_kcal: 1800, protein_g: 90, fat_g: 60, carbs_g: 220 },
    '13:05',
  );
  const prompt = feedback.buildTodayFeedbackPrompt(context);

  assert.equal(context.main_meal_count, 2);
  assert.equal(context.is_main_meals_complete, false);
  assert.match(prompt, /残り予算/);
  assert.match(prompt, /次の一食の配分/);
  assert.match(prompt, /calories_kcal: 合計 1000 \/ 目標 1800 \/ 差分 800/);
});

test('間食のみ: 記録タイプを保持し、途中向けの現行導線を使う', () => {
  const context = feedback.buildTodayFeedbackContext(
    [meal('間食')],
    { calories_kcal: 1800, protein_g: 90, fat_g: 60, carbs_g: 220 },
    '10:00',
  );
  const prompt = feedback.buildTodayFeedbackPrompt(context);

  assert.deepEqual(plain(context.meal_types), ['間食']);
  assert.equal(context.main_meal_count, 0);
  assert.match(prompt, /記録済み食事タイプ: 間食/);
  assert.match(prompt, /次の一食の配分/);
});

test('目標未設定: 未設定を明示し、差分値を捏造しない', () => {
  const context = feedback.buildTodayFeedbackContext(
    [meal('朝')],
    { calories_kcal: null, protein_g: 90, fat_g: undefined, carbs_g: 220 },
    '08:10',
  );
  const prompt = feedback.buildTodayFeedbackPrompt(context);

  assert.match(prompt, /calories_kcal: 目標未設定/);
  assert.match(prompt, /fat_g: 目標未設定/);
  assert.doesNotMatch(prompt, /calories_kcal: .*差分/);
  assert.doesNotMatch(prompt, /fat_g: .*差分/);
  assert.match(prompt, /protein_g: 合計 20 \/ 目標 90 \/ 差分 70/);
});

test('PFC合計は既存sumMealsと同じく各加算時に小数1桁へ丸める', () => {
  const meals = [meal('朝'), meal('昼'), meal('夜')].map((entry) => ({
    ...entry,
    protein_g: 20.5,
    fat_g: 10.1,
    carbs_g: 25.1,
  }));
  const context = feedback.buildTodayFeedbackContext(
    meals,
    { calories_kcal: 2000, protein_g: 100, fat_g: 50, carbs_g: 100 },
    '20:00',
  );
  const prompt = feedback.buildTodayFeedbackPrompt(context);

  assert.deepEqual(plain(context.total), {
    calories_kcal: 1500,
    protein_g: 61.5,
    fat_g: 30.3,
    carbs_g: 75.3,
  });
  assert.match(prompt, /合計: 1500kcal \/ P61\.5g \/ F30\.3g \/ C75\.3g/);
  assert.doesNotMatch(prompt, /75\.30000000000001/);
});

function loadCodeContext() {
  const context = {
    console,
    module: { exports: {} },
    Session: { getScriptTimeZone: () => 'Asia/Tokyo' },
    Utilities: {
      formatDate: (date, _timezone, format) => format === 'HH:mm' ? '19:30' : '2026-08-08',
    },
  };
  // Code.gs is evaluated here only to exercise its GAS boundary functions;
  // all external APIs used by the tested paths are replaced below.
  vm.runInNewContext(feedbackSource, context);
  vm.runInNewContext(codeSource, context);
  return context;
}

test('summarizeTodayFeedbackはGAS境界で目標と評価時刻を純粋プロンプトへ渡す', () => {
  const context = loadCodeContext();
  let capturedPrompt = '';
  context.listMealsForFeedbackWindow = () => [meal('朝')];
  context.getTargets = () => ({ calories_kcal: 1800, protein_g: null, fat_g: 60, carbs_g: 220 });
  context.runAiText = (prompt) => { capturedPrompt = prompt; return { text: 'コメント', fallback_notice: '' }; };

  const result = context.summarizeTodayFeedback();

  assert.equal(result.date, '2026-08-08');
  assert.equal(result.total.calories_kcal, 500);
  assert.match(capturedPrompt, /評価時点: 19:30/);
  assert.match(capturedPrompt, /calories_kcal: 合計 500 \/ 目標 1800 \/ 差分 1300/);
  assert.match(capturedPrompt, /protein_g: 目標未設定/);
});

test('summarizeWeeklyFeedbackは当日のレビューをキャッシュせず、同日2回生成する', () => {
  const context = loadCodeContext();
  let trendCall = 0;
  let aiCall = 0;
  const appended = [];
  context.getWeeklyTrend = () => {
    trendCall += 1;
    return {
      window_start: '2026-08-02',
      window_end: '2026-08-08',
      targets: { calories_kcal: null, protein_g: null, fat_g: null, carbs_g: null },
      days: [{ count: 1, total: { calories_kcal: trendCall * 500, protein_g: 20, fat_g: 10, carbs_g: 60 } }],
    };
  };
  context.getLatestWeeklyReview = () => ({
    generated_at: '2026-08-08T10:00:00.000Z',
    window_start: '2026-08-02',
    window_end: '2026-08-08',
    text: '古いコメント',
  });
  context.sumMeals = (values) => values.reduce((sum, value) => ({
    calories_kcal: sum.calories_kcal + value.calories_kcal,
    protein_g: sum.protein_g + value.protein_g,
    fat_g: sum.fat_g + value.fat_g,
    carbs_g: sum.carbs_g + value.carbs_g,
  }), { calories_kcal: 0, protein_g: 0, fat_g: 0, carbs_g: 0 });
  context.roundToTenth = (value) => Math.round(value * 10) / 10;
  context.runAiText = () => ({ text: `新しいコメント${++aiCall}`, fallback_notice: '' });
  context.getWeeklyReviewSheet = () => ({ appendRow: (row) => appended.push(row) });

  const first = context.summarizeWeeklyFeedback();
  const second = context.summarizeWeeklyFeedback();

  assert.equal(trendCall, 2);
  assert.equal(aiCall, 2);
  assert.equal(first.text, '新しいコメント1');
  assert.equal(second.text, '新しいコメント2');
  assert.equal(appended.length, 2);
});
