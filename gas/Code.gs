const FOOD_LOG_SHEET_NAME = 'food_log';
const FAVORITES_SHEET_NAME = 'favorites';
const TARGETS_SHEET_NAME = 'targets';
const HEALTH_DATA_SHEET_NAME = 'health_data';
const WEEKLY_REVIEW_SHEET_NAME = 'weekly_review';
const GEMINI_MODEL = 'gemini-3.5-flash';
const GEMINI_FALLBACK_MODEL = 'gemini-2.5-flash';
const GEMINI_FALLBACK_NOTICE =
  'Gemini 3.5 Flashの制限または混雑により、Gemini 2.5 Flashで出力しました。';

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
const GOAL_KEYS = TARGET_KEYS.concat(['target_weight_kg']);
const WEEKLY_REVIEW_HEADERS = ['generated_at', 'window_start', 'window_end', 'text'];
const MIN_VALID_WEIGHT_KG = 20;
const MAX_VALID_WEIGHT_KG = 300;
const MAX_AI_IMAGE_BYTES = Math.floor(1.5 * 1024 * 1024);

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

function deleteMeal(id) {
  const mealId = String(id || '').trim();

  if (!mealId) {
    throw new Error('削除対象のidが不正です。');
  }

  const sheet = getFoodLogSheet();
  const rowIndex = findFoodLogRowById(sheet, mealId);

  if (rowIndex < 0) {
    throw new Error('削除対象の食事記録が見つかりません。');
  }

  sheet.deleteRow(rowIndex);
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
  return nutritionGoalsFromHealthGoals(getGoals());
}

function saveTargets(data) {
  const targets = validateTargets(data);
  const currentGoals = getGoals();
  const result = saveGoals({
    calories_kcal: targets.calories_kcal,
    protein_g: targets.protein_g,
    fat_g: targets.fat_g,
    carbs_g: targets.carbs_g,
    target_weight_kg: currentGoals.target_weight_kg,
  });

  return { ok: true, targets: nutritionGoalsFromHealthGoals(result.goals) };
}

function getGoals() {
  return readGoalsFromSheet(getTargetsSheet());
}

function saveGoals(data) {
  const goals = validateGoals(data);
  const sheet = getTargetsSheet();
  const values = GOAL_KEYS.map(function (key) {
    return [key, goals[key]];
  });

  sheet.getRange(2, 1, values.length, 2).setValues(values);
  return { ok: true, goals: goals };
}

function getHomeSnapshot() {
  const now = new Date();
  const timezone = Session.getScriptTimeZone();
  const date = Utilities.formatDate(now, timezone, 'yyyy-MM-dd');
  const meals = readFoodLogsFromSheet(getFoodLogSheet());
  const todayMeals = meals.filter(function (meal) {
    return isMealOnDateUntil(meal, date, now, timezone);
  });
  const recentMeals = meals
    .filter(function (meal) {
      const timestamp = new Date(meal.timestamp);
      return !isNaN(timestamp.getTime()) && timestamp.getTime() <= now.getTime() &&
        Utilities.formatDate(timestamp, timezone, 'yyyy-MM-dd') !== date;
    })
    .sort(function (a, b) {
      return new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime();
    })
    .slice(0, 3);
  const favorites = readFavoritesFromSheet(getFavoritesSheet())
    .sort(function (a, b) {
      return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
    })
    .slice(0, 6);
  const goals = getGoals();
  const today = {
    date: date,
    count: todayMeals.length,
    total: sumMeals(todayMeals),
  };
  const dashboard = buildCoachDashboardData(7, now, meals, goals);
  const todayDashboardDay = dashboard.days.filter(function (day) {
    return day.date === date;
  })[0] || createCoachEmptyDay(date);

  return {
    date: date,
    today: today,
    goals: goals,
    today_meals: todayMeals,
    recent_meals: recentMeals,
    favorites: favorites,
    active_action: null,
    rule_focus: buildCoachInsight('today', dashboard.days, goals, todayDashboardDay),
  };
}

function generateCoachInsight(request) {
  const normalizedRequest = normalizeCoachInsightRequest(request);
  const now = new Date();
  const context = getCoachDashboardContext(normalizedRequest.rangeDays, now);
  const today = context.dashboard.days.filter(function (day) {
    return day.date === context.dashboard.window_end;
  })[0] || createCoachEmptyDay(context.dashboard.window_end);
  const rulesInsight = buildCoachInsight(
    normalizedRequest.scope,
    context.dashboard.days,
    context.dashboard.goals,
    today,
  );
  const evidenceSuggestions = buildCoachEvidence(
    normalizedRequest.scope,
    context.dashboard.days,
    context.dashboard.goals,
    today,
  );
  const actionCandidates = buildCoachActionCandidates(
    context.dashboard.days,
    context.dashboard.goals,
    today,
  );
  const candidatePairs = buildCoachCandidatePairs(evidenceSuggestions, actionCandidates);

  if (candidatePairs.length === 0) {
    return rulesInsight;
  }

  const prompt = buildCoachAiPrompt(normalizedRequest.scope, context, today, candidatePairs);
  const aiResult = runAiJson(prompt, 'low');

  if (!aiResult || !aiResult.ok) {
    return buildCoachRulesFallback(rulesInsight, 'AIを利用できないため、ルール結果を表示しました。', aiResult && aiResult.reason);
  }

  let aiResponse;
  try {
    aiResponse = JSON.parse(extractJson(aiResult.text));
  } catch (error) {
    return buildCoachRulesFallback(rulesInsight, 'AIの応答を確認できないため、ルール結果を表示しました。', aiResult.fallback_notice);
  }

  const validated = validateCoachAiResponse(candidatePairs, aiResponse);
  if (!validated) {
    return buildCoachRulesFallback(rulesInsight, 'AIの応答を確認できないため、ルール結果を表示しました。', aiResult.fallback_notice);
  }

  const selectedPair = candidatePairs.filter(function (pair) {
    return pair.evidence_key === validated.evidence_key && pair.action_key === validated.action_key;
  })[0];
  const alternativePair = candidatePairs.filter(function (pair) {
    return pair !== selectedPair;
  })[0] || null;

  return {
    generated_at: rulesInsight.generated_at,
    scope: rulesInsight.scope,
    source: 'ai',
    headline: validated.headline,
    summary: validated.summary,
    confidence: selectedPair.confidence,
    evidence: selectedPair.evidence,
    selected_action: selectedPair.action,
    alternative_action: alternativePair ? alternativePair.action : null,
    fallback_notice: aiResult.fallback_notice || undefined,
  };
}

function normalizeCoachInsightRequest(request) {
  const source = request && typeof request === 'object' ? request : {};
  const scope = String(source.scope || '').trim();

  if (scope !== 'today' && scope !== 'trend') {
    throw new Error('コーチ分析の対象が不正です。');
  }

  const rangeDays = scope === 'trend' ? Number(source.range_days) : 7;
  if ([7, 30, 90].indexOf(rangeDays) === -1) {
    throw new Error('分析期間は7、30、90日のいずれかです。');
  }

  return { scope: scope, rangeDays: rangeDays };
}

function getCoachDashboardContext(rangeDays, now) {
  const meals = readFoodLogsFromSheet(getFoodLogSheet());
  const goals = getGoals();
  return {
    dashboard: buildCoachDashboardData(rangeDays, now, meals, goals),
    meals: meals,
  };
}

function buildCoachDashboardData(rangeDays, now, meals, goals) {
  const spreadsheet = getSpreadsheet();
  const healthSheet = spreadsheet.getSheetByName(HEALTH_DATA_SHEET_NAME);
  const healthValues = healthSheet && healthSheet.getLastRow() >= 2 && healthSheet.getLastColumn() >= 1
    ? healthSheet.getRange(1, 1, healthSheet.getLastRow(), healthSheet.getLastColumn()).getValues()
    : [];
  const timezone = Session.getScriptTimeZone();
  const metricsNow = Utilities.formatDate(now, timezone, "yyyy-MM-dd'T'HH:mm:ssZ");

  return buildDashboardData({
    rangeDays: rangeDays,
    now: metricsNow,
    foodLogs: meals || [],
    healthHeaders: healthValues.length > 0 ? healthValues[0] : [],
    healthRows: healthValues.slice(1),
    targets: GOAL_KEYS.map(function (key) { return [key, goals[key]]; }),
  });
}

function buildCoachAiPrompt(scope, context, today, candidatePairs) {
  const periodStart = scope === 'today' ? context.dashboard.window_end : context.dashboard.window_start;
  const periodMeals = (context.meals || []).map(function (meal) {
    const timestamp = new Date(meal.timestamp);
    if (isNaN(timestamp.getTime())) {
      return null;
    }
    const date = Utilities.formatDate(timestamp, Session.getScriptTimeZone(), 'yyyy-MM-dd');
    if (date < periodStart || date > context.dashboard.window_end) {
      return null;
    }
    return { meal_type: meal.meal_type, description: meal.description };
  }).filter(function (meal) { return meal !== null; });

  const payload = {
    scope: scope,
    period: {
      start: periodStart,
      end: context.dashboard.window_end,
    },
    confidence: context.dashboard.confidence,
    goals: context.dashboard.goals,
    summary: scope === 'today' ? {
      logging_days: today.meal_count > 0 ? 1 : 0,
      adequate_days: today.coverage.adequate ? 1 : 0,
      recording_coverage_ratio: today.coverage.ratio,
      average_intake_kcal: today.intake.calories_kcal,
      average_protein_g: today.intake.protein_g,
      average_steps: today.steps,
      latest_weight_trend_kg: today.weight_trend_kg,
      weight_change_kg: null,
    } : context.dashboard.summary,
    averages: scope === 'today' ? today.intake : buildCoachAverageIntake(context.dashboard.days),
    goal_gaps: buildCoachGoalGaps(
      scope === 'today' ? today.intake : buildCoachAverageIntake(context.dashboard.days),
      context.dashboard.goals,
    ),
    meals: periodMeals,
    candidates: candidatePairs.map(function (pair) {
      return {
        evidence_key: pair.evidence_key,
        action_key: pair.action_key,
        evidence: pair.evidence,
      };
    }),
  };

  return 'あなたは食事記録アプリの安全なコーチです。入力JSONに含まれる候補だけを選び、医療診断や目標変更をせずに回答してください。' +
    '見出しは40文字以内、説明は160文字以内で、説明には半角・全角を問わず数字を含めないでください。' +
    'JSONのみで返し、action_keyとevidence_keyは同じ候補ペアから選んでください。' +
    'headline、summary、evidence_key、action_key以外のキーは返さないでください。\n' +
    JSON.stringify(payload);
}

function buildCoachAverageIntake(days) {
  const loggedDays = (days || []).filter(function (day) { return day.meal_count > 0; });
  const keys = ['calories_kcal', 'protein_g', 'fat_g', 'carbs_g'];
  const result = {};
  keys.forEach(function (key) {
    if (loggedDays.length === 0) {
      result[key] = null;
      return;
    }
    result[key] = Math.round(loggedDays.reduce(function (total, day) {
      return total + day.intake[key];
    }, 0) / loggedDays.length * 10) / 10;
  });
  return result;
}

function buildCoachGoalGaps(values, goals) {
  const keys = ['calories_kcal', 'protein_g', 'fat_g', 'carbs_g'];
  const result = {};
  keys.forEach(function (key) {
    const value = values[key];
    const goal = goals[key];
    result[key] = value !== null && value !== undefined && goal !== null && goal !== undefined
      ? Math.round((value - goal) * 10) / 10
      : null;
  });
  return result;
}

function buildCoachRulesFallback(rulesInsight, notice, providerNotice) {
  const notices = [notice, providerNotice].filter(function (value) { return value; });
  return {
    generated_at: rulesInsight.generated_at,
    scope: rulesInsight.scope,
    source: 'rules',
    headline: rulesInsight.headline,
    summary: rulesInsight.summary,
    confidence: rulesInsight.confidence,
    evidence: rulesInsight.evidence,
    selected_action: rulesInsight.selected_action,
    alternative_action: rulesInsight.alternative_action,
    fallback_notice: notices.join(' '),
  };
}

function createCoachEmptyDay(date) {
  return {
    date: date,
    intake: createZeroTotal(),
    meal_count: 0,
    coverage: { logged_main_meal_types: [], ratio: 0, adequate: false },
    weight_kg: null,
    weight_trend_kg: null,
    body_fat_pct: null,
    steps: null,
    expenditure_kcal: null,
    energy_balance_kcal: null,
  };
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

function getDashboardData(rangeDays) {
  const normalizedRangeDays = Number(rangeDays);

  if ([7, 30, 90].indexOf(normalizedRangeDays) === -1) {
    throw new Error('期間は7、30、90日のいずれかです。');
  }

  const spreadsheet = getSpreadsheet();
  const now = new Date();
  const timezone = Session.getScriptTimeZone();
  const metricsNow = Utilities.formatDate(now, timezone, "yyyy-MM-dd'T'HH:mm:ssZ");
  const foodSheet = spreadsheet.getSheetByName(FOOD_LOG_SHEET_NAME);
  const healthSheet = spreadsheet.getSheetByName(HEALTH_DATA_SHEET_NAME);
  const targetsSheet = spreadsheet.getSheetByName(TARGETS_SHEET_NAME);

  const foodLogs = foodSheet && foodSheet.getLastRow() >= 2
    ? foodSheet.getRange(2, 1, foodSheet.getLastRow() - 1, FOOD_LOG_HEADERS.length).getValues()
    : [];
  const healthValues = healthSheet && healthSheet.getLastRow() >= 2 && healthSheet.getLastColumn() >= 1
    ? healthSheet.getRange(1, 1, healthSheet.getLastRow(), healthSheet.getLastColumn()).getValues()
    : [];
  const targetValues = targetsSheet && targetsSheet.getLastRow() >= 2
    ? targetsSheet.getRange(1, 1, targetsSheet.getLastRow(), 2).getValues()
    : [];

  return buildDashboardData({
    rangeDays: normalizedRangeDays,
    now: metricsNow,
    foodLogs: foodLogs,
    healthHeaders: healthValues.length > 0 ? healthValues[0] : [],
    healthRows: healthValues.slice(1),
    targets: targetValues.slice(1),
  });
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
  const aiResult = runAiText(prompt, 'medium');
  const review = {
    generated_at: new Date().toISOString(),
    window_start: trend.window_start,
    window_end: trend.window_end,
    text: aiResult.text,
    fallback_notice: aiResult.fallback_notice,
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

  const aiResult = runAiText(prompt, 'low');

  return {
    date: Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd'),
    count: meals.length,
    total: total,
    feedback: aiResult.text,
    fallback_notice: aiResult.fallback_notice,
  };
}

function estimateCalories(inputText, imageBase64, imageMimeType, imageWidthPx, imageHeightPx) {
  const text = String(inputText || '').trim();
  const image = String(imageBase64 || '').trim();
  const imageInfo = image ? getTrustedImageInfo(image) : null;
  if (image && !imageInfo) {
    throw new Error('JPEGまたはPNG形式の画像を選択してください。');
  }
  const mimeType = imageInfo ? imageInfo.mimeType : 'image/jpeg';
  const widthPx = imageInfo ? imageInfo.widthPx : 0;
  const heightPx = imageInfo ? imageInfo.heightPx : 0;

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

  const strippedImage = image ? stripDataUrlPrefix(image) : '';
  const openAiAttempt = tryOpenAiVisionEstimate(prompt, strippedImage, mimeType, widthPx, heightPx);

  if (openAiAttempt.ok) {
    return normalizeNutritionResult(JSON.parse(extractJson(openAiAttempt.text)), text || '画像の食事');
  }

  const apiKey = PropertiesService.getScriptProperties().getProperty('GEMINI_API_KEY');

  if (!apiKey) {
    throw new Error('GEMINI_API_KEY が設定されていません。');
  }

  const parts = [{ text: prompt }];

  if (image) {
    parts.push({
      inline_data: {
        mime_type: mimeType,
        data: strippedImage,
      },
    });
  }

  const geminiResponse = fetchGeminiWithFallback(apiKey, {
    contents: [
      {
        role: 'user',
        parts: parts,
      },
    ],
    generationConfig: {
      response_mime_type: 'application/json',
      thinkingConfig: {
        thinkingLevel: 'low',
      },
    },
  });

  const payload = JSON.parse(geminiResponse.body);
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

  const result = normalizeNutritionResult(JSON.parse(extractJson(responseText)), text || '画像の食事');

  result.fallback_notice = buildFallbackNotice(
    openAiAttempt.reason,
    geminiResponse.usedFallback ? GEMINI_FALLBACK_NOTICE : '',
  );

  return result;
}

function callGeminiText(prompt, thinkingLevel) {
  const apiKey = PropertiesService.getScriptProperties().getProperty('GEMINI_API_KEY');

  if (!apiKey) {
    throw new Error('GEMINI_API_KEY が設定されていません。');
  }

  const text = String(prompt || '').trim();

  if (!text) {
    throw new Error('Gemini に送る内容が空です。');
  }

  const geminiResponse = fetchGeminiWithFallback(apiKey, {
    contents: [
      {
        role: 'user',
        parts: [{ text: text }],
      },
    ],
    generationConfig: {
      thinkingConfig: {
        thinkingLevel: thinkingLevel || 'low',
      },
    },
  });

  const payload = JSON.parse(geminiResponse.body);
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

  return {
    text: String(responseText).trim(),
    fallback_notice: geminiResponse.usedFallback ? GEMINI_FALLBACK_NOTICE : '',
  };
}

function fetchGeminiWithFallback(apiKey, payload) {
  const primaryResponse = fetchGemini(apiKey, GEMINI_MODEL, payload);

  if (isSuccessfulGeminiResponse(primaryResponse.statusCode)) {
    return { body: primaryResponse.body, usedFallback: false };
  }

  if (shouldFallbackGemini(primaryResponse.statusCode)) {
    const fallbackResponse = fetchGemini(
      apiKey,
      GEMINI_FALLBACK_MODEL,
      withoutThinkingLevel(payload),
    );

    if (isSuccessfulGeminiResponse(fallbackResponse.statusCode)) {
      return { body: fallbackResponse.body, usedFallback: true };
    }

    throw new Error('Gemini API の呼び出しに失敗しました。status=' + fallbackResponse.statusCode);
  }

  throw new Error('Gemini API の呼び出しに失敗しました。status=' + primaryResponse.statusCode);
}

function fetchGemini(apiKey, model, payload) {
  const response = UrlFetchApp.fetch(
    'https://generativelanguage.googleapis.com/v1beta/models/' + model + ':generateContent?key=' + encodeURIComponent(apiKey),
    {
      method: 'post',
      contentType: 'application/json',
      muteHttpExceptions: true,
      payload: JSON.stringify(payload),
    },
  );

  return {
    statusCode: response.getResponseCode(),
    body: response.getContentText(),
  };
}

function isSuccessfulGeminiResponse(statusCode) {
  return statusCode >= 200 && statusCode < 300;
}

function shouldFallbackGemini(statusCode) {
  return statusCode === 429 || statusCode === 503 || statusCode === 504;
}

function withoutThinkingLevel(payload) {
  const fallbackPayload = JSON.parse(JSON.stringify(payload));

  if (fallbackPayload.generationConfig) {
    delete fallbackPayload.generationConfig.thinkingConfig;
  }

  return fallbackPayload;
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

function readFoodLogsFromSheet(sheet) {
  const lastRow = sheet.getLastRow();

  if (lastRow < 2) {
    return [];
  }

  return sheet
    .getRange(2, 1, lastRow - 1, FOOD_LOG_HEADERS.length)
    .getValues()
    .map(function (row) { return rowToFoodLog(row); })
    .filter(function (meal) { return meal.id; });
}

function readFavoritesFromSheet(sheet) {
  const lastRow = sheet.getLastRow();

  if (lastRow < 2) {
    return [];
  }

  return sheet
    .getRange(2, 1, lastRow - 1, FAVORITE_HEADERS.length)
    .getValues()
    .map(function (row) { return rowToFavorite(row); })
    .filter(function (favorite) { return favorite.id; });
}

function isMealOnDateUntil(meal, date, now, timezone) {
  const timestamp = new Date(meal.timestamp);

  return !isNaN(timestamp.getTime()) && timestamp.getTime() <= now.getTime() &&
    Utilities.formatDate(timestamp, timezone, 'yyyy-MM-dd') === date;
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

  const lastColumn = sheet.getLastColumn();
  const headers = sheet.getRange(1, 1, 1, lastColumn).getValues()[0].map(function (header) {
    return String(header || '').trim();
  });
  const weightColumnIndex = headers.indexOf('weight_kg');

  if (weightColumnIndex === -1) {
    return result;
  }

  const values = sheet.getRange(2, 1, sheet.getLastRow() - 1, lastColumn).getValues();
  values.forEach(function (row) {
    const date = formatSheetDate(row[0]);
    const rawWeight = row[weightColumnIndex];
    const weight = normalizeHealthWeight(rawWeight);

    if (date >= windowStart && date <= windowEnd && weight !== null) {
      result[date] = weight;
    }
  });

  return result;
}

function normalizeHealthWeight(value) {
  if (value === '') {
    return null;
  }

  const weight = Number(value);

  if (!isFinite(weight) || weight < MIN_VALID_WEIGHT_KG || weight > MAX_VALID_WEIGHT_KG) {
    return null;
  }

  return weight;
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

function createEmptyGoals() {
  return {
    calories_kcal: null,
    protein_g: null,
    fat_g: null,
    carbs_g: null,
    target_weight_kg: null,
  };
}

function nutritionGoalsFromHealthGoals(goals) {
  return {
    calories_kcal: goals.calories_kcal,
    protein_g: goals.protein_g,
    fat_g: goals.fat_g,
    carbs_g: goals.carbs_g,
  };
}

function readGoalsFromSheet(sheet) {
  const goals = createEmptyGoals();
  const lastRow = sheet.getLastRow();

  if (lastRow < 2) {
    return goals;
  }

  const values = sheet.getRange(2, 1, lastRow - 1, 2).getValues();
  values.forEach(function (row) {
    const key = String(row[0] || '').trim();

    if (TARGET_KEYS.indexOf(key) !== -1 && row[1] !== '') {
      goals[key] = toNonNegativeNumber(row[1], key);
    }

    if (key === 'target_weight_kg' && row[1] !== '') {
      goals.target_weight_kg = toBoundedWeight(row[1], '目標体重');
    }
  });

  return goals;
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

function validateGoals(data) {
  if (!data || typeof data !== 'object') {
    throw new Error('目標データが不正です。');
  }

  return {
    calories_kcal: toNullableNonNegativeNumber(data.calories_kcal, '目標カロリー'),
    protein_g: toNullableNonNegativeNumber(data.protein_g, '目標タンパク質'),
    fat_g: toNullableNonNegativeNumber(data.fat_g, '目標脂質'),
    carbs_g: toNullableNonNegativeNumber(data.carbs_g, '目標炭水化物'),
    target_weight_kg: toNullableBoundedWeight(data.target_weight_kg, '目標体重'),
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

function toNullableNonNegativeNumber(value, label) {
  if (value === null || value === '') {
    return null;
  }

  return toNonNegativeNumber(value, label);
}

function toNullableBoundedWeight(value, label) {
  if (value === null || value === '') {
    return null;
  }

  return toBoundedWeight(value, label);
}

function toBoundedWeight(value, label) {
  const numberValue = Number(value);

  if (!isFinite(numberValue) || numberValue < MIN_VALID_WEIGHT_KG || numberValue > MAX_VALID_WEIGHT_KG) {
    throw new Error(label + 'は20〜300kgの数値で入力してください。');
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

// API呼び出しはクライアント引数を信頼しない。画像形式・サイズはサーバーでバイト列から判定する。
function getTrustedImageInfo(imageBase64) {
  const normalized = stripDataUrlPrefix(imageBase64).replace(/\s/g, '');
  if (!normalized || Math.floor((normalized.length * 3) / 4) > MAX_AI_IMAGE_BYTES) {
    return null;
  }
  try {
    return openAiImageInfoFromBytes(Utilities.base64Decode(normalized));
  } catch (error) {
    return null;
  }
}
