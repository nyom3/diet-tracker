/*
 * Today feedback context is intentionally a GAS/Node shared plain-JS module.
 * The main-meal list is kept here instead of CoachRules.js because feedback
 * generation and trend coaching have separate scope boundaries.
 */
var FEEDBACK_TARGET_KEYS = ['calories_kcal', 'protein_g', 'fat_g', 'carbs_g'];
var FEEDBACK_MAIN_MEALS = ['朝', '昼', '夜'];

function feedbackNumber(value) {
  return typeof value === 'number' && isFinite(value) ? value : 0;
}

function feedbackRound(value) {
  return Math.round((value + Number.EPSILON) * 10) / 10;
}

function addFeedbackMealTotal(total, meal) {
  FEEDBACK_TARGET_KEYS.forEach(function (key) {
    var nextValue = total[key] + feedbackNumber(meal && meal[key]);
    total[key] = key === 'calories_kcal' ? Math.round(nextValue) : feedbackRound(nextValue);
  });
  return total;
}

function buildTodayFeedbackContext(meals, goals, evaluationTime) {
  var safeMeals = Array.isArray(meals) ? meals : [];
  var safeGoals = goals || {};
  var total = {
    calories_kcal: 0,
    protein_g: 0,
    fat_g: 0,
    carbs_g: 0,
  };
  var mealTypes = [];
  var mealLines = [];

  safeMeals.forEach(function (meal) {
    addFeedbackMealTotal(total, meal);
    var mealType = String((meal && meal.meal_type) || '').trim();
    if (mealType && mealTypes.indexOf(mealType) === -1) {
      mealTypes.push(mealType);
    }
    mealLines.push([
      mealType,
      String((meal && meal.description) || ''),
      Math.round(feedbackNumber(meal && meal.calories_kcal)) + 'kcal',
      'P' + feedbackNumber(meal && meal.protein_g) + 'g',
      'F' + feedbackNumber(meal && meal.fat_g) + 'g',
      'C' + feedbackNumber(meal && meal.carbs_g) + 'g',
    ].join(' / '));
  });

  var mainMealTypes = FEEDBACK_MAIN_MEALS.filter(function (mealType) {
    return mealTypes.indexOf(mealType) !== -1;
  });
  var targetLines = FEEDBACK_TARGET_KEYS.map(function (key) {
    var targetValue = safeGoals[key];
    if (targetValue == null) {
      return key + ': 目標未設定';
    }

    var normalizedTarget = feedbackNumber(targetValue);
    return key + ': 合計 ' + feedbackRound(total[key]) + ' / 目標 ' + normalizedTarget + ' / 差分 ' + feedbackRound(normalizedTarget - total[key]);
  });

  return {
    evaluation_time: String(evaluationTime || ''),
    total: total,
    meal_types: mealTypes,
    main_meal_types: mainMealTypes,
    main_meal_count: mainMealTypes.length,
    target_lines: targetLines,
    meal_lines: mealLines,
    is_main_meals_complete: mainMealTypes.length === FEEDBACK_MAIN_MEALS.length,
  };
}

function buildTodayFeedbackPrompt(context) {
  var outputGuidance = context.is_main_meals_complete
    ? '朝・昼・夜がそろっているため、今日の締めの講評と明日への一手を主に書いてください。'
    : '朝・昼・夜のうち未記録の食事があるため、目標との差分（残り予算）を踏まえた次の一食の配分を主に書いてください。';
  var total = context.total;

  return (
    'あなたは食事記録を見て短く実用的にコメントする栄養士です。\n' +
    'できている点を先に1つ挙げてから改善点に触れてください。記録を続けていること自体を評価しても構いません。\n' +
    '評価時点までの今日の食事だけを対象に、日本語で3文以内にまとめてください。\n' +
    outputGuidance + '\n' +
    '断定しすぎず、医療助言ではなく一般的な食事コメントとして書いてください。\n\n' +
    '評価時点: ' + context.evaluation_time + '\n' +
    '記録済み食事タイプ: ' + (context.meal_types.length ? context.meal_types.join('、') : 'なし') + '\n' +
    '主要3食の記録数: ' + context.main_meal_count + ' / 3\n' +
    '合計: ' +
    Math.round(total.calories_kcal) +
    'kcal / P' +
    total.protein_g +
    'g / F' +
    total.fat_g +
    'g / C' +
    total.carbs_g +
    'g\n' +
    '差分は正数が残り、負数が目標超過を表します。\n' +
    '目標差分（残り予算）:\n- ' +
    context.target_lines.join('\n- ') +
    '\n食事:\n- ' +
    context.meal_lines.join('\n- ')
  );
}

if (typeof module !== 'undefined') {
  module.exports = {
    buildTodayFeedbackContext: buildTodayFeedbackContext,
    buildTodayFeedbackPrompt: buildTodayFeedbackPrompt,
  };
}
