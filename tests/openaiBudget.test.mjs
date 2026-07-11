import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import vm from 'node:vm';

// gas/*.gs は GAS実行を想定した無拡張子スタイルのプレーンJSで、Nodeのモジュール解決には乗らない。
// ソースをそのまま仮想contextで実行し、末尾のmodule.exports分岐で関数群を取り出す。
const dir = path.dirname(fileURLToPath(import.meta.url));
const source = readFileSync(path.join(dir, '../gas/OpenAiBudget.gs'), 'utf8');
const sandboxModule = { exports: {} };
vm.runInNewContext(source, { module: sandboxModule, console });
const budget = sandboxModule.exports;

const DAY_MS = 24 * 60 * 60 * 1000;
const BASE = Date.parse('2026-07-10T12:00:00Z');

test('openAiRolloverDailyUsage: 同一UTC日付なら値を維持する', () => {
  const usage = budget.openAiEmptyDailyUsage('2026-07-10');
  usage.economyTokens = 1000;
  const rolled = budget.openAiRolloverDailyUsage(usage, BASE);
  assert.equal(rolled.economyTokens, 1000);
  assert.equal(rolled.dateUtc, '2026-07-10');
});

test('openAiRolloverDailyUsage: UTC日付が変わったら全カウンタをゼロへ戻す', () => {
  const usage = budget.openAiEmptyDailyUsage('2026-07-09');
  usage.economyTokens = 999999;
  usage.reservedPremiumTokens = 5000;
  const rolled = budget.openAiRolloverDailyUsage(usage, BASE);
  assert.equal(rolled.dateUtc, '2026-07-10');
  assert.equal(rolled.economyTokens, 0);
  assert.equal(rolled.reservedPremiumTokens, 0);
});

test('openAiCanReserve: 使用実績+予約+今回tokenが上限以下なら true', () => {
  const usage = budget.openAiEmptyDailyUsage('2026-07-10');
  usage.economyTokens = 100;
  usage.reservedEconomyTokens = 50;
  assert.equal(budget.openAiCanReserve(usage, budget.OPENAI_ECONOMY_GROUP, 50, 200), true);
});

test('openAiCanReserve: 境界値ちょうどはtrue、1超過でfalse', () => {
  const usage = budget.openAiEmptyDailyUsage('2026-07-10');
  usage.economyTokens = 100;
  assert.equal(budget.openAiCanReserve(usage, budget.OPENAI_ECONOMY_GROUP, 100, 200), true);
  assert.equal(budget.openAiCanReserve(usage, budget.OPENAI_ECONOMY_GROUP, 101, 200), false);
});

test('openAiReserve → openAiCommitSuccess: 予約が実績へ正しく置き換わる', () => {
  let usage = budget.openAiEmptyDailyUsage('2026-07-10');
  usage = budget.openAiReserve(usage, budget.OPENAI_PREMIUM_GROUP, 1000, '2026-07-10T12:00:00Z');
  assert.equal(usage.reservedPremiumTokens, 1000);
  assert.equal(usage.requestCount, 1);

  usage = budget.openAiCommitSuccess(usage, budget.OPENAI_PREMIUM_GROUP, 1000, 640, '2026-07-10T12:00:05Z');
  assert.equal(usage.reservedPremiumTokens, 0);
  assert.equal(usage.premiumTokens, 640);
});

test('openAiCommitFailure: 失敗時は予約分をそのまま使用実績に積む(安全側)', () => {
  let usage = budget.openAiEmptyDailyUsage('2026-07-10');
  usage = budget.openAiReserve(usage, budget.OPENAI_ECONOMY_GROUP, 2000);
  usage = budget.openAiCommitFailure(usage, budget.OPENAI_ECONOMY_GROUP, 2000);
  assert.equal(usage.reservedEconomyTokens, 0);
  assert.equal(usage.economyTokens, 2000);
});

test('連続予約が正しく積算され、上限直前で3件目が拒否される(疑似同時実行)', () => {
  let usage = budget.openAiEmptyDailyUsage('2026-07-10');
  const appLimit = 1000;

  assert.equal(budget.openAiCanReserve(usage, budget.OPENAI_ECONOMY_GROUP, 400, appLimit), true);
  usage = budget.openAiReserve(usage, budget.OPENAI_ECONOMY_GROUP, 400);

  assert.equal(budget.openAiCanReserve(usage, budget.OPENAI_ECONOMY_GROUP, 400, appLimit), true);
  usage = budget.openAiReserve(usage, budget.OPENAI_ECONOMY_GROUP, 400);

  // 400+400+400=1200 > 1000 のため3件目は予約できない
  assert.equal(budget.openAiCanReserve(usage, budget.OPENAI_ECONOMY_GROUP, 400, appLimit), false);
});

test('openAiEstimateImageTokens: 1024x1024で保守的なtoken数を返す', () => {
  const tokens = budget.openAiEstimateImageTokens(1024, 1024);
  // 32x32=1024パッチ × 1.3 を切り上げ
  assert.equal(tokens, 1332);
});

test('openAiCalculateReservation: プロンプト+画像+出力+マージンを合算する', () => {
  const tokens = budget.openAiCalculateReservation({
    promptCharLength: 200,
    imageWidthPx: 1024,
    imageHeightPx: 1024,
    maxOutputTokens: 800,
    reasoningTokenBudget: 300,
  });
  // ceil(200/2)=100, image=1332, output=800, reasoning=300, margin=500
  assert.equal(tokens, 100 + 1332 + 800 + 300 + 500);
});

test('openAiEvaluateEligibility: 未確認・一時停止・期限切れ・有効を判定する', () => {
  assert.equal(budget.openAiEvaluateEligibility(null, BASE).status, 'paused');
  assert.equal(budget.openAiEvaluateEligibility({ status: 'paused' }, BASE).status, 'paused');
  assert.equal(budget.openAiEvaluateEligibility({}, BASE).status, 'unconfirmed');
  assert.equal(
    budget.openAiEvaluateEligibility({ status: 'confirmed', confirmedAt: BASE - 31 * DAY_MS }, BASE).status,
    'expired',
  );
  assert.equal(
    budget.openAiEvaluateEligibility({ status: 'confirmed', confirmedAt: BASE - 29 * DAY_MS }, BASE).status,
    'confirmed',
  );
});

test('openAiEvaluateRuleFreshness: 未確認・7日超過・変更検知・鮮度OKを判定する', () => {
  assert.equal(budget.openAiEvaluateRuleFreshness(null, BASE).status, 'stopped');
  assert.equal(
    budget.openAiEvaluateRuleFreshness({ lastSuccessAt: BASE - 8 * DAY_MS, lastKnownGood: true }, BASE).status,
    'stopped',
  );
  assert.equal(
    budget.openAiEvaluateRuleFreshness(
      { lastSuccessAt: BASE - DAY_MS, lastCheckedAt: BASE - DAY_MS, lastKnownGood: false },
      BASE,
    ).status,
    'stopped',
  );
  const ok = budget.openAiEvaluateRuleFreshness(
    { lastSuccessAt: BASE - DAY_MS, lastCheckedAt: BASE - DAY_MS - 1000, lastKnownGood: true },
    BASE,
  );
  assert.equal(ok.status, 'ok');
  assert.equal(ok.needsCheck, true); // 24hを超過しているので再確認が必要

  const freshOk = budget.openAiEvaluateRuleFreshness(
    { lastSuccessAt: BASE - DAY_MS, lastCheckedAt: BASE - 60 * 1000, lastKnownGood: true },
    BASE,
  );
  assert.equal(freshOk.needsCheck, false);
});

test('openAiEvaluateCallGate: geminiモードは無条件でブロック', () => {
  const result = budget.openAiEvaluateCallGate({ mode: 'gemini', nowEpochMs: BASE });
  assert.equal(result.allowed, false);
});

test('openAiEvaluateCallGate: 資格未確認ならauto/openaiどちらもブロック', () => {
  for (const mode of ['auto', 'openai']) {
    const result = budget.openAiEvaluateCallGate({
      mode,
      nowEpochMs: BASE,
      eligibilityState: {},
      ruleState: { lastSuccessAt: BASE - DAY_MS, lastCheckedAt: BASE - DAY_MS, lastKnownGood: true },
      usage: budget.openAiEmptyDailyUsage('2026-07-10'),
      group: budget.OPENAI_ECONOMY_GROUP,
      reservationTokens: 100,
    });
    assert.equal(result.allowed, false, `mode=${mode} が資格未確認でも許可されている`);
  }
});

test('openAiEvaluateCallGate: 全条件クリアで許可される', () => {
  const result = budget.openAiEvaluateCallGate({
    mode: 'auto',
    nowEpochMs: BASE,
    eligibilityState: { status: 'confirmed', confirmedAt: BASE - DAY_MS },
    ruleState: { lastSuccessAt: BASE - DAY_MS, lastCheckedAt: BASE - 60 * 1000, lastKnownGood: true },
    usage: budget.openAiEmptyDailyUsage('2026-07-10'),
    group: budget.OPENAI_ECONOMY_GROUP,
    reservationTokens: 100,
    appLimits: budget.OPENAI_APP_SAFETY_LIMITS,
  });
  assert.equal(result.allowed, true);
});

test('openAiEvaluateCallGate: OpenAIモードでも安全上限は無効化できない', () => {
  const usage = budget.openAiEmptyDailyUsage('2026-07-10');
  usage.economyTokens = budget.OPENAI_APP_SAFETY_LIMITS.economy;
  const result = budget.openAiEvaluateCallGate({
    mode: 'openai',
    nowEpochMs: BASE,
    eligibilityState: { status: 'confirmed', confirmedAt: BASE - DAY_MS },
    ruleState: { lastSuccessAt: BASE - DAY_MS, lastCheckedAt: BASE - 60 * 1000, lastKnownGood: true },
    usage,
    group: budget.OPENAI_ECONOMY_GROUP,
    reservationTokens: 1,
    appLimits: budget.OPENAI_APP_SAFETY_LIMITS,
  });
  assert.equal(result.allowed, false);
});
