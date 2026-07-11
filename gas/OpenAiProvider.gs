// OpenAI/Geminiの選択・安全ガード・実呼び出しをここに集約する。
// 上限や日次使用量の判定は OpenAiBudget.gs の純粋関数に委譲し、ここではGAS API
// (PropertiesService/LockService/UrlFetchApp)との結線のみを行う。
//
// このアプリの推定・フィードバック機能はJSON抽出中心の軽量タスクのため、OpenAIを呼ぶ場合は
// 常に economy グループ(Luna)を使う。premium(Sol)は呼び出さないが、無料枠の使用量管理は
// issue #44 の要件通りグループ別に保持する。実際のOpenAIダッシュボード上の無料枠グルーピングが
// 想定と異なる場合は OPENAI_MODEL_BY_GROUP / OPENAI_CALL_GROUP を調整すること。

var AI_PROVIDER_MODE_PROPERTY = 'AI_PROVIDER_MODE';
var OPENAI_DAILY_USAGE_PROPERTY = 'OPENAI_DAILY_USAGE_JSON';
var OPENAI_RULE_STATE_PROPERTY = 'OPENAI_RULE_STATE_JSON';
var OPENAI_ELIGIBILITY_STATE_PROPERTY = 'OPENAI_ELIGIBILITY_STATE_JSON';
var OPENAI_LAST_FALLBACK_REASON_PROPERTY = 'OPENAI_LAST_FALLBACK_REASON';

var AI_PROVIDER_LOCK_TIMEOUT_MS = 10000;
var OPENAI_CALL_GROUP = OPENAI_ECONOMY_GROUP;
var OPENAI_MODEL_BY_GROUP = {
  economy: 'gpt-5.6-luna',
  premium: 'gpt-5.6-sol',
};

var OPENAI_VISION_MAX_COMPLETION_TOKENS = 1200;
var OPENAI_TEXT_MAX_COMPLETION_TOKENS = 1500;

var OPENAI_RULE_HELP_URL =
  'https://help.openai.com/en/articles/10306912-sharing-feedback-evaluation-and-fine-tuning-data-and-api-inputs-and-outputs-with-openai';
var OPENAI_RULE_USER_AGENT = 'Mozilla/5.0 (compatible; diet-tracker-rule-check/1.0)';

function getAiProviderMode() {
  var mode = PropertiesService.getScriptProperties().getProperty(AI_PROVIDER_MODE_PROPERTY);
  return mode === 'openai' || mode === 'gemini' ? mode : 'auto';
}

function setAiProviderMode(mode) {
  var normalized = String(mode || '').trim();
  if (normalized !== 'auto' && normalized !== 'openai' && normalized !== 'gemini') {
    throw new Error('不正なAIモードです: ' + mode);
  }
  PropertiesService.getScriptProperties().setProperty(AI_PROVIDER_MODE_PROPERTY, normalized);
  return getAiStatus();
}

function confirmOpenAiEligibility(action) {
  var normalized = String(action || '').trim();
  var state;
  if (normalized === 'confirm') {
    state = { status: 'confirmed', confirmedAt: Date.now() };
  } else if (normalized === 'pause') {
    state = { status: 'paused', confirmedAt: 0 };
  } else {
    throw new Error('不正な資格確認アクションです: ' + action);
  }
  writeJsonProperty(OPENAI_ELIGIBILITY_STATE_PROPERTY, state);
  return getAiStatus();
}

function getAiStatus() {
  var now = Date.now();
  var mode = getAiProviderMode();
  var ruleState = refreshOpenAiRuleStateIfNeeded();
  var usage = openAiRolloverDailyUsage(readJsonProperty(OPENAI_DAILY_USAGE_PROPERTY, null), now);
  var eligibilityState = readJsonProperty(OPENAI_ELIGIBILITY_STATE_PROPERTY, null);
  var eligibility = openAiEvaluateEligibility(eligibilityState, now);
  var rule = openAiEvaluateRuleFreshness(ruleState, now);
  var hasApiKey = !!PropertiesService.getScriptProperties().getProperty('OPENAI_API_KEY');

  var blockingReason = '';
  if (!hasApiKey) {
    blockingReason = 'OPENAI_API_KEY が設定されていません。';
  } else if (mode === 'gemini') {
    blockingReason = '手動でGeminiが選択されています。';
  } else if (eligibility.status !== 'confirmed') {
    blockingReason = eligibility.reason;
  } else if (rule.status === 'stopped') {
    blockingReason = rule.reason;
  }

  return {
    mode: mode,
    openAiAvailable: hasApiKey && mode !== 'gemini' && eligibility.status === 'confirmed' && rule.status === 'ok',
    blockingReason: blockingReason,
    lastFallbackReason: PropertiesService.getScriptProperties().getProperty(OPENAI_LAST_FALLBACK_REASON_PROPERTY) || '',
    eligibility: {
      status: eligibility.status,
      confirmedAt: (eligibilityState && eligibilityState.confirmedAt) || 0,
      recheckIntervalDays: 30,
    },
    rule: {
      status: rule.status,
      lastCheckedAt: (ruleState && ruleState.lastCheckedAt) || 0,
      lastSuccessAt: (ruleState && ruleState.lastSuccessAt) || 0,
    },
    usage: {
      dateUtc: usage.dateUtc,
      economyTokens: usage.economyTokens,
      premiumTokens: usage.premiumTokens,
      reservedEconomyTokens: usage.reservedEconomyTokens,
      reservedPremiumTokens: usage.reservedPremiumTokens,
      requestCount: usage.requestCount,
      lastUsedAt: usage.lastUsedAt,
    },
    limits: {
      economy: { officialLimit: OPENAI_OFFICIAL_LIMITS.economy, appLimit: OPENAI_APP_SAFETY_LIMITS.economy },
      premium: { officialLimit: OPENAI_OFFICIAL_LIMITS.premium, appLimit: OPENAI_APP_SAFETY_LIMITS.premium },
    },
  };
}

// 食事推定。OpenAIが使えればOpenAIの応答テキストを、使えなければ{ok:false}を返す。
// 呼び出し側(estimateCalories)はok:falseのとき既存のGemini経路をそのまま使う。
function tryOpenAiVisionEstimate(promptText, strippedImageBase64, imageMimeType, widthPx, heightPx) {
  var hasImage = !!strippedImageBase64;

  // GPT-5.6 familyのhigh詳細度については、公式ドキュメントにtoken multiplierの上限がない。
  // 無料枠を実行前に確実に守るまで、画像入力はOpenAIへ送らずGeminiへフォールバックする。
  if (hasImage) {
    return recordAndReturnBlocked('OpenAI画像入力のtoken上限を保証できないためGeminiを使用します。');
  }

  var reservationTokens = openAiCalculateReservation({
    promptText: promptText,
    maxOutputTokens: OPENAI_VISION_MAX_COMPLETION_TOKENS,
  });

  var messages = [{ role: 'user', content: promptText }];

  return attemptOpenAiChat({
    group: OPENAI_CALL_GROUP,
    reservationTokens: reservationTokens,
    messages: messages,
    jsonMode: true,
    reasoningEffort: 'low',
    maxCompletionTokens: OPENAI_VISION_MAX_COMPLETION_TOKENS,
  });
}

// テキストのみのフィードバック生成(当日/週次)。
function tryOpenAiTextRequest(promptText, reasoningLevel) {
  var reservationTokens = openAiCalculateReservation({
    promptText: promptText,
    maxOutputTokens: OPENAI_TEXT_MAX_COMPLETION_TOKENS,
  });

  return attemptOpenAiChat({
    group: OPENAI_CALL_GROUP,
    reservationTokens: reservationTokens,
    messages: [{ role: 'user', content: promptText }],
    jsonMode: false,
    reasoningEffort: reasoningLevel || 'low',
    maxCompletionTokens: OPENAI_TEXT_MAX_COMPLETION_TOKENS,
  });
}

// callGeminiText と同じ戻り値の形({text, fallback_notice})でOpenAI→Geminiの順に試す。
// summarizeTodayFeedback/summarizeWeeklyFeedback から呼ばれる公開窓口。
function runAiText(promptText, thinkingLevel) {
  const openAiAttempt = tryOpenAiTextRequest(promptText, thinkingLevel);
  if (openAiAttempt.ok) {
    return { text: openAiAttempt.text, fallback_notice: '' };
  }

  const geminiResult = callGeminiText(promptText, thinkingLevel);
  return {
    text: geminiResult.text,
    fallback_notice: buildFallbackNotice(openAiAttempt.reason, geminiResult.fallback_notice),
  };
}

function buildFallbackNotice(openAiReason, geminiFallbackNotice) {
  const notices = [];
  if (openAiReason) {
    notices.push('OpenAIを利用できないためGeminiで応答しました(' + openAiReason + ')。');
  }
  if (geminiFallbackNotice) {
    notices.push(geminiFallbackNotice);
  }
  return notices.join(' ');
}

// 予約→(ロック外で)OpenAI呼び出し→実績反映、を一通り行う。
// 戻り値: { ok: true, text } または { ok: false, reason }
function attemptOpenAiChat(request) {
  var apiKey = PropertiesService.getScriptProperties().getProperty('OPENAI_API_KEY');
  if (!apiKey) {
    return recordAndReturnBlocked('OPENAI_API_KEY が設定されていません。');
  }

  var mode = getAiProviderMode();
  var reservation = reserveOpenAiBudget(mode, request.group, request.reservationTokens);
  if (!reservation.allowed) {
    return recordAndReturnBlocked(reservation.reason);
  }

  var model = OPENAI_MODEL_BY_GROUP[request.group];
  var response;
  try {
    response = fetchOpenAiChat(apiKey, model, request.messages, {
      jsonMode: request.jsonMode,
      reasoningEffort: request.reasoningEffort,
      maxCompletionTokens: request.maxCompletionTokens,
    });
  } catch (networkError) {
    commitOpenAiUsage(request.group, request.reservationTokens, 0, false);
    return recordAndReturnBlocked('OpenAI API への接続に失敗しました。');
  }

  if (response.statusCode < 200 || response.statusCode >= 300) {
    commitOpenAiUsage(request.group, request.reservationTokens, 0, false);
    return recordAndReturnBlocked('OpenAI API の呼び出しに失敗しました。status=' + response.statusCode);
  }

  var payload;
  try {
    payload = JSON.parse(response.body);
  } catch (parseError) {
    commitOpenAiUsage(request.group, request.reservationTokens, 0, false);
    return recordAndReturnBlocked('OpenAI API の応答を解析できませんでした。');
  }

  var choice = payload.choices && payload.choices[0];
  var text = choice && choice.message && choice.message.content;
  var totalTokens = (payload.usage && payload.usage.total_tokens) || request.reservationTokens;

  if (!text) {
    commitOpenAiUsage(request.group, request.reservationTokens, totalTokens, false);
    return recordAndReturnBlocked('OpenAI API の応答が空です。');
  }

  commitOpenAiUsage(request.group, request.reservationTokens, totalTokens, true);
  clearFallbackReason();
  return { ok: true, text: String(text).trim() };
}

function recordAndReturnBlocked(reason) {
  recordFallbackReason(reason);
  return { ok: false, reason: reason };
}

function recordFallbackReason(reason) {
  PropertiesService.getScriptProperties().setProperty(OPENAI_LAST_FALLBACK_REASON_PROPERTY, reason || '');
}

function clearFallbackReason() {
  PropertiesService.getScriptProperties().deleteProperty(OPENAI_LAST_FALLBACK_REASON_PROPERTY);
}

// token予約はLockService内で行い、実際のAPI呼び出しはロック外で行う(外部通信でロックを長時間
// 握らないため)。予約に対する実績反映は commitOpenAiUsage が別途ロックを取って行う。
function reserveOpenAiBudget(mode, group, reservationTokens) {
  var lock = LockService.getScriptLock();
  var acquired = lock.tryLock(AI_PROVIDER_LOCK_TIMEOUT_MS);
  if (!acquired) {
    return { allowed: false, reason: 'AI利用状況の排他ロック取得に失敗しました。' };
  }
  try {
    var now = Date.now();
    var usage = readJsonProperty(OPENAI_DAILY_USAGE_PROPERTY, null);
    var eligibilityState = readJsonProperty(OPENAI_ELIGIBILITY_STATE_PROPERTY, null);
    var ruleState = readJsonProperty(OPENAI_RULE_STATE_PROPERTY, null);

    var gate = openAiEvaluateCallGate({
      mode: mode,
      nowEpochMs: now,
      eligibilityState: eligibilityState,
      ruleState: ruleState,
      usage: usage,
      group: group,
      reservationTokens: reservationTokens,
      appLimits: OPENAI_APP_SAFETY_LIMITS,
    });

    if (!gate.allowed) {
      if (gate.usageAfterRollover) {
        writeJsonProperty(OPENAI_DAILY_USAGE_PROPERTY, gate.usageAfterRollover);
      }
      return { allowed: false, reason: gate.reason };
    }

    var reserved = openAiReserve(gate.usageAfterRollover, group, reservationTokens, new Date(now).toISOString());
    writeJsonProperty(OPENAI_DAILY_USAGE_PROPERTY, reserved);

    return { allowed: true, reason: '' };
  } finally {
    lock.releaseLock();
  }
}

function commitOpenAiUsage(group, reservedTokens, actualTokens, success) {
  var lock = LockService.getScriptLock();
  var acquired = lock.tryLock(AI_PROVIDER_LOCK_TIMEOUT_MS);
  if (!acquired) {
    // ロックが取れなくても予約は既に「使用中」として計上済みなので安全側のまま。
    return;
  }
  try {
    var usage = readJsonProperty(OPENAI_DAILY_USAGE_PROPERTY, null);
    if (!usage) {
      return;
    }
    var nowIso = new Date().toISOString();
    var updated = success
      ? openAiCommitSuccess(usage, group, reservedTokens, actualTokens, nowIso)
      : openAiCommitFailure(usage, group, reservedTokens, nowIso);
    writeJsonProperty(OPENAI_DAILY_USAGE_PROPERTY, updated);
  } finally {
    lock.releaseLock();
  }
}

function fetchOpenAiChat(apiKey, model, messages, options) {
  var payload = {
    model: model,
    messages: messages,
  };
  if (options.jsonMode) {
    payload.response_format = { type: 'json_object' };
  }
  if (options.reasoningEffort) {
    payload.reasoning_effort = options.reasoningEffort;
  }
  if (options.maxCompletionTokens) {
    payload.max_completion_tokens = options.maxCompletionTokens;
  }

  var response = UrlFetchApp.fetch('https://api.openai.com/v1/chat/completions', {
    method: 'post',
    contentType: 'application/json',
    muteHttpExceptions: true,
    headers: { Authorization: 'Bearer ' + apiKey },
    payload: JSON.stringify(payload),
  });

  return { statusCode: response.getResponseCode(), body: response.getContentText() };
}

// OpenAI公式ヘルプページを1日1回以下の頻度で確認し、無料枠の説明が引き続き存在するかを見る。
// ユーザー操作(getAiStatus呼び出し)起点でのみ実行され、時間主導トリガーからは呼ばれない。
function refreshOpenAiRuleStateIfNeeded() {
  var ruleState = readJsonProperty(OPENAI_RULE_STATE_PROPERTY, null);
  var now = Date.now();
  var freshness = openAiEvaluateRuleFreshness(ruleState, now);
  if (!freshness.needsCheck) {
    return ruleState;
  }

  try {
    var response = UrlFetchApp.fetch(OPENAI_RULE_HELP_URL, {
      method: 'get',
      muteHttpExceptions: true,
      headers: { 'User-Agent': OPENAI_RULE_USER_AGENT },
    });
    if (response.getResponseCode() !== 200) {
      throw new Error('status=' + response.getResponseCode());
    }
    var lastKnownGood = openAiPageIndicatesRuleOk(
      response.getContentText(),
      OPENAI_RULE_REQUIRED_TERMS,
      OPENAI_RULE_MODEL_LIMIT_REQUIREMENTS,
    );
    var nextState = { lastCheckedAt: now, lastSuccessAt: now, lastKnownGood: lastKnownGood };
    writeJsonProperty(OPENAI_RULE_STATE_PROPERTY, nextState);
    return nextState;
  } catch (fetchError) {
    var fallbackState = {
      lastCheckedAt: now,
      lastSuccessAt: (ruleState && ruleState.lastSuccessAt) || 0,
      lastKnownGood: ruleState ? ruleState.lastKnownGood : false,
    };
    writeJsonProperty(OPENAI_RULE_STATE_PROPERTY, fallbackState);
    return fallbackState;
  }
}

function readJsonProperty(key, fallback) {
  var raw = PropertiesService.getScriptProperties().getProperty(key);
  if (!raw) {
    return fallback;
  }
  try {
    return JSON.parse(raw);
  } catch (parseError) {
    return fallback;
  }
}

function writeJsonProperty(key, value) {
  PropertiesService.getScriptProperties().setProperty(key, JSON.stringify(value));
}
