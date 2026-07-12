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

test('openAiImageInfoFromBytes: PNG/JPEGの実寸と形式をファイルヘッダから読む', () => {
  const png = Uint8Array.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d, 0x49, 0x48, 0x44, 0x52,
    0, 0, 0x06, 0, 0, 0, 0x04, 0,
  ]);
  const jpeg = Uint8Array.from([
    0xff, 0xd8, 0xff, 0xc0, 0, 0x11, 0x08, 0x04, 0, 0x06, 0, 0x03,
    0x01, 0x11, 0, 0x02, 0x11, 0x01, 0x03, 0x11, 0x01,
  ]);

  const pngInfo = budget.openAiImageInfoFromBytes(png);
  const jpegInfo = budget.openAiImageInfoFromBytes(jpeg);
  assert.equal(pngInfo.mimeType, 'image/png');
  assert.equal(pngInfo.widthPx, 1536);
  assert.equal(pngInfo.heightPx, 1024);
  assert.equal(jpegInfo.mimeType, 'image/jpeg');
  assert.equal(jpegInfo.widthPx, 1536);
  assert.equal(jpegInfo.heightPx, 1024);
  assert.equal(budget.openAiImageInfoFromBytes(Uint8Array.from([1, 2, 3, 4])), null);
});

test('utf8ByteLength: ASCII/日本語/サロゲートペア(絵文字)を正しく数える', () => {
  assert.equal(budget.utf8ByteLength('abc'), 3);
  assert.equal(budget.utf8ByteLength('あいう'), 9); // 3文字 × 3byte
  assert.equal(budget.utf8ByteLength('😀'), 4); // サロゲートペア1文字 = 4byte
  assert.equal(budget.utf8ByteLength(''), 0);
});

test('openAiCalculateReservation: テキスト専用でUTF-8バイト長を予約する(文字数/2は使わない)', () => {
  const promptText = 'あ'.repeat(50); // 50文字 × 3byte = 150byte
  const tokens = budget.openAiCalculateReservation({
    promptText,
    maxOutputTokens: 800,
    reasoningTokenBudget: 300,
  });
  // prompt=150(byte長), output=800, reasoning=300, margin=500
  assert.equal(tokens, 150 + 800 + 300 + 500);
});

test('openAiCalculateReservation: 画像の安全側仮予約を加算する', () => {
  const tokens = budget.openAiCalculateReservation({
    promptText: '画像を解析',
    maxOutputTokens: 1200,
    imageReservationTokens: 100000,
  });
  assert.equal(
    tokens,
    budget.utf8ByteLength('画像を解析') + 1200 + 100000 + budget.OPENAI_RESERVATION_SAFETY_MARGIN_TOKENS,
  );
});

test('openAiCalculateReservation: 日本語プロンプトは文字数/2による過小評価をしない', () => {
  const promptText = 'あ'.repeat(50);
  const naiveCharBasedEstimate = Math.ceil(promptText.length / 2); // 旧実装の見積り(25)
  const tokens = budget.openAiCalculateReservation({ promptText, maxOutputTokens: 0 });
  const promptReservation = tokens - budget.OPENAI_RESERVATION_SAFETY_MARGIN_TOKENS;
  assert.ok(
    promptReservation > naiveCharBasedEstimate,
    `UTF-8バイト長(${promptReservation})は文字数/2(${naiveCharBasedEstimate})より小さくなってはいけない`,
  );
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
    usage,
    group: budget.OPENAI_ECONOMY_GROUP,
    reservationTokens: 1,
    appLimits: budget.OPENAI_APP_SAFETY_LIMITS,
  });
  assert.equal(result.allowed, false);
});
