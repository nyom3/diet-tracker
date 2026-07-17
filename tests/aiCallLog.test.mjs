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

test('ai_call_logは未作成時に作成され、12列のヘッダーを保証する', () => {
  const context = loadContext();
  let insertedName = '';
  let headers = Array(12).fill('');
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
  let response = {
    statusCode: 200,
    body: JSON.stringify({ choices: [{ message: { content: '{"ok":true}' } }], usage: { total_tokens: 12 } }),
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
  context.fetchOpenAiChat = () => response;
  context.recordAiCallLog = (entry) => logs.push(entry);

  const request = { group: 'economy', reservationTokens: 20, messages: [], requestKind: 'coach-json' };
  assert.equal(context.attemptOpenAiChat(request).ok, true);
  assert.equal(logs.at(-1).outcome, 'success');
  assert.equal(logs.at(-1).stage, 'openai_success');
  assert.ok(logs.at(-1).duration_ms >= 0);

  response = {
    statusCode: 401,
    body: JSON.stringify({ error: { code: 'invalid_api_key', type: 'invalid_request_error', message: 'bad sk-secret' } }),
  };
  const failed = context.attemptOpenAiChat(request);
  assert.equal(failed.ok, false);
  const errorLog = logs.at(-1);
  assert.equal(errorLog.outcome, 'fallback');
  assert.equal(errorLog.stage, 'openai_http');
  assert.equal(errorLog.status_code, 401);
  assert.equal(errorLog.error_code, 'invalid_api_key');
  assert.equal(errorLog.error_type, 'invalid_request_error');
  assert.equal(errorLog.reason.includes('sk-secret'), false);
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
    const error = new Error('Gemini API の呼び出しに失敗しました。status=503');
    error.statusCode = 503;
    throw error;
  };
  const failed = context.runAiJson('prompt', 'low');
  assert.equal(failed.ok, false);
  assert.equal(logs.at(-1).stage, 'gemini_error');
  assert.equal(logs.at(-1).status_code, 503);

  context.buildCoachRulesFallback({ generated_at: 'x', scope: 'trend', confidence: 'low', headline: 'h', summary: 's', evidence: [], selected_action: null, alternative_action: null }, 'notice', '', {
    provider: 'openai',
    stage: 'coach_response_rejected',
    request_kind: 'coach-json',
    reason: 'coach_response_rejected:unknown_keys',
  });
  assert.equal(logs.at(-1).stage, 'coach_response_rejected');
  assert.equal(logs.at(-1).reason, 'coach_response_rejected:unknown_keys');
});
