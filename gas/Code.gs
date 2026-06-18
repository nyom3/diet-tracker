const FOOD_LOG_SHEET_NAME = 'food_log';
const GEMINI_MODEL = 'gemini-2.5-flash';
const GEMINI_ENDPOINT =
  'https://generativelanguage.googleapis.com/v1beta/models/' +
  GEMINI_MODEL +
  ':generateContent';

const FOOD_LOG_HEADERS = [
  'id',
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
  const id = createMealId();

  sheet.appendRow([
    id,
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

  return { ok: true, id: id };
}

function listRecentMeals(limit) {
  const sheet = getFoodLogSheet();
  const lastRow = sheet.getLastRow();
  const count = Math.min(Math.max(Number(limit) || 10, 1), 50);

  if (lastRow < 2) {
    return [];
  }

  const startRow = Math.max(2, lastRow - count + 1);
  const values = sheet.getRange(startRow, 1, lastRow - startRow + 1, FOOD_LOG_HEADERS.length).getValues();

  return values
    .map(function (row) {
      return rowToFoodLog(row);
    })
    .filter(function (meal) {
      return meal.id;
    })
    .reverse();
}

function updateMeal(id, data) {
  const mealId = String(id || '').trim();

  if (!mealId) {
    throw new Error('更新対象のidが不正です。');
  }

  const input = validateFoodLogInput(data);
  const sheet = getFoodLogSheet();
  const rowIndex = findFoodLogRowById(sheet, mealId);

  if (rowIndex < 0) {
    throw new Error('更新対象の食事記録が見つかりません。');
  }

  sheet.getRange(rowIndex, 1, 1, FOOD_LOG_HEADERS.length).setValues([[
    mealId,
    input.timestamp,
    input.meal_type,
    input.description,
    input.calories_kcal,
    input.protein_g,
    input.fat_g,
    input.carbs_g,
    input.source,
    input.breakdown_json,
  ]]);

  return { ok: true, id: mealId };
}

function getTodaySummary() {
  const meals = listMealsForTodayUntil(new Date());
  const total = sumMeals(meals);

  return {
    date: Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd'),
    count: meals.length,
    total: total,
  };
}

function summarizeTodayFeedback() {
  const meals = listMealsForTodayUntil(new Date());

  if (meals.length === 0) {
    throw new Error('今日の食事記録がまだありません。');
  }

  const total = sumMeals(meals);
  const mealLines = meals.map(function (meal) {
    return [
      meal.meal_type,
      meal.description,
      Math.round(meal.calories_kcal) + 'kcal',
      'P' + meal.protein_g + 'g',
      'F' + meal.fat_g + 'g',
      'C' + meal.carbs_g + 'g',
    ].join(' / ');
  });

  const prompt =
    'あなたは食事記録を見て短く実用的にコメントする栄養士です。\n' +
    '評価時点までの今日の食事だけを対象に、食べ過ぎ傾向・ヘルシーさ・次の一食の提案を日本語で3文以内にまとめてください。\n' +
    '断定しすぎず、医療助言ではなく一般的な食事コメントとして書いてください。\n\n' +
    '合計: ' +
    Math.round(total.calories_kcal) +
    'kcal / P' +
    total.protein_g +
    'g / F' +
    total.fat_g +
    'g / C' +
    total.carbs_g +
    'g\n' +
    '食事:\n- ' +
    mealLines.join('\n- ');

  return {
    date: Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd'),
    count: meals.length,
    total: total,
    feedback: callGeminiText(prompt),
  };
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

function callGeminiText(prompt) {
  const apiKey = PropertiesService.getScriptProperties().getProperty('GEMINI_API_KEY');

  if (!apiKey) {
    throw new Error('GEMINI_API_KEY が設定されていません。');
  }

  const text = String(prompt || '').trim();

  if (!text) {
    throw new Error('Gemini に送る内容が空です。');
  }

  const response = UrlFetchApp.fetch(GEMINI_ENDPOINT + '?key=' + encodeURIComponent(apiKey), {
    method: 'post',
    contentType: 'application/json',
    muteHttpExceptions: true,
    payload: JSON.stringify({
      contents: [
        {
          role: 'user',
          parts: [{ text: text }],
        },
      ],
      generationConfig: {
        temperature: 0.3,
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

  return String(responseText).trim();
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
  const lastColumn = Math.max(sheet.getLastColumn(), FOOD_LOG_HEADERS.length);
  const currentHeaders = sheet.getRange(1, 1, 1, lastColumn).getValues()[0];
  const hasLegacyHeaders = currentHeaders[0] === 'timestamp';

  if (hasLegacyHeaders) {
    sheet.insertColumnBefore(1);
  }

  const headerRange = sheet.getRange(1, 1, 1, FOOD_LOG_HEADERS.length);
  const nextHeaders = headerRange.getValues()[0];
  const shouldWriteHeaders = FOOD_LOG_HEADERS.some(function (header, index) {
    return nextHeaders[index] !== header;
  });

  if (shouldWriteHeaders) {
    headerRange.setValues([FOOD_LOG_HEADERS]);
  }

  backfillFoodLogIds(sheet);
}

function backfillFoodLogIds(sheet) {
  const lastRow = sheet.getLastRow();

  if (lastRow < 2) {
    return;
  }

  const idRange = sheet.getRange(2, 1, lastRow - 1, 1);
  const ids = idRange.getValues();
  var changed = false;

  const nextIds = ids.map(function (row) {
    if (String(row[0] || '').trim()) {
      return row;
    }

    changed = true;
    return [createMealId()];
  });

  if (changed) {
    idRange.setValues(nextIds);
  }
}

function findFoodLogRowById(sheet, id) {
  const lastRow = sheet.getLastRow();

  if (lastRow < 2) {
    return -1;
  }

  const ids = sheet.getRange(2, 1, lastRow - 1, 1).getValues();

  for (var index = 0; index < ids.length; index += 1) {
    if (String(ids[index][0] || '').trim() === id) {
      return index + 2;
    }
  }

  return -1;
}

function rowToFoodLog(row) {
  return {
    id: String(row[0] || '').trim(),
    timestamp: row[1] instanceof Date ? row[1].toISOString() : String(row[1] || '').trim(),
    meal_type: String(row[2] || '').trim(),
    description: String(row[3] || '').trim(),
    calories_kcal: toNonNegativeNumber(row[4], 'カロリー'),
    protein_g: toNonNegativeNumber(row[5], 'タンパク質'),
    fat_g: toNonNegativeNumber(row[6], '脂質'),
    carbs_g: toNonNegativeNumber(row[7], '炭水化物'),
    source: String(row[8] || '').trim(),
    breakdown_json: String(row[9] || '').trim(),
  };
}

function listMealsForTodayUntil(now) {
  const sheet = getFoodLogSheet();
  const lastRow = sheet.getLastRow();

  if (lastRow < 2) {
    return [];
  }

  const timezone = Session.getScriptTimeZone();
  const today = Utilities.formatDate(now, timezone, 'yyyy-MM-dd');
  const values = sheet.getRange(2, 1, lastRow - 1, FOOD_LOG_HEADERS.length).getValues();

  return values
    .map(function (row) {
      return rowToFoodLog(row);
    })
    .filter(function (meal) {
      const timestamp = new Date(meal.timestamp);

      if (isNaN(timestamp.getTime()) || timestamp.getTime() > now.getTime()) {
        return false;
      }

      return Utilities.formatDate(timestamp, timezone, 'yyyy-MM-dd') === today;
    });
}

function sumMeals(meals) {
  return meals.reduce(
    function (sum, meal) {
      return {
        calories_kcal: Math.round(sum.calories_kcal + meal.calories_kcal),
        protein_g: roundToTenth(sum.protein_g + meal.protein_g),
        fat_g: roundToTenth(sum.fat_g + meal.fat_g),
        carbs_g: roundToTenth(sum.carbs_g + meal.carbs_g),
      };
    },
    {
      calories_kcal: 0,
      protein_g: 0,
      fat_g: 0,
      carbs_g: 0,
    },
  );
}

function createMealId() {
  return 'meal_' + Utilities.getUuid();
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

function roundToTenth(value) {
  return Math.round(value * 10) / 10;
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
