import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const dashboardSource = await readFile(new URL('../gas/DashboardMetrics.js', import.meta.url), 'utf8');
const coachSource = await readFile(new URL('../gas/CoachRules.js', import.meta.url), 'utf8');
const codeSource = await readFile(new URL('../gas/Code.gs', import.meta.url), 'utf8');

const pairOne = {
  evidence_key: 'protein',
  action_key: 'protein',
  evidence: [{ key: 'protein', label: 'タンパク質', value: 20, unit: 'g', comparison_value: 80, comparison_label: '目標', period_start: '2026-07-15', period_end: '2026-07-15', confidence: 'medium' }],
  action: { key: 'protein', category: 'protein', text: '次の一食にタンパク質源を1品追加する', target_date: '2026-07-16' },
  confidence: 'medium',
  type: 'protein',
};

const pairTwo = {
  evidence_key: 'activity',
  action_key: 'activity',
  evidence: [{ key: 'activity', label: '歩数', value: 5000, unit: 'steps', comparison_value: 6000, comparison_label: '直近平均', period_start: '2026-07-15', period_end: '2026-07-15', confidence: 'high' }],
  action: { key: 'activity', category: 'activity', text: '明日は6000歩を目安にする', target_date: '2026-07-16' },
  confidence: 'high',
  type: 'activity',
};

const rulesInsight = {
  generated_at: '2026-07-15T00:00:00.000+09:00',
  scope: 'trend',
  source: 'rules',
  headline: 'ルール見出し',
  summary: 'ルールによる案内です。',
  confidence: 'medium',
  evidence: pairOne.evidence,
  selected_action: pairOne.action,
  alternative_action: pairTwo.action,
};

function createContext({ pairs = [pairOne, pairTwo], aiResult = { ok: false, reason: 'テスト障害' }, scope = 'trend' } = {}) {
  const context = { module: { exports: {} } };
  vm.runInNewContext(dashboardSource, context);
  vm.runInNewContext(coachSource, context);
  vm.runInNewContext(codeSource, context);
  let aiCalls = 0;
  context.getCoachDashboardContext = () => ({
    dashboard: {
      window_end: '2026-07-15',
      window_start: '2026-07-09',
      goals: {},
      days: [],
      confidence: { nutrition: 'medium', weight: 'low', activity: 'low' },
      summary: {},
    },
    meals: [],
  });
  context.buildCoachInsight = () => rulesInsight;
  context.buildCoachEvidence = () => pairs.map((pair) => ({ type: pair.type, evidence: pair.evidence, confidence: pair.confidence }));
  context.buildCoachActionCandidates = () => pairs.map((pair) => pair.action);
  context.buildCoachCandidatePairs = () => pairs;
  context.buildCoachAiPrompt = () => 'テストプロンプト';
  context.runAiJson = () => {
    aiCalls += 1;
    return aiResult;
  };
  context.extractJson = (value) => value;
  return {
    context,
    getAiCalls: () => aiCalls,
    scope,
  };
}

test('AIプロンプトは候補keyの意味を示し、記録十分日のみ平均し、途中日の栄養値は伏せる', () => {
  const context = { module: { exports: {} } };
  vm.runInNewContext(dashboardSource, context);
  vm.runInNewContext(coachSource, context);
  vm.runInNewContext(codeSource, context);
  context.Utilities = { formatDate: (date) => date.toISOString().slice(0, 10) };
  context.Session = { getScriptTimeZone: () => 'Asia/Tokyo' };
  const makePromptDay = (date, adequate, intake) => ({
    date,
    meal_count: adequate ? 2 : 1,
    coverage: { ratio: adequate ? 2 / 3 : 1 / 3, adequate },
    intake: { calories_kcal: intake[0], protein_g: intake[1], fat_g: intake[2], carbs_g: intake[3] },
    steps: null,
    weight_trend_kg: null,
  });
  const dashboardContext = {
    dashboard: {
      window_start: '2026-07-09',
      window_end: '2026-07-11',
      goals: { calories_kcal: 2000, protein_g: 100, fat_g: 70, carbs_g: 250 },
      days: [
        makePromptDay('2026-07-09', false, [500, 10, 10, 50]),
        makePromptDay('2026-07-10', true, [1800, 80, 60, 220]),
        makePromptDay('2026-07-11', true, [2000, 100, 70, 250]),
      ],
      confidence: { nutrition: 'medium', weight: 'low', activity: 'low' },
      summary: {},
    },
    meals: [{ timestamp: '2026-07-11T12:00:00+09:00', meal_type: '昼', description: '昼食' }],
  };
  const incompleteToday = makePromptDay('2026-07-11', false, [500, 10, 10, 50]);
  const candidatePairs = [{
    evidence_key: 'fat_g',
    action_key: 'today_balance',
    action: { key: 'today_balance', text: '脂質の多い食材を低脂質なものへ置き換える' },
    evidence: [{ key: 'fat_g', value: 65, comparison_value: 70 }],
  }];

  const trendPrompt = context.buildCoachAiPrompt('trend', dashboardContext, incompleteToday, candidatePairs, 'macros');
  const trendPayload = JSON.parse(trendPrompt.slice(trendPrompt.lastIndexOf('\n') + 1));
  assert.equal(trendPayload.averages.calories_kcal, 1900);
  assert.equal(trendPayload.averages.protein_g, 90);
  assert.equal(trendPayload.goal_gaps.protein_g, -10);
  assert.equal(trendPayload.candidates[0].action_key, 'today_balance');
  assert.equal(Object.hasOwn(trendPayload.candidates[0], 'action_text'), false);
  assert.match(trendPrompt, /today_balance=今日のPFC差に沿った置き換えや配分調整/);

  const todayPrompt = context.buildCoachAiPrompt('today', dashboardContext, incompleteToday, candidatePairs, null);
  const todayPayload = JSON.parse(todayPrompt.slice(todayPrompt.lastIndexOf('\n') + 1));
  assert.equal(todayPayload.averages.calories_kcal, null);
  assert.equal(todayPayload.averages.protein_g, null);
  assert.equal(todayPayload.goal_gaps.protein_g, null);
  assert.equal(todayPayload.summary.average_protein_g, null);
  assert.match(todayPrompt, /記録が不十分な場合は不足を断定せず判断を保留/);
});

test('候補0件ではAIを呼ばず、ルール結果を返す', () => {
  const { context, getAiCalls } = createContext({ pairs: [] });
  const result = context.generateCoachInsight({ scope: 'trend', range_days: 30 });

  assert.equal(getAiCalls(), 0);
  assert.equal(result.source, 'rules');
  assert.equal(result.headline, rulesInsight.headline);
});

test('AI正常時も選択済みの根拠・行動はサーバー候補から再構成する', () => {
  const { context, getAiCalls } = createContext({
    aiResult: {
      ok: true,
      text: JSON.stringify({
        headline: '活動を少し増やす',
        summary: '次の行動を一つ選びましょう。',
        evidence_key: 'activity',
        action_key: 'activity',
      }),
      fallback_notice: '',
    },
  });
  const result = context.generateCoachInsight({ scope: 'trend', range_days: 30 });

  assert.equal(getAiCalls(), 1);
  assert.equal(result.source, 'ai');
  assert.equal(result.headline, '活動を少し増やす');
  assert.equal(result.selected_action, pairTwo.action);
  assert.deepEqual(JSON.parse(JSON.stringify(result.evidence)), pairTwo.evidence);
});

test('AI不正応答は優先度1位のルール結果へ戻しfallback_noticeを設定する', () => {
  const { context, getAiCalls } = createContext({
    aiResult: { ok: true, text: JSON.stringify({ headline: '不正', summary: '数字300を含む', evidence_key: 'unknown', action_key: 'unknown' }), fallback_notice: 'Geminiへfallback' },
  });
  const result = context.generateCoachInsight({ scope: 'trend', range_days: 30 });

  assert.equal(getAiCalls(), 1);
  assert.equal(result.source, 'rules');
  assert.equal(result.selected_action, pairOne.action);
  assert.match(result.fallback_notice, /AIの応答を確認できないため/);
  assert.match(result.fallback_notice, /Geminiへfallback/);
});

test('AI呼び出し失敗は例外にせずルール結果へ戻す', () => {
  const { context, getAiCalls } = createContext({
    aiResult: { ok: false, reason: '予算上限に達しました。' },
  });
  const result = context.generateCoachInsight({ scope: 'today' });

  assert.equal(getAiCalls(), 1);
  assert.equal(result.source, 'rules');
  assert.equal(result.selected_action, pairOne.action);
  assert.match(result.fallback_notice, /予算上限に達しました/);
});

test('コーチJSONのパース失敗はGemini/OpenAIの形状だけを記録してルール結果へ戻す', () => {
  ['gemini', 'openai'].forEach((provider) => {
    const { context } = createContext({
      aiResult: {
        ok: true,
        text: provider === 'gemini' ? '{食事名を含む未完了' : '{openai食事未完了',
        fallback_notice: '',
        provider,
        finish_reason: provider === 'gemini' ? 'MAX_TOKENS' : undefined,
        parts_count: provider === 'gemini' ? 2 : undefined,
      },
    });
    const logs = [];
    context.recordAiCallLog = (entry) => logs.push(entry);

    const result = context.generateCoachInsight({ scope: 'trend', range_days: 30 });

    assert.equal(result.source, 'rules');
    assert.equal(logs.length, 1);
    assert.equal(logs[0].stage, 'coach_json_parse');
    assert.equal(logs[0].provider, provider);
    assert.match(logs[0].diagnostics, /^finish_reason=(?:MAX_TOKENS)?;text_len=\d+;parts=\d+;head_brace=1;tail_brace=0$/);
    assert.equal(JSON.stringify(logs).includes('食事名'), false);
    assert.equal(JSON.stringify(logs).includes('openai食事'), false);
  });
});

test('diagnosticsの組み立て失敗でも既存のルールフォールバックを返す', () => {
  const { context } = createContext({
    aiResult: {
      ok: true,
      text: '{未完了',
      fallback_notice: '',
      provider: 'gemini',
      finish_reason: 'MAX_TOKENS',
      parts_count: 1,
    },
  });
  const logs = [];
  context.recordAiCallLog = (entry) => logs.push(entry);
  context.buildCoachJsonDiagnostics = () => { throw new Error('診断失敗'); };

  const result = context.generateCoachInsight({ scope: 'trend', range_days: 30 });

  assert.equal(result.source, 'rules');
  assert.equal(logs.length, 1);
  assert.equal(logs[0].stage, 'coach_json_parse');
  assert.equal(logs[0].diagnostics, '');
});

test('scopeと期間をサーバー境界で検証する', () => {
  const { context } = createContext();
  assert.throws(() => context.generateCoachInsight({ scope: 'unknown' }), /対象が不正/);
  assert.throws(() => context.generateCoachInsight({ scope: 'trend', range_days: 14 }), /期間は7、30、90/);
  assert.throws(() => context.generateCoachInsight({ scope: 'trend', range_days: 30, focus: 'unknown' }), /観点が不正/);
  assert.doesNotThrow(() => context.generateCoachInsight({ scope: 'trend', range_days: 30, focus: 'weight' }));
  assert.doesNotThrow(() => context.generateCoachInsight({ scope: 'today', range_days: 90 }));
});
