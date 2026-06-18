const FOOD_LOG_SHEET_NAME = 'food_log';
const GEMINI_MODEL = 'gemini-2.5-flash';
const GEMINI_ENDPOINT =
  'https://generativelanguage.googleapis.com/v1beta/models/' +
  GEMINI_MODEL +
  ':generateContent';

const FOOD_LOG_HEADERS = [
  'timestamp',
  'meal_type',
  'description',
  'calories_kcal',
  'protein_g',
  'fat_g',
  'carbs_g',
  'source',
  'breakdown_json',
];

function doGet() {
  return HtmlService.createHtmlOutputFromFile('index')
    .setTitle('食事記録')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function processInput(data) {
  const input = validateFoodLogInput(data);
  const sheet = getFoodLogSheet();

  sheet.appendRow([
    input.timestamp,
    input.meal_type,
    input.description,
    input.calories_kcal,
    input.protein_g,
    input.fat_g,
    input.carbs_g,
    input.source,
    input.breakdown_json,
  ]);

  return { ok: true };
}

function estimateCalories(inputText, imageBase64, imageMimeType) {
  const apiKey = PropertiesService.getScriptProperties().getProperty('GEMINI_API_KEY');

  if (!apiKey) {
    throw new Error('GEMINI_API_KEY が設定されていません。');
  }

  const text = String(inputText || '').trim();
  const image = String(imageBase64 || '').trim();
  const mimeType = String(imageMimeType || 'image/jpeg').trim();

  if (!text && !image) {
    throw new Error('食事の説明または画像を入力してください。');
  }

  const prompt =
    'あなたは栄養士です。食事の説明または画像から、品ごとのカロリーとPFCを推定してください。\n' +
    '必ずJSONのみで回答してください。他の文字列を含めないでください。\n' +
    '{"items":[{"name":"品名","calories_kcal":数値,"protein_g":数値,"fat_g":数値,"carbs_g":数値}],' +
    '"total":{"calories_kcal":数値,"protein_g":数値,"fat_g":数値,"carbs_g":数値}}\n\n' +
    (text ? '食事: ' + text : '画像の食事を推定してください。');

  const parts = [{ text: prompt }];

  if (image) {
    parts.push({
      inline_data: {
        mime_type: mimeType,
        data: stripDataUrlPrefix(image),
      },
    });
  }

  const response = UrlFetchApp.fetch(GEMINI_ENDPOINT + '?key=' + encodeURIComponent(apiKey), {
    method: 'post',
    contentType: 'application/json',
    muteHttpExceptions: true,
    payload: JSON.stringify({
      contents: [
        {
          role: 'user',
          parts: parts,
        },
      ],
      generationConfig: {
        temperature: 0.2,
        response_mime_type: 'application/json',
      },
    }),
  });

  const statusCode = response.getResponseCode();
  const body = response.getContentText();

  if (statusCode < 200 || statusCode >= 300) {
    throw new Error('Gemini API の呼び出しに失敗しました。status=' + statusCode);
  }

  const payload = JSON.parse(body);
  const responseText =
    payload.candidates &&
    payload.candidates[0] &&
    payload.candidates[0].content &&
    payload.candidates[0].content.parts &&
    payload.candidates[0].content.parts[0] &&
    payload.candidates[0].content.parts[0].text;

  if (!responseText) {
    throw new Error('Gemini API の応答が空です。');
  }

  return normalizeNutritionResult(JSON.parse(extractJson(responseText)), text || '画像の食事');
}

function getFoodLogSheet() {
  const spreadsheetId = PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID');
  const spreadsheet = spreadsheetId
    ? SpreadsheetApp.openById(spreadsheetId)
    : SpreadsheetApp.getActiveSpreadsheet();

  if (!spreadsheet) {
    throw new Error('書き込み先スプレッドシートが見つかりません。');
  }

  const sheet = spreadsheet.getSheetByName(FOOD_LOG_SHEET_NAME) || spreadsheet.insertSheet(FOOD_LOG_SHEET_NAME);
  ensureFoodLogHeaders(sheet);
  return sheet;
}

function ensureFoodLogHeaders(sheet) {
  const headerRange = sheet.getRange(1, 1, 1, FOOD_LOG_HEADERS.length);
  const currentHeaders = headerRange.getValues()[0];
  const shouldWriteHeaders = FOOD_LOG_HEADERS.some(function (header, index) {
    return currentHeaders[index] !== header;
  });

  if (shouldWriteHeaders) {
    headerRange.setValues([FOOD_LOG_HEADERS]);
  }
}

function validateFoodLogInput(data) {
  if (!data || typeof data !== 'object') {
    throw new Error('保存データが不正です。');
  }

  const mealType = String(data.meal_type || '').trim();
  const timestamp = String(data.timestamp || '').trim();
  const description = String(data.description || '').trim();
  const source = String(data.source || '').trim();
  const breakdownJson = String(data.breakdown_json || '').trim();

  if (!timestamp || isNaN(Date.parse(timestamp))) {
    throw new Error('食事日時が不正です。');
  }

  if (['朝', '昼', '夜', '間食'].indexOf(mealType) === -1) {
    throw new Error('食事タイプが不正です。');
  }

  if (!description) {
    throw new Error('食事の説明を入力してください。');
  }

  if (['api', 'manual'].indexOf(source) === -1) {
    throw new Error('推定方法が不正です。');
  }

  return {
    timestamp: timestamp,
    meal_type: mealType,
    description: description,
    calories_kcal: toNonNegativeNumber(data.calories_kcal, 'カロリー'),
    protein_g: toNonNegativeNumber(data.protein_g, 'タンパク質'),
    fat_g: toNonNegativeNumber(data.fat_g, '脂質'),
    carbs_g: toNonNegativeNumber(data.carbs_g, '炭水化物'),
    source: source,
    breakdown_json: breakdownJson,
  };
}

function normalizeNutritionResult(result, fallbackName) {
  if (!result || typeof result !== 'object') {
    throw new Error('推定結果のJSONが不正です。');
  }

  const total = result.total || result;
  const normalizedTotal = normalizeNutritionTotal(total);
  const rawItems = Array.isArray(result.items) && result.items.length > 0
    ? result.items
    : [
        {
          name: fallbackName || '食事',
          calories_kcal: normalizedTotal.calories_kcal,
          protein_g: normalizedTotal.protein_g,
          fat_g: normalizedTotal.fat_g,
          carbs_g: normalizedTotal.carbs_g,
        },
      ];

  return {
    items: rawItems.map(normalizeNutritionItem),
    total: normalizedTotal,
  };
}

function normalizeNutritionTotal(result) {
  return {
    calories_kcal: toNonNegativeNumber(result.calories_kcal, 'カロリー'),
    protein_g: toNonNegativeNumber(result.protein_g, 'タンパク質'),
    fat_g: toNonNegativeNumber(result.fat_g, '脂質'),
    carbs_g: toNonNegativeNumber(result.carbs_g, '炭水化物'),
  };
}

function normalizeNutritionItem(item) {
  const rawItem = item || {};
  const name = String(rawItem.name || '品名未設定').trim();

  return {
    name: name || '品名未設定',
    calories_kcal: toNonNegativeNumber(rawItem.calories_kcal, 'カロリー'),
    protein_g: toNonNegativeNumber(rawItem.protein_g, 'タンパク質'),
    fat_g: toNonNegativeNumber(rawItem.fat_g, '脂質'),
    carbs_g: toNonNegativeNumber(rawItem.carbs_g, '炭水化物'),
  };
}

function toNonNegativeNumber(value, label) {
  const numberValue = Number(value);

  if (!isFinite(numberValue) || numberValue < 0) {
    throw new Error(label + 'は0以上の数値で入力してください。');
  }

  return numberValue;
}

function extractJson(text) {
  const trimmed = String(text || '').trim();

  if (trimmed.charAt(0) === '{') {
    return trimmed;
  }

  const match = trimmed.match(/\{[\s\S]*\}/);
  if (!match) {
    throw new Error('推定結果からJSONを読み取れませんでした。');
  }

  return match[0];
}

function stripDataUrlPrefix(value) {
  return String(value || '').replace(/^data:[^;]+;base64,/, '');
}
