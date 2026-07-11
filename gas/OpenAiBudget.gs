// OpenAI無料枠の安全判定は副作用のない純粋関数に閉じ込める。
// PropertiesService/LockService/UrlFetchApp 等のGAS APIはOpenAiProvider.gs側でのみ扱い、
// ここでは「値を渡すと判定結果を返す」関数のみを置き、tests/openaiBudget.test.mjs から
// vmでロードして単体テストできるようにする。

var OPENAI_ECONOMY_GROUP = 'economy'; // Luna / Terra mini・nano系
var OPENAI_PREMIUM_GROUP = 'premium'; // Sol・大型モデル系

var OPENAI_OFFICIAL_LIMITS = {
  economy: 2500000,
  premium: 250000,
};

// 公式無料枠の80%をアプリ側の安全上限とする(issue #44)。
var OPENAI_APP_SAFETY_LIMITS = {
  economy: Math.floor(OPENAI_OFFICIAL_LIMITS.economy * 0.8),
  premium: Math.floor(OPENAI_OFFICIAL_LIMITS.premium * 0.8),
};

var OPENAI_RULE_CACHE_FRESH_MS = 24 * 60 * 60 * 1000;
var OPENAI_RULE_STALE_LIMIT_MS = 7 * 24 * 60 * 60 * 1000;
var OPENAI_ELIGIBILITY_RECHECK_MS = 30 * 24 * 60 * 60 * 1000;
var OPENAI_RESERVATION_SAFETY_MARGIN_TOKENS = 500;

// 公開ページに引き続き存在しているべき文言・モデル名・枠の数値(検証できなければfail-closed)。
var OPENAI_RULE_REQUIRED_TERMS = ['complimentary', 'daily token'];
var OPENAI_RULE_REQUIRED_MODEL_TERMS = ['luna'];

function openAiUtcDateString(epochMs) {
  var d = new Date(epochMs);
  var y = d.getUTCFullYear();
  var m = String(d.getUTCMonth() + 1).padStart(2, '0');
  var day = String(d.getUTCDate()).padStart(2, '0');
  return y + '-' + m + '-' + day;
}

function openAiEmptyDailyUsage(dateUtc) {
  return {
    dateUtc: dateUtc,
    economyTokens: 0,
    premiumTokens: 0,
    reservedEconomyTokens: 0,
    reservedPremiumTokens: 0,
    requestCount: 0,
    lastUsedAt: '',
  };
}

// UTC日付が変わっていれば当日カウンタをゼロへ戻す。日本時間09:00の切り替わりに相当する。
function openAiRolloverDailyUsage(usage, nowEpochMs) {
  var today = openAiUtcDateString(nowEpochMs);
  if (!usage || usage.dateUtc !== today) {
    var next = openAiEmptyDailyUsage(today);
    if (usage && usage.lastUsedAt) {
      next.lastUsedAt = usage.lastUsedAt;
    }
    return next;
  }
  return usage;
}

function openAiUsedKey(group) {
  return group === OPENAI_PREMIUM_GROUP ? 'premiumTokens' : 'economyTokens';
}

function openAiReservedKey(group) {
  return group === OPENAI_PREMIUM_GROUP ? 'reservedPremiumTokens' : 'reservedEconomyTokens';
}

function openAiCloneUsage(usage) {
  return {
    dateUtc: usage.dateUtc,
    economyTokens: usage.economyTokens || 0,
    premiumTokens: usage.premiumTokens || 0,
    reservedEconomyTokens: usage.reservedEconomyTokens || 0,
    reservedPremiumTokens: usage.reservedPremiumTokens || 0,
    requestCount: usage.requestCount || 0,
    lastUsedAt: usage.lastUsedAt || '',
  };
}

// 使用実績+予約中token+今回のtokenがアプリ安全上限を超えないかを判定する。
// 呼び出し側はLockServiceの排他区間内でロールオーバー→この判定→openAiReserveを行うこと。
function openAiCanReserve(usage, group, requestedTokens, appLimit) {
  var used = usage[openAiUsedKey(group)] || 0;
  var reserved = usage[openAiReservedKey(group)] || 0;
  return used + reserved + requestedTokens <= appLimit;
}

function openAiReserve(usage, group, requestedTokens, nowIso) {
  var next = openAiCloneUsage(usage);
  var reservedKey = openAiReservedKey(group);
  next[reservedKey] = (next[reservedKey] || 0) + requestedTokens;
  next.requestCount = (next.requestCount || 0) + 1;
  if (nowIso) {
    next.lastUsedAt = nowIso;
  }
  return next;
}

// API成功時: 予約分を取り消し、実績(usage.total_tokens)を積む。
function openAiCommitSuccess(usage, group, reservedTokens, actualTokens, nowIso) {
  var next = openAiCloneUsage(usage);
  var reservedKey = openAiReservedKey(group);
  var usedKey = openAiUsedKey(group);
  next[reservedKey] = Math.max(0, (next[reservedKey] || 0) - reservedTokens);
  next[usedKey] = (next[usedKey] || 0) + Math.max(0, actualTokens);
  if (nowIso) {
    next.lastUsedAt = nowIso;
  }
  return next;
}

// API失敗時: 課金有無を断定できないため、予約していた最大token分をそのまま使用実績へ積む(安全側)。
function openAiCommitFailure(usage, group, reservedTokens, nowIso) {
  return openAiCommitSuccess(usage, group, reservedTokens, reservedTokens, nowIso);
}

// 32pxパッチ単位での保守的な画像token見積り。実際のAPI課金より多く見積もることはあっても
// 少なく見積もることがないよう、係数を1より大きく取る。
function openAiEstimateImageTokens(widthPx, heightPx) {
  var w = Math.max(1, Math.ceil(Number(widthPx) || 0));
  var h = Math.max(1, Math.ceil(Number(heightPx) || 0));
  var patches = Math.ceil(w / 32) * Math.ceil(h / 32);
  var conservativeTokensPerPatch = 1.3;
  return Math.ceil(patches * conservativeTokensPerPatch);
}

// UTF-8バイト長を返す。byte-level BPE(OpenAIのトークナイザ)ではtoken数はbyte数を超えない
// (各tokenは最低1byteを消費する)ため、これはtoken数の数学的に確実な上限として使える。
// 文字数ベースの見積り(例: 文字数/2)は日本語等マルチバイト入力で過小評価しうるため使わない。
function utf8ByteLength(text) {
  var str = String(text || '');
  var bytes = 0;
  for (var i = 0; i < str.length; i++) {
    var code = str.charCodeAt(i);
    if (code >= 0xd800 && code <= 0xdbff && i + 1 < str.length) {
      var next = str.charCodeAt(i + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        bytes += 4;
        i++;
        continue;
      }
    }
    if (code <= 0x7f) {
      bytes += 1;
    } else if (code <= 0x7ff) {
      bytes += 2;
    } else {
      bytes += 3;
    }
  }
  return bytes;
}

// プロンプト・画像・出力上限・reasoning予算・固定マージンから今回の最大消費tokenを見積もる。
function openAiCalculateReservation(params) {
  var p = params || {};
  var promptTokens = utf8ByteLength(p.promptText);
  var imageTokens = p.imageWidthPx && p.imageHeightPx
    ? openAiEstimateImageTokens(p.imageWidthPx, p.imageHeightPx)
    : 0;
  var maxOutputTokens = Number(p.maxOutputTokens) || 0;
  var reasoningTokens = Number(p.reasoningTokenBudget) || 0;
  return promptTokens + imageTokens + maxOutputTokens + reasoningTokens + OPENAI_RESERVATION_SAFETY_MARGIN_TOKENS;
}

function openAiStripHtmlTags(html) {
  return String(html || '').replace(/<[^>]*>/g, ' ');
}

function openAiExtractNumbers(text) {
  var matches = String(text || '').match(/\d[\d,]*\d|\d/g) || [];
  return matches
    .map(function (raw) { return parseInt(raw.replace(/,/g, ''), 10); })
    .filter(function (value) { return Number.isFinite(value); });
}

// 公開ページのプレーンテキストが、無料枠の説明・対象モデル・Tier1-2の枠の数値を
// 引き続き含んでいるかを検証する。いずれか一つでも確認できなければ false(fail-closed)を返す。
// 枠が公式に拡大されていても、ここでは「最低限この数値以上か」しか見ないため
// アプリの安全上限(OPENAI_APP_SAFETY_LIMITS)を自動で引き上げることはない。
//
// premium枠の数値は経済枠より小さいため「minPremiumLimit以上の数値が1つでもあればOK」だと、
// economy枠の大きな数値(例: 2,500,000 は 250,000 以上でもある)だけでpremium枠のチェックを
// すり抜けてしまう。そのため「minPremiumLimit以上の数値が2つ(economy用・premium用)ある」ことを
// 求める、やや保守的なヒューリスティックにしている。正確な構造化データではなく自由文からの
// 検証である以上、完全ではない前提で fail-closed 側に倒す設計とする。
function openAiPageIndicatesRuleOk(html, requiredTerms, requiredModelTerms, minEconomyLimit, minPremiumLimit) {
  var plainText = openAiStripHtmlTags(html).toLowerCase();

  var hasRequiredTerms = (requiredTerms || []).every(function (term) {
    return plainText.indexOf(String(term).toLowerCase()) >= 0;
  });
  var hasModelTerm = (requiredModelTerms || []).some(function (term) {
    return plainText.indexOf(String(term).toLowerCase()) >= 0;
  });

  if (!hasRequiredTerms || !hasModelTerm) {
    return false;
  }

  var numbers = openAiExtractNumbers(plainText);
  var hasEconomyLimit = numbers.some(function (n) { return n >= minEconomyLimit; });
  var premiumOrLargerCount = numbers.filter(function (n) { return n >= minPremiumLimit; }).length;

  return hasEconomyLimit && premiumOrLargerCount >= 2;
}

// アカウント資格(complimentary daily tokens対象)の状態を判定する。
// eligibilityState: { status: 'confirmed'|'paused'|undefined, confirmedAt: epochMs }
function openAiEvaluateEligibility(eligibilityState, nowEpochMs) {
  if (!eligibilityState || eligibilityState.status === 'paused') {
    return { status: 'paused', reason: 'OpenAIの利用が一時停止されています。' };
  }
  if (eligibilityState.status !== 'confirmed' || !eligibilityState.confirmedAt) {
    return { status: 'unconfirmed', reason: 'OpenAI無料枠のアカウント資格が未確認です。' };
  }
  if (nowEpochMs - eligibilityState.confirmedAt > OPENAI_ELIGIBILITY_RECHECK_MS) {
    return { status: 'expired', reason: 'アカウント資格の確認から30日以上経過しています。' };
  }
  return { status: 'confirmed', reason: '' };
}

// OpenAI公式ページの確認鮮度を判定する。
// ruleState: { lastCheckedAt: epochMs, lastSuccessAt: epochMs, lastKnownGood: boolean }
function openAiEvaluateRuleFreshness(ruleState, nowEpochMs) {
  var lastSuccessAt = (ruleState && ruleState.lastSuccessAt) || 0;
  var lastCheckedAt = (ruleState && ruleState.lastCheckedAt) || 0;
  var lastKnownGood = !!(ruleState && ruleState.lastKnownGood);

  if (!lastSuccessAt) {
    return { status: 'stopped', reason: '公開ルールを一度も確認できていません。', needsCheck: true };
  }
  if (nowEpochMs - lastSuccessAt > OPENAI_RULE_STALE_LIMIT_MS) {
    return { status: 'stopped', reason: '公開ルールを7日以上確認できていません。', needsCheck: true };
  }
  if (!lastKnownGood) {
    return {
      status: 'stopped',
      reason: '公開ルールの変更(対象モデル削除・枠縮小・解析不能)を検知しました。',
      needsCheck: nowEpochMs - lastCheckedAt > OPENAI_RULE_CACHE_FRESH_MS,
    };
  }
  return {
    status: 'ok',
    reason: '',
    needsCheck: nowEpochMs - lastCheckedAt > OPENAI_RULE_CACHE_FRESH_MS,
  };
}

// モード・資格・ルール鮮度・当日使用量+予約を統合し、今回OpenAIを呼んでよいかを判定する。
// mode 'gemini' は無条件でOpenAIを呼ばない。'auto'/'openai' はどちらも同じ安全ガードを通す
// (issue #44: OpenAIモードでも安全ガードは無効化できない)。
function openAiEvaluateCallGate(context) {
  if (context.mode === 'gemini') {
    return { allowed: false, reason: '手動でGeminiが選択されています。' };
  }

  var eligibility = openAiEvaluateEligibility(context.eligibilityState, context.nowEpochMs);
  if (eligibility.status !== 'confirmed') {
    return { allowed: false, reason: eligibility.reason };
  }

  var rule = openAiEvaluateRuleFreshness(context.ruleState, context.nowEpochMs);
  if (rule.status === 'stopped') {
    return { allowed: false, reason: rule.reason };
  }

  var rolledUsage = openAiRolloverDailyUsage(context.usage, context.nowEpochMs);
  var appLimit = (context.appLimits && context.appLimits[context.group]) || OPENAI_APP_SAFETY_LIMITS[context.group];
  if (!openAiCanReserve(rolledUsage, context.group, context.reservationTokens, appLimit)) {
    return { allowed: false, reason: '本日のOpenAI安全上限に達する可能性があるため利用できません。' };
  }

  return { allowed: true, reason: '', usageAfterRollover: rolledUsage, ruleNeedsCheck: rule.needsCheck };
}

if (typeof module !== 'undefined' && typeof module.exports !== 'undefined') {
  // GAS実行時はmoduleが存在しないため、この分岐はNodeでのテスト読み込み時のみ働く。
  module.exports = {
    OPENAI_ECONOMY_GROUP: OPENAI_ECONOMY_GROUP,
    OPENAI_PREMIUM_GROUP: OPENAI_PREMIUM_GROUP,
    OPENAI_OFFICIAL_LIMITS: OPENAI_OFFICIAL_LIMITS,
    OPENAI_APP_SAFETY_LIMITS: OPENAI_APP_SAFETY_LIMITS,
    OPENAI_RESERVATION_SAFETY_MARGIN_TOKENS: OPENAI_RESERVATION_SAFETY_MARGIN_TOKENS,
    OPENAI_RULE_REQUIRED_TERMS: OPENAI_RULE_REQUIRED_TERMS,
    OPENAI_RULE_REQUIRED_MODEL_TERMS: OPENAI_RULE_REQUIRED_MODEL_TERMS,
    openAiUtcDateString: openAiUtcDateString,
    openAiEmptyDailyUsage: openAiEmptyDailyUsage,
    openAiRolloverDailyUsage: openAiRolloverDailyUsage,
    openAiCanReserve: openAiCanReserve,
    openAiReserve: openAiReserve,
    openAiCommitSuccess: openAiCommitSuccess,
    openAiCommitFailure: openAiCommitFailure,
    openAiEstimateImageTokens: openAiEstimateImageTokens,
    utf8ByteLength: utf8ByteLength,
    openAiCalculateReservation: openAiCalculateReservation,
    openAiExtractNumbers: openAiExtractNumbers,
    openAiPageIndicatesRuleOk: openAiPageIndicatesRuleOk,
    openAiEvaluateEligibility: openAiEvaluateEligibility,
    openAiEvaluateRuleFreshness: openAiEvaluateRuleFreshness,
    openAiEvaluateCallGate: openAiEvaluateCallGate,
  };
}
