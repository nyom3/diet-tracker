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
  assert.doesNotThrow(() => context.generateCoachInsight({ scope: 'today', range_days: 90 }));
});
