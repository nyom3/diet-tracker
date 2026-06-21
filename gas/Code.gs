const FOOD_LOG_SHEET_NAME = 'food_log';
const FAVORITES_SHEET_NAME = 'favorites';
const TARGETS_SHEET_NAME = 'targets';
const HEALTH_DATA_SHEET_NAME = 'health_data';
const WEEKLY_REVIEW_SHEET_NAME = 'weekly_review';
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
const FAVORITE_HEADERS = [
  'id',
  'description',
  'calories_kcal',
  'protein_g',
  'fat_g',
  'carbs_g',
  'breakdown_json',
  'created_at',
];
const TARGET_KEYS = ['calories_kcal', 'protein_g', 'fat_g', 'carbs_g'];
const WEEKLY_REVIEW_HEADERS = ['generated_at', 'window_start', 'window_end', 'text'];

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

function listFavorites() {
  const sheet = getFavoritesSheet();
  const lastRow = sheet.getLastRow();

  if (lastRow < 2) {
    return [];
  }

  const values = sheet.getRange(2, 1, lastRow - 1, FAVORITE_HEADERS.length).getValues();

  return values
    .map(function (row) {
      return rowToFavorite(row);
    })
    .filter(function (favorite) {
      return favorite.id;
    })
    .sort(function (a, b) {
      return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
    });
}

function addFavorite(data) {
  const input = validateFavoriteInput(data);
  const sheet = getFavoritesSheet();
  const favorite = {
    id: createFavoriteId(),
    description: input.description,
    calories_kcal: input.calories_kcal,
    protein_g: input.protein_g,
    fat_g: input.fat_g,
    carbs_g: input.carbs_g,
    breakdown_json: input.breakdown_json,
    created_at: new Date().toISOString(),
  };

  sheet.appendRow([
    favorite.id,
    favorite.description,
    favorite.calories_kcal,
    favorite.protein_g,
    favorite.fat_g,
    favorite.carbs_g,
    favorite.breakdown_json,
    favorite.created_at,
  ]);

  return favorite;
}

function removeFavorite(id) {
  const favoriteId = String(id || '').trim();

  if (!favoriteId) {
    throw new Error('削除対象のお気に入りidが不正です。');
  }

  const sheet = getFavoritesSheet();
  const rowIndex = findFavoriteRowById(sheet, favoriteId);

  if (rowIndex < 0) {
    throw new Error('削除対象のお気に入りが見つかりません。');
  }

  sheet.deleteRow(rowIndex);
  return { ok: true, id: favoriteId };
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

function getTargets() {
  const sheet = getTargetsSheet();
  const lastRow = sheet.getLastRow();
  const targets = createEmptyTargets();

  if (lastRow < 2) {
    return targets;
  }

  const values = sheet.getRange(2, 1, lastRow - 1, 2).getValues();
  values.forEach(function (row) {
    const key = String(row[0] || '').trim();

    if (TARGET_KEYS.indexOf(key) !== -1 && row[1] !== '') {
      targets[key] = toNonNegativeNumber(row[1], key);
    }
  });

  return targets;
}

function saveTargets(data) {
  const targets = validateTargets(data);
  const sheet = getTargetsSheet();
  const values = TARGET_KEYS.map(function (key) {
    return [key, targets[key]];
  });

  sheet.getRange(2, 1, values.length, 2).setValues(values);
  return { ok: true, targets: targets };
}

function getWeeklyTrend() {
  const today = new Date();
  const timezone = Session.getScriptTimeZone();
  const windowEnd = Utilities.formatDate(today, timezone, 'yyyy-MM-dd');
  const windowStartDate = addDays(startOfLocalDay(today), -6);
  const windowStart = Utilities.formatDate(windowStartDate, timezone, 'yyyy-MM-dd');
  const days = createTrendDays(windowStartDate);
  const meals = listMealsForWindow(windowStartDate, today);
  const healthByDate = readHealthDataByDate(windowStart, windowEnd);

  meals.forEach(function (meal) {
    const timestamp = new Date(meal.timestamp);
    const dateKey = Utilities.formatDate(timestamp, timezone, 'yyyy-MM-dd');
    const day = days.filter(function (candidate) { return candidate.date === dateKey; })[0];

    if (!day) {
      return;
    }

    day.count += 1;
    day.total = sumMeals([day.total, meal]);
  });

  days.forEach(function (day) {
    day.weight_kg = healthByDate[day.date] === undefined ? null : healthByDate[day.date];
  });

  return {
    window_start: windowStart,
    window_end: windowEnd,
    targets: getTargets(),
    days: days,
    latest_review: getLatestWeeklyReview(),
  };
}

function getLatestWeeklyReview() {
  const sheet = getWeeklyReviewSheet();
  const lastRow = sheet.getLastRow();

  if (lastRow < 2) {
    return null;
  }

  const row = sheet.getRange(lastRow, 1, 1, WEEKLY_REVIEW_HEADERS.length).getValues()[0];
  return rowToWeeklyReview(row);
}

function summarizeWeeklyFeedback() {
  const trend = getWeeklyTrend();
  const latestReview = getLatestWeeklyReview();

  if (latestReview && latestReview.window_end === trend.window_end) {
    return latestReview;
  }

  const activeDays = trend.days.filter(function (day) {
    return day.count > 0;
  });

  if (activeDays.length === 0) {
    return {
      generated_at: new Date().toISOString(),
      window_start: trend.window_start,
      window_end: trend.window_end,
      text: '直近7日間の食事記録がありません。',
    };
  }

  const weeklyTotal = sumMeals(trend.days.map(function (day) { return day.total; }));
  const dailyAverage = {
    calories_kcal: Math.round(weeklyTotal.calories_kcal / activeDays.length),
    protein_g: roundToTenth(weeklyTotal.protein_g / activeDays.length),
    fat_g: roundToTenth(weeklyTotal.fat_g / activeDays.length),
    carbs_g: roundToTenth(weeklyTotal.carbs_g / activeDays.length),
  };
  const targetLines = TARGET_KEYS.map(function (key) {
    const targetValue = trend.targets[key];
    if (targetValue === null) {
      return key + ': 目標未設定';
    }

    return key + ': 平均 ' + dailyAverage[key] + ' / 目標 ' + targetValue + ' / 差分 ' + roundToTenth(dailyAverage[key] - targetValue);
  });
  const prompt =
    'あなたは食事記録を見て短く実用的にコメントする栄養士です。\n' +
    '今日を含む直近7日について、下記のGAS集計済み数値だけを根拠に、日本語で3文以内の週次コメントを書いてください。\n' +
    '断定しすぎず、医療助言ではなく一般的な食事コメントとして書いてください。\n\n' +
    '期間: ' + trend.window_start + ' 〜 ' + trend.window_end + '\n' +
    '記録あり日数: ' + activeDays.length + ' / 7\n' +
    '週合計: ' + Math.round(weeklyTotal.calories_kcal) + 'kcal / P' + weeklyTotal.protein_g + 'g / F' + weeklyTotal.fat_g + 'g / C' + weeklyTotal.carbs_g + 'g\n' +
    '日平均: ' + Math.round(dailyAverage.calories_kcal) + 'kcal / P' + dailyAverage.protein_g + 'g / F' + dailyAverage.fat_g + 'g / C' + dailyAverage.carbs_g + 'g\n' +
    '目標差分:\n- ' + targetLines.join('\n- ');
  const review = {
    generated_at: new Date().toISOString(),
    window_start: trend.window_start,
    window_end: trend.window_end,
    text: callGeminiText(prompt),
  };
  const sheet = getWeeklyReviewSheet();

  sheet.appendRow([
    review.generated_at,
    review.window_start,
    review.window_end,
    review.text,
  ]);

  return review;
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
    'display_name は食事全体を表す短い日本語の名前（10文字以内目安）にしてください。\n' +
    '必ずJSONのみで回答してください。他の文字列を含めないでください。\n' +
    '{"display_name":"食事全体を表す短い日本語の名前（10文字以内目安、例: 牛丼定食）",' +
    '"items":[{"name":"品名","calories_kcal":数値,"protein_g":数値,"fat_g":数値,"carbs_g":数値}],' +
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
  const allParts = (
    payload.candidates &&
    payload.candidates[0] &&
    payload.candidates[0].content &&
    payload.candidates[0].content.parts
  ) || [];
  const responsePart = allParts.filter(function (p) { return !p.thought && p.text; })[0];
  const responseText = responsePart && responsePart.text;

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
  const allParts = (
    payload.candidates &&
    payload.candidates[0] &&
    payload.candidates[0].content &&
    payload.candidates[0].content.parts
  ) || [];
  const responsePart = allParts.filter(function (p) { return !p.thought && p.text; })[0];
  const responseText = responsePart && responsePart.text;

  if (!responseText) {
    throw new Error('Gemini API の応答が空です。');
  }

  return String(responseText).trim();
}

function getFoodLogSheet() {
  const spreadsheet = getSpreadsheet();
  const sheet = spreadsheet.getSheetByName(FOOD_LOG_SHEET_NAME) || spreadsheet.insertSheet(FOOD_LOG_SHEET_NAME);
  ensureFoodLogHeaders(sheet);
  return sheet;
}

function getFavoritesSheet() {
  const spreadsheet = getSpreadsheet();
  const sheet = spreadsheet.getSheetByName(FAVORITES_SHEET_NAME) || spreadsheet.insertSheet(FAVORITES_SHEET_NAME);
  const headerRange = sheet.getRange(1, 1, 1, FAVORITE_HEADERS.length);
  const headers = headerRange.getValues()[0];
  const shouldWriteHeaders = FAVORITE_HEADERS.some(function (header, index) {
    return headers[index] !== header;
  });

  if (shouldWriteHeaders) {
    headerRange.setValues([FAVORITE_HEADERS]);
  }

  return sheet;
}

function getTargetsSheet() {
  const spreadsheet = getSpreadsheet();
  const sheet = spreadsheet.getSheetByName(TARGETS_SHEET_NAME) || spreadsheet.insertSheet(TARGETS_SHEET_NAME);
  const headerRange = sheet.getRange(1, 1, 1, 2);
  const headers = headerRange.getValues()[0];

  if (headers[0] !== 'key' || headers[1] !== 'value') {
    headerRange.setValues([['key', 'value']]);
  }

  return sheet;
}

function getWeeklyReviewSheet() {
  const spreadsheet = getSpreadsheet();
  const sheet = spreadsheet.getSheetByName(WEEKLY_REVIEW_SHEET_NAME) || spreadsheet.insertSheet(WEEKLY_REVIEW_SHEET_NAME);
  const headerRange = sheet.getRange(1, 1, 1, WEEKLY_REVIEW_HEADERS.length);
  const headers = headerRange.getValues()[0];
  const shouldWriteHeaders = WEEKLY_REVIEW_HEADERS.some(function (header, index) {
    return headers[index] !== header;
  });

  if (shouldWriteHeaders) {
    headerRange.setValues([WEEKLY_REVIEW_HEADERS]);
  }

  return sheet;
}

function getSpreadsheet() {
  const spreadsheetId = PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID');
  const spreadsheet = spreadsheetId
    ? SpreadsheetApp.openById(spreadsheetId)
    : SpreadsheetApp.getActiveSpreadsheet();

  if (!spreadsheet) {
    throw new Error('書き込み先スプレッドシートが見つかりません。');
  }

  return spreadsheet;
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

function findFavoriteRowById(sheet, id) {
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

function rowToFavorite(row) {
  return {
    id: String(row[0] || '').trim(),
    description: String(row[1] || '').trim(),
    calories_kcal: toNonNegativeNumber(row[2], 'カロリー'),
    protein_g: toNonNegativeNumber(row[3], 'タンパク質'),
    fat_g: toNonNegativeNumber(row[4], '脂質'),
    carbs_g: toNonNegativeNumber(row[5], '炭水化物'),
    breakdown_json: String(row[6] || '').trim(),
    created_at: row[7] instanceof Date ? row[7].toISOString() : String(row[7] || '').trim(),
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

function listMealsForWindow(windowStartDate, windowEndDate) {
  const sheet = getFoodLogSheet();
  const lastRow = sheet.getLastRow();

  if (lastRow < 2) {
    return [];
  }

  const startTime = startOfLocalDay(windowStartDate).getTime();
  const endTime = windowEndDate.getTime();
  const values = sheet.getRange(2, 1, lastRow - 1, FOOD_LOG_HEADERS.length).getValues();

  return values
    .map(function (row) {
      return rowToFoodLog(row);
    })
    .filter(function (meal) {
      const timestamp = new Date(meal.timestamp);

      if (isNaN(timestamp.getTime())) {
        return false;
      }

      return timestamp.getTime() >= startTime && timestamp.getTime() <= endTime;
    });
}

function readHealthDataByDate(windowStart, windowEnd) {
  const spreadsheet = getSpreadsheet();
  const sheet = spreadsheet.getSheetByName(HEALTH_DATA_SHEET_NAME);
  const result = {};

  if (!sheet || sheet.getLastRow() < 2) {
    return result;
  }

  const values = sheet.getRange(2, 1, sheet.getLastRow() - 1, 2).getValues();
  values.forEach(function (row) {
    const date = formatSheetDate(row[0]);
    const weight = Number(row[1]);

    if (date >= windowStart && date <= windowEnd && row[1] !== '' && isFinite(weight) && weight >= 0) {
      result[date] = weight;
    }
  });

  return result;
}

function createTrendDays(windowStartDate) {
  const timezone = Session.getScriptTimeZone();
  const days = [];

  for (var offset = 0; offset < 7; offset += 1) {
    days.push({
      date: Utilities.formatDate(addDays(windowStartDate, offset), timezone, 'yyyy-MM-dd'),
      count: 0,
      total: createZeroTotal(),
      weight_kg: null,
    });
  }

  return days;
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

function createZeroTotal() {
  return {
    calories_kcal: 0,
    protein_g: 0,
    fat_g: 0,
    carbs_g: 0,
  };
}

function createEmptyTargets() {
  return {
    calories_kcal: null,
    protein_g: null,
    fat_g: null,
    carbs_g: null,
  };
}

function createMealId() {
  return 'meal_' + Utilities.getUuid();
}

function createFavoriteId() {
  return 'fav_' + Utilities.getUuid();
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

function validateFavoriteInput(data) {
  if (!data || typeof data !== 'object') {
    throw new Error('お気に入りデータが不正です。');
  }

  const description = String(data.description || '').trim();

  if (!description) {
    throw new Error('お気に入りの食事名を入力してください。');
  }

  return {
    description: description,
    calories_kcal: toNonNegativeNumber(data.calories_kcal, 'カロリー'),
    protein_g: toNonNegativeNumber(data.protein_g, 'タンパク質'),
    fat_g: toNonNegativeNumber(data.fat_g, '脂質'),
    carbs_g: toNonNegativeNumber(data.carbs_g, '炭水化物'),
    breakdown_json: String(data.breakdown_json || '').trim(),
  };
}

function validateTargets(data) {
  if (!data || typeof data !== 'object') {
    throw new Error('目標データが不正です。');
  }

  return {
    calories_kcal: toNonNegativeNumber(data.calories_kcal, '目標カロリー'),
    protein_g: toNonNegativeNumber(data.protein_g, '目標タンパク質'),
    fat_g: toNonNegativeNumber(data.fat_g, '目標脂質'),
    carbs_g: toNonNegativeNumber(data.carbs_g, '目標炭水化物'),
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
    display_name: String(result.display_name || '').trim(),
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

function addDays(date, days) {
  const nextDate = new Date(date.getTime());
  nextDate.setDate(nextDate.getDate() + days);
  return nextDate;
}

function startOfLocalDay(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function formatSheetDate(value) {
  if (value instanceof Date) {
    return Utilities.formatDate(value, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  }

  return String(value || '').trim();
}

function rowToWeeklyReview(row) {
  const generatedAt = row[0] instanceof Date ? row[0].toISOString() : String(row[0] || '').trim();
  const windowStart = formatSheetDate(row[1]);
  const windowEnd = formatSheetDate(row[2]);

  return {
    generated_at: generatedAt,
    window_start: windowStart,
    window_end: windowEnd,
    text: String(row[3] || '').trim(),
  };
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
