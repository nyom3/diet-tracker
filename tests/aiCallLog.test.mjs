import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const codeSource = await readFile(new URL('../gas/Code.gs', import.meta.url), 'utf8');
const budgetSource = await readFile(new URL('../gas/OpenAiBudget.gs', import.meta.url), 'utf8');
const providerSource = await readFile(new URL('../gas/OpenAiProvider.gs', import.meta.url), 'utf8');

function loadContext({ provider = false } = {}) {
  const context = { module: { exports: {} }, console };
  vm.runInNewContext(budgetSource, context);
  vm.runInNewContext(codeSource, context);
  if (provider) {
    vm.runInNewContext(providerSource, context);
  }
  return context;
}

function createLogSheet(initialRows = []) {
  const rows = initialRows.map((row) => [...row]);
  return {
    rows,
    appendRow(row) {
      rows.push([...row]);
    },
    getLastRow() {
      return rows.length + 1;
    },
    deleteRows(start, count) {
      rows.splice(start - 2, count);
    },
  };
}

test('ai_call_logは未作成時に作成され、14列のヘッダーを保証する', () => {
  const context = loadContext();
  let insertedName = '';
  let headers = Array(14).fill('');
  const sheet = {
    getRange() {
      return {
        getValues: () => [headers],
        setValues: (values) => { headers = values[0]; },
      };
    },
  };
  context.getSpreadsheet = () => ({
    getSheetByName: () => null,
    insertSheet: (name) => { insertedName = name; return sheet; },
  });

  context.getAiCallLogSheet();
  assert.equal(insertedName, 'ai_call_log');
  assert.deepEqual(Array.from(headers), [
    'timestamp', 'outcome', 'provider', 'stage', 'request_kind', 'group',
    'model', 'status_code', 'error_code', 'error_type', 'duration_ms', 'reason',
    'error_message_redacted', 'diagnostics',
  ]);
});

test('ai_call_logはSpreadsheet内にbest-effortで追記し、2000行を超えたら古い行を削除する', () => {
  const context = loadContext();
  const sheet = createLogSheet(Array.from({ length: 2000 }, (_, index) => [`old-${index}`]));
  context.getAiCallLogSheet = () => sheet;

  context.recordAiCallLog({
    outcome: 'success',
    provider: 'openai',
    stage: 'openai_success',
    request_kind: 'coach-json',
    group: 'economy',
    model: 'gpt-test',
    status_code: 200,
    duration_ms: 42.7,
    reason: '安全な理由',
  });

  assert.equal(sheet.rows.length, 2000);
  assert.equal(sheet.rows[0][0], 'old-1');
  assert.equal(sheet.rows.at(-1)[1], 'success');
  assert.equal(sheet.rows.at(-1)[2], 'openai');
  assert.equal(sheet.rows.at(-1)[7], 200);
  assert.equal(sheet.rows.at(-1)[10], 43);
  assert.equal(sheet.rows.at(-1)[12], '');
  assert.equal(sheet.rows.at(-1)[13], '');
  assert.equal(JSON.stringify(sheet.rows).includes('sk-secret'), false);
});

test('ai_call_logへの書き込み失敗はAI境界へ伝播しない', () => {
  const context = loadContext();
  context.getAiCallLogSheet = () => { throw new Error('sheet unavailable'); };
  assert.doesNotThrow(() => context.recordAiCallLog({ outcome: 'failure', provider: 'gemini', reason: '記録失敗' }));
});

test('OpenAI成功と401失敗を既存合流点から記録し、401の構造化エラーだけを保持する', () => {
  const context = loadContext({ provider: true });
  const logs = [];
  let fetchCount = 0;
  let response = {
    statusCode: 200,
    body: JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: '{"ok":true}' } }], usage: { total_tokens: 12 } }),
  };
  const properties = {
    getProperty: (key) => key === 'OPENAI_API_KEY' ? 'sk-secret' : null,
    setProperty() {},
    deleteProperty() {},
  };
  context.PropertiesService = { getScriptProperties: () => properties };
  context.getAiProviderMode = () => 'auto';
  context.reserveOpenAiBudget = () => ({ allowed: true });
  context.commitOpenAiUsage = () => {};
  context.recordLastOpenAiUsage = () => {};
  context.clearFallbackReason = () => {};
  context.fetchOpenAiChat = () => {
    fetchCount += 1;
    return response;
  };
  context.recordAiCallLog = (entry) => logs.push(entry);

  const request = { group: 'economy', reservationTokens: 20, messages: [], requestKind: 'coach-json' };
  const openAiSuccess = context.attemptOpenAiChat(request);
  assert.equal(openAiSuccess.ok, true);
  assert.equal(openAiSuccess.finish_reason, 'stop');
  assert.equal(openAiSuccess.parts_count, 1);
  assert.equal(logs.at(-1).outcome, 'success');
  assert.equal(logs.at(-1).stage, 'openai_success');
  assert.ok(logs.at(-1).duration_ms >= 0);

  response = {
    statusCode: 401,
    body: JSON.stringify({ error: {
      code: 'invalid_api_key',
      type: 'invalid_request_error',
      message: 'bad sk-abcdefghijk and AIza12345678901234567890',
    } }),
  };
  const failed = context.attemptOpenAiChat(request);
  assert.equal(failed.ok, false);
  const errorLog = logs.at(-1);
  assert.equal(errorLog.outcome, 'fallback');
  assert.equal(errorLog.stage, 'openai_http');
  assert.equal(errorLog.status_code, 401);
  assert.equal(errorLog.error_code, 'invalid_api_key');
  assert.equal(errorLog.error_type, 'invalid_request_error');
  assert.equal(errorLog.error_message_redacted, 'bad sk-*** and AIza***');
  assert.equal(JSON.stringify(errorLog).includes('sk-abcdefghijk'), false);
  assert.equal(JSON.stringify(errorLog).includes('AIza12345678901234567890'), false);
  assert.equal(fetchCount, 2);
});

test('insufficient permissionsの401だけを同じ予約枠で1回再試行し、成功を専用stageに記録する', () => {
  const context = loadContext({ provider: true });
  const logs = [];
  const responses = [
    {
      statusCode: 401,
      body: JSON.stringify({ error: { type: 'invalid_request_error', message: 'You have insufficient permissions for this operation.' } }),
    },
    {
      statusCode: 200,
      body: JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: '再試行成功' } }], usage: { total_tokens: 12 } }),
    },
  ];
  let fetchCount = 0;
  let reserveCount = 0;
  let commitCount = 0;
  context.PropertiesService = { getScriptProperties: () => ({
    getProperty: (key) => key === 'OPENAI_API_KEY' ? 'sk-secret' : null,
    setProperty() {},
    deleteProperty() {},
  }) };
  context.getAiProviderMode = () => 'auto';
  context.reserveOpenAiBudget = () => { reserveCount += 1; return { allowed: true }; };
  context.commitOpenAiUsage = () => { commitCount += 1; };
  context.recordLastOpenAiUsage = () => {};
  context.clearFallbackReason = () => {};
  context.fetchOpenAiChat = () => { fetchCount += 1; return responses.shift(); };
  context.recordAiCallLog = (entry) => logs.push(entry);

  const result = context.attemptOpenAiChat({ group: 'economy', reservationTokens: 20, messages: [], requestKind: 'coach-json' });

  assert.equal(result.ok, true);
  assert.equal(fetchCount, 2);
  assert.equal(reserveCount, 1);
  assert.equal(commitCount, 1);
  assert.equal(logs.at(-1).stage, 'openai_permission_retry');
  assert.equal(logs.at(-1).diagnostics, undefined);
});

test('再試行後もinsufficient permissionsならフォールバックし、retry=1と安全な理由を記録する', () => {
  const context = loadContext({ provider: true });
  const logs = [];
  const response = {
    statusCode: 401,
    body: JSON.stringify({ error: { type: 'invalid_request_error', message: 'You have insufficient permissions for this operation.' } }),
  };
  let fetchCount = 0;
  let reserveCount = 0;
  let commitCount = 0;
  context.PropertiesService = { getScriptProperties: () => ({
    getProperty: (key) => key === 'OPENAI_API_KEY' ? 'sk-secret' : null,
    setProperty() {},
    deleteProperty() {},
  }) };
  context.getAiProviderMode = () => 'auto';
  context.reserveOpenAiBudget = () => { reserveCount += 1; return { allowed: true }; };
  context.commitOpenAiUsage = () => { commitCount += 1; };
  context.fetchOpenAiChat = () => { fetchCount += 1; return response; };
  context.recordAiCallLog = (entry) => logs.push(entry);

  const result = context.attemptOpenAiChat({ group: 'economy', reservationTokens: 20, messages: [], requestKind: 'coach-json' });
  const errorLog = logs.at(-1);

  assert.equal(result.ok, false);
  assert.equal(fetchCount, 2);
  assert.equal(reserveCount, 1);
  assert.equal(commitCount, 1);
  assert.equal(errorLog.stage, 'openai_http');
  assert.equal(errorLog.diagnostics, 'retry=1');
  assert.match(errorLog.reason, /OpenAI側の一時的な権限エラー/);
  assert.doesNotMatch(errorLog.reason, /OPENAI_API_KEY/);
});

test('invalid_api_keyや401以外は再試行しない', () => {
  const context = loadContext({ provider: true });
  assert.equal(context.isOpenAiPermissionRetryable({
    statusCode: 401,
    body: JSON.stringify({ error: { code: 'invalid_api_key', message: 'insufficient permissions' } }),
  }), false);
  assert.equal(context.isOpenAiPermissionRetryable({
    statusCode: 403,
    body: JSON.stringify({ error: { message: 'insufficient permissions' } }),
  }), false);
  assert.equal(context.isOpenAiPermissionRetryable({
    statusCode: 401,
    body: JSON.stringify({ error: { message: 'invalid api key' } }),
  }), false);
});

test('OpenAI error.messageだけを伏字化し、JSONでない本文や境界のキー断片を記録しない', () => {
  const context = loadContext({ provider: true });
  const logs = [];
  context.recordAiCallLog = (entry) => logs.push(entry);

  const openAiMessage = [
    'bad sk-abcdefghijk and AIza12345678901234567890',
    'line\nwith control',
  ].join(' ');
  const structuredContext = {};
  const messageResult = context.describeOpenAiApiError({
    statusCode: 401,
    body: JSON.stringify({ error: {
      code: 'invalid_api_key',
      type: 'invalid_request_error',
      message: openAiMessage,
    } }),
  }, structuredContext);

  assert.match(messageResult, /OPENAI_API_KEY/);
  assert.equal(structuredContext.error_message_redacted, 'bad sk-*** and AIza*** line with control');
  assert.equal(structuredContext.error_message_redacted.includes('sk-abcdefghijk'), false);
  assert.equal(structuredContext.error_message_redacted.includes('AIza12345678901234567890'), false);
  assert.equal(structuredContext.error_message_redacted.includes('\n'), false);

  const boundary = `${'x'.repeat(194)}sk-abcdefghijk`;
  const boundaryContext = {};
  context.describeOpenAiApiError({
    statusCode: 401,
    body: JSON.stringify({ error: { message: boundary } }),
  }, boundaryContext);
  assert.equal(boundaryContext.error_message_redacted.length, 200);
  assert.equal(boundaryContext.error_message_redacted.endsWith('sk-***'), true);
  assert.equal(boundaryContext.error_message_redacted.includes('sk-abcdefgh'), false);

  const rawBody = '401 raw body sk-abcdefghijk AIza12345678901234567890';
  const rawContext = {};
  context.describeOpenAiApiError({ statusCode: 401, body: rawBody }, rawContext);
  assert.equal(rawContext.error_message_redacted, undefined);
  context.recordAiCallLog({
    outcome: 'fallback',
    provider: 'openai',
    error_message_redacted: rawContext.error_message_redacted,
  });
  assert.equal(JSON.stringify(logs).includes(rawBody), false);
  assert.equal(JSON.stringify(logs).includes('sk-abcdefghijk'), false);
  assert.equal(JSON.stringify(logs).includes('AIza12345678901234567890'), false);
});

test('コーチJSONパース失敗のdiagnosticsは本文を含まず、Gemini/OpenAI両方で形状を記録する', () => {
  const context = loadContext({ provider: true });
  const logs = [];
  context.recordAiCallLog = (entry) => logs.push(entry);

  context.PropertiesService = {
    getScriptProperties: () => ({ getProperty: () => 'gem-key' }),
  };
  context.fetchGeminiWithFallback = () => ({
    usedFallback: false,
    body: JSON.stringify({ candidates: [{
      finishReason: 'MAX_TOKENS',
      content: { parts: [
        { thought: true, text: '内部思考は記録対象外' },
        { text: '{gemini本文' },
        { text: '後半' },
      ] },
    }] }),
  });
  const geminiCall = context.callGeminiJson('prompt', 'low');
  assert.equal(geminiCall.finish_reason, 'MAX_TOKENS');
  assert.equal(geminiCall.parts_count, 2);
  assert.equal(geminiCall.text, '{gemini本文');

  assert.equal(context.buildCoachJsonDiagnostics({
    text: '{食事名を含むが閉じない',
    finish_reason: 'MAX_TOKENS',
    parts_count: 1,
  }), 'finish_reason=MAX_TOKENS;text_len=12;parts=1;head_brace=1;tail_brace=0');

  context.tryOpenAiCoachJsonRequest = () => ({ ok: true, text: '{openai食事', finish_reason: undefined, parts_count: 1 });
  const openAiResult = context.runAiJson('prompt', 'low');
  assert.equal(openAiResult.provider, 'openai');
  context.buildCoachRulesFallback({}, 'notice', '', {
    provider: openAiResult.provider,
    stage: 'coach_json_parse',
    request_kind: 'coach-json',
    reason: 'coach_json_parse_failed',
    diagnostics: context.buildCoachJsonDiagnostics(openAiResult),
  });
  assert.equal(logs.at(-1).diagnostics, 'finish_reason=;text_len=9;parts=1;head_brace=1;tail_brace=0');
  assert.equal(logs.at(-1).diagnostics.includes('openai食事'), false);

  context.tryOpenAiCoachJsonRequest = () => ({ ok: false, reason: 'OpenAI unavailable' });
  context.callGeminiJson = () => ({
    text: '{gemini食事',
    fallback_notice: '',
    finish_reason: 'STOP',
    parts_count: 2,
  });
  const geminiResult = context.runAiJson('prompt', 'low');
  context.buildCoachRulesFallback({}, 'notice', '', {
    provider: geminiResult.provider,
    stage: 'coach_json_parse',
    request_kind: 'coach-json',
    reason: 'coach_json_parse_failed',
    diagnostics: context.buildCoachJsonDiagnostics(geminiResult),
  });
  assert.equal(logs.at(-1).diagnostics, 'finish_reason=STOP;text_len=9;parts=2;head_brace=1;tail_brace=0');
  assert.equal(JSON.stringify(logs).includes('gemini食事'), false);
});

test('Gemini正常成功・劣化再試行成功・runAiJson失敗・Coach拒否をstage別に記録する', () => {
  const context = loadContext({ provider: true });
  const logs = [];
  context.recordAiCallLog = (entry) => logs.push(entry);
  let responses = [
    { statusCode: 200, body: '{}' },
  ];
  context.fetchGemini = () => responses.shift();
  context.fetchGeminiWithFallback('gem-key', { generationConfig: { thinkingConfig: { thinkingLevel: 'low' } } }, 'coach-json');
  assert.equal(logs.at(-1).stage, 'gemini_success');

  responses = [
    { statusCode: 503, body: '{}' },
    { statusCode: 200, body: '{}' },
  ];
  context.fetchGeminiWithFallback('gem-key', { generationConfig: { thinkingConfig: { thinkingLevel: 'low' } } }, 'coach-json');
  assert.equal(logs.at(-1).stage, 'gemini_degraded_retry');
  assert.equal(logs.at(-1).outcome, 'fallback');

  context.tryOpenAiCoachJsonRequest = () => ({ ok: false, reason: 'OpenAI unavailable' });
  context.callGeminiJson = () => {
    throw new Error('Address unavailable: https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent?key=AIzaSyFAKEKEY123');
  };
  const failed = context.runAiJson('prompt', 'low');
  assert.equal(failed.ok, false);
  assert.equal(logs.at(-1).stage, 'gemini_error');
  assert.equal(logs.at(-1).status_code, undefined);
  assert.equal(JSON.stringify(logs).includes('AIzaSyFAKEKEY123'), false);
  assert.equal(logs.at(-1).reason, 'Gemini API への接続に失敗しました。');

  context.buildCoachRulesFallback({ generated_at: 'x', scope: 'trend', confidence: 'low', headline: 'h', summary: 's', evidence: [], selected_action: null, alternative_action: null }, 'notice', '', {
    provider: 'openai',
    stage: 'coach_response_rejected',
    request_kind: 'coach-json',
    reason: 'coach_response_rejected:unknown_keys',
  });
  assert.equal(logs.at(-1).stage, 'coach_response_rejected');
  assert.equal(logs.at(-1).reason, 'coach_response_rejected:unknown_keys');
});
