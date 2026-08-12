import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const codeSource = await readFile(new URL('../gas/Code.gs', import.meta.url), 'utf8');
const budgetSource = await readFile(new URL('../gas/OpenAiBudget.gs', import.meta.url), 'utf8');
const providerSource = await readFile(new URL('../gas/OpenAiProvider.gs', import.meta.url), 'utf8');

function createCodeContext() {
  const context = {};
  vm.runInNewContext(codeSource, context);
  context.getTrustedImageInfo = (image) => image === 'bad'
    ? null
    : { mimeType: 'image/jpeg', widthPx: 100, heightPx: 80 };
  context.extractJson = (value) => value;
  context.normalizeNutritionResult = (value) => value;
  context.buildFallbackNotice = (openAiReason, geminiNotice) => [openAiReason, geminiNotice].filter(Boolean).join(' ');
  context.PropertiesService = {
    getScriptProperties: () => ({ getProperty: () => 'gemini-key' }),
  };
  return context;
}

function createProviderContext() {
  const context = {};
  vm.runInNewContext(budgetSource, context);
  vm.runInNewContext(providerSource, context);
  return context;
}

const images = [
  { base64: 'first', mimeType: 'image/jpeg', widthPx: 100, heightPx: 80 },
  { base64: 'second', mimeType: 'image/jpeg', widthPx: 120, heightPx: 90 },
];

test('estimateCaloriesはOpenAI経路へ選択済み全画像を1回で渡す', () => {
  const context = createCodeContext();
  let openAiCall;
  context.tryOpenAiVisionEstimate = (prompt, trustedImages) => {
    openAiCall = { prompt, trustedImages };
    return { ok: true, text: JSON.stringify({ items: [], total: {} }) };
  };

  context.estimateCalories('昼食', images);

  assert.equal(openAiCall.trustedImages.length, 2);
  assert.deepEqual(JSON.parse(JSON.stringify(openAiCall.trustedImages)), [
    { base64: 'first', mimeType: 'image/jpeg', widthPx: 100, heightPx: 80 },
    { base64: 'second', mimeType: 'image/jpeg', widthPx: 100, heightPx: 80 },
  ]);
});

test('estimateCaloriesのGeminiフォールバックは1回のparts配列へ全画像を追加する', () => {
  const context = createCodeContext();
  let geminiRequest;
  context.tryOpenAiVisionEstimate = () => ({ ok: false, reason: 'OpenAI blocked' });
  context.fetchGeminiWithFallback = (_apiKey, request) => {
    geminiRequest = request;
    return {
      usedFallback: false,
      body: JSON.stringify({ candidates: [{ content: { parts: [{ text: '{"items":[],"total":{}}' }] } }] }),
    };
  };

  context.estimateCalories('昼食', images);

  const parts = geminiRequest.contents[0].parts;
  assert.equal(parts.length, 3);
  assert.equal(parts[1].inline_data.data, 'first');
  assert.equal(parts[2].inline_data.data, 'second');
});

test('estimateCaloriesは画像を全件検証し、不正画像を部分的に無視しない', () => {
  const context = createCodeContext();
  let openAiCalled = false;
  context.tryOpenAiVisionEstimate = () => {
    openAiCalled = true;
    return { ok: true, text: '{}' };
  };

  assert.throws(() => context.estimateCalories('昼食', [images[0], { ...images[1], base64: 'bad' }]), /JPEGまたはPNG/);
  assert.equal(openAiCalled, false);
});

test('OpenAIのvision予約とcontentは画像枚数に比例する', () => {
  const context = createProviderContext();
  const requests = [];
  context.attemptOpenAiChat = (request) => {
    requests.push(request);
    return { ok: true, text: '{}' };
  };

  context.tryOpenAiVisionEstimate('prompt', images);
  context.tryOpenAiItemRequest('prompt', images, 'item-edit');

  assert.equal(requests.length, 2);
  for (const request of requests) {
    assert.equal(request.messages[0].content.length, 3);
    assert.equal(request.messages[0].content[1].image_url.url, 'data:image/jpeg;base64,first');
    assert.equal(request.messages[0].content[2].image_url.url, 'data:image/jpeg;base64,second');
    assert.equal(
      request.reservationTokens,
      context.utf8ByteLength('prompt') +
        request.maxCompletionTokens +
        (2 * context.OPENAI_VISION_IMAGE_RESERVATION_TOKENS) +
        context.OPENAI_RESERVATION_SAFETY_MARGIN_TOKENS,
    );
  }
});
