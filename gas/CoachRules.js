var COACH_PRIORITY = [
  'data_quality',
  'today_next_meal',
  'weight_trend',
  'energy_pattern',
  'protein',
  'activity',
  'progress',
];
var COACH_CONFIDENCE_RANK = { low: 0, medium: 1, high: 2 };
var COACH_MAIN_MEALS = ['朝', '昼', '夜'];
var COACH_MACROS = [
  { key: 'protein_g', label: 'タンパク質', unit: 'g' },
  { key: 'fat_g', label: '脂質', unit: 'g' },
  { key: 'carbs_g', label: '炭水化物', unit: 'g' },
];

/*
 * CoachRules is intentionally a GAS/Node shared plain-JS module.
 * DashboardMetrics.js is loaded before this file in GAS and in the Node VM
 * tests, so confidence calculation stays in one source of truth.
 */
function buildCoachEvidence(scope, days, goals, today) {
  var context = createCoachContext(scope, days, goals, today);
  var builders = {
    data_quality: buildCoachDataQualityEvidence,
    today_next_meal: buildCoachTodayNextMealEvidence,
    weight_trend: buildCoachWeightTrendEvidence,
    energy_pattern: buildCoachEnergyPatternEvidence,
    protein: buildCoachProteinEvidence,
    activity: buildCoachActivityEvidence,
    progress: buildCoachProgressEvidence,
  };
  var allowed = scope === 'today' ? ['data_quality', 'today_next_meal'] : COACH_PRIORITY;

  return allowed.map(function (type) {
    return builders[type](context);
  }).filter(function (suggestion) {
    return suggestion !== null;
  });
}

function buildCoachActionCandidates(days, goals, today) {
  var context = createCoachContext('today', days, goals, today);
  var candidates = [];
  var targetDate = coachAddDays(context.date, 1);

  candidates.push({
    key: 'logging',
    category: 'logging',
    text: '明日は朝・昼・夜のうち2食以上を記録する',
    target_date: targetDate,
  });

  if (context.goals.calories_kcal !== null && context.today.intake.calories_kcal !== null) {
    var remainingCalories = context.goals.calories_kcal - context.today.intake.calories_kcal;
    if (remainingCalories > 0) {
      candidates.push({
        key: 'energy',
        category: 'energy',
        text: '次の一食を選ぶ前に残り' + coachRound(remainingCalories) + 'kcalを確認する',
        target_date: targetDate,
      });
    }
  }

  if (context.goals.protein_g !== null && context.today.intake.protein_g !== null
    && context.today.intake.protein_g < context.goals.protein_g) {
    candidates.push({
      key: 'protein',
      category: 'protein',
      text: '次の一食にタンパク質源を1品追加する',
      target_date: targetDate,
    });
  }

  var macroGap = findCoachLargestMacroGap(context.today.intake, context.goals);
  if (macroGap !== null) {
    candidates.push({
      key: 'macro_balance',
      category: 'macro_balance',
      text: '次の一食で' + macroGap.label + 'を優先する',
      target_date: targetDate,
    });
  }

  var recentActivity = getCoachRecentActivity(context.days);
  if (recentActivity.observedDays >= 5) {
    var activityTarget = Math.min(recentActivity.average + 1000, recentActivity.maximum);
    candidates.push({
      key: 'activity',
      category: 'activity',
      text: '明日は' + coachRound(activityTarget) + '歩を目安にする',
      target_date: targetDate,
    });
  }

  return candidates;
}

function buildCoachCandidatePairs(evidenceSuggestions, actionCandidates) {
  var actionsByKey = {};
  (actionCandidates || []).forEach(function (action) {
    if (action && typeof action.key === 'string') {
      actionsByKey[action.key] = action;
    }
  });

  return (evidenceSuggestions || []).map(function (suggestion) {
    var actionKey = actionKeyForCoachEvidence(suggestion.type, actionsByKey);
    var action = actionsByKey[actionKey];
    if (!suggestion || !action || !suggestion.evidence || suggestion.evidence.length === 0) {
      return null;
    }
    return {
      evidence_key: suggestion.evidence[0].key,
      action_key: action.key,
      evidence: suggestion.evidence,
      action: action,
      confidence: suggestion.confidence,
      type: suggestion.type,
    };
  }).filter(function (pair) {
    return pair !== null;
  }).slice(0, 3);
}

function validateCoachAiResponse(candidates, aiResponse, outContext) {
  if (!Array.isArray(candidates) || candidates.length === 0) {
    return rejectCoachAiResponse(outContext, 'empty_candidates');
  }
  if (!aiResponse || typeof aiResponse !== 'object') {
    return rejectCoachAiResponse(outContext, 'response_not_object');
  }
  var allowedKeys = ['headline', 'summary', 'evidence_key', 'evidenceKey', 'action_key', 'actionKey'];
  if (Object.keys(aiResponse).some(function (key) { return allowedKeys.indexOf(key) === -1; })) {
    return rejectCoachAiResponse(outContext, 'unknown_keys');
  }

  var evidenceKey = coachResponseKey(aiResponse, 'evidence_key', 'evidenceKey');
  var actionKey = coachResponseKey(aiResponse, 'action_key', 'actionKey');
  if (!evidenceKey || !actionKey) {
    return rejectCoachAiResponse(outContext, 'missing_selection');
  }

  var matchingCandidate = candidates.some(function (candidate) {
    var candidateEvidenceKey = coachResponseKey(candidate, 'evidence_key', 'evidenceKey');
    var candidateActionKey = coachResponseKey(candidate, 'action_key', 'actionKey');
    if ((!candidateEvidenceKey || !candidateActionKey) && candidate) {
      candidateEvidenceKey = candidate.evidence && candidate.evidence.key;
      candidateActionKey = candidate.action && candidate.action.key;
    }
    return candidateEvidenceKey === evidenceKey && candidateActionKey === actionKey;
  });
  if (!matchingCandidate) {
    return rejectCoachAiResponse(outContext, 'candidate_mismatch');
  }

  if (typeof aiResponse.headline !== 'string' || aiResponse.headline.length > 40) {
    return rejectCoachAiResponse(outContext, 'headline_invalid');
  }
  if (typeof aiResponse.summary !== 'string' || aiResponse.summary.length > 160) {
    return rejectCoachAiResponse(outContext, 'summary_length_invalid');
  }
  if (aiResponse.summary === '' || /[0-9０-９]/.test(aiResponse.summary)) {
    return rejectCoachAiResponse(outContext, 'summary_empty_or_numeric');
  }

  return {
    headline: aiResponse.headline,
    summary: aiResponse.summary,
    evidence_key: evidenceKey,
    action_key: actionKey,
  };
}

function rejectCoachAiResponse(outContext, reason) {
  if (outContext && typeof outContext === 'object') {
    outContext.reject_reason = reason;
  }
  return null;
}

function buildCoachInsight(scope, days, goals, today) {
  var context = createCoachContext(scope, days, goals, today);
  var suggestions = buildCoachEvidence(scope, days, goals, today);
  var actions = buildCoachActionCandidates(days, goals, today);
  var pairs = buildCoachCandidatePairs(suggestions, actions);
  var selectedPair = pairs.length > 0 ? pairs[0] : null;
  var alternativePair = pairs.length > 1 ? pairs[1] : null;
  var selectedSuggestion = selectedPair ? suggestions.filter(function (suggestion) {
    return suggestion.type === selectedPair.type;
  })[0] : null;

  return {
    generated_at: context.date + 'T00:00:00.000+09:00',
    scope: scope === 'trend' ? 'trend' : 'today',
    source: 'rules',
    headline: coachHeadline(selectedPair && selectedPair.type),
    summary: coachSummary(selectedPair && selectedPair.type),
    confidence: selectedPair ? selectedPair.confidence : 'low',
    evidence: selectedSuggestion ? selectedSuggestion.evidence : [],
    selected_action: selectedPair ? selectedPair.action : null,
    alternative_action: alternativePair ? alternativePair.action : null,
  };
}

function createCoachContext(scope, days, goals, today) {
  var normalizedDays = (Array.isArray(days) ? days : []).map(normalizeCoachDay).filter(function (day) {
    return day !== null;
  }).sort(function (left, right) {
    return left.date < right.date ? -1 : left.date > right.date ? 1 : 0;
  });
  var normalizedToday = normalizeCoachDay(today);
  if (!normalizedToday && normalizedDays.length > 0) {
    normalizedToday = normalizedDays[normalizedDays.length - 1];
  }
  if (!normalizedToday) {
    normalizedToday = normalizeCoachDay({ date: '1970-01-01' });
  }

  var rangeDays = normalizedDays.length || 1;
  return {
    scope: scope === 'trend' ? 'trend' : 'today',
    days: normalizedDays,
    today: normalizedToday,
    goals: normalizeCoachGoals(goals),
    date: normalizedToday.date,
    confidence: calculateDashboardConfidence(normalizedDays, rangeDays),
    rangeStart: normalizedDays.length > 0 ? normalizedDays[0].date : normalizedToday.date,
    rangeEnd: normalizedDays.length > 0 ? normalizedDays[normalizedDays.length - 1].date : normalizedToday.date,
  };
}

function buildCoachDataQualityEvidence(context) {
  if (context.scope === 'today') {
    if (context.today.coverage.adequate) {
      return null;
    }
    return coachSuggestion('data_quality', [{
      key: 'data_quality',
      label: '主な食事の記録カバレッジ',
      value: coachRound(context.today.coverage.ratio * 100),
      unit: '%',
      comparison_value: 67,
      comparison_label: '十分な記録の目安',
      period_start: context.today.date,
      period_end: context.today.date,
      confidence: context.confidence.nutrition,
    }], context.confidence.nutrition);
  }

  var evidence = [];
  if (context.confidence.nutrition === 'low') {
    evidence.push({
      key: 'data_quality',
      label: '十分に記録できた日',
      value: context.days.filter(function (day) { return day.coverage.adequate; }).length,
      unit: 'days',
      comparison_value: Math.ceil(context.days.length * 0.4),
      comparison_label: '最低限の記録日数',
      period_start: context.rangeStart,
      period_end: context.rangeEnd,
      confidence: context.confidence.nutrition,
    });
  } else if (context.confidence.weight === 'low') {
    evidence.push({
      key: 'data_quality',
      label: '体重を記録した日',
      value: context.days.filter(function (day) { return day.weight_kg !== null; }).length,
      unit: 'days',
      comparison_value: Math.ceil(context.days.length / 7),
      comparison_label: '体重傾向に必要な記録',
      period_start: context.rangeStart,
      period_end: context.rangeEnd,
      confidence: context.confidence.weight,
    });
  }
  return evidence.length > 0 ? coachSuggestion('data_quality', evidence, evidence[0].confidence) : null;
}

function buildCoachTodayNextMealEvidence(context) {
  var intake = context.today.intake;
  var gaps = [];
  COACH_MACROS.forEach(function (macro) {
    var goal = context.goals[macro.key];
    var value = intake[macro.key];
    if (goal !== null && value !== null && goal > 0 && value < goal) {
      gaps.push({
        key: macro.key,
        label: macro.label,
        unit: macro.unit,
        remaining: goal - value,
        ratio: value / goal,
      });
    }
  });

  if (gaps.length === 0 && context.goals.calories_kcal !== null
    && intake.calories_kcal !== null && intake.calories_kcal < context.goals.calories_kcal) {
    gaps.push({
      key: 'calories_kcal',
      label: 'エネルギー',
      unit: 'kcal',
      remaining: context.goals.calories_kcal - intake.calories_kcal,
      ratio: intake.calories_kcal / context.goals.calories_kcal,
    });
  }
  if (gaps.length === 0) {
    return null;
  }

  gaps.sort(function (left, right) { return left.ratio - right.ratio; });
  var gap = gaps[0];
  return coachSuggestion('today_next_meal', [{
    key: 'today_next_meal',
    label: '次の一食で優先する栄養素',
    value: coachRound(gap.remaining),
    unit: gap.unit,
    comparison_value: context.goals[gap.key],
    comparison_label: gap.label + 'の目標',
    period_start: context.today.date,
    period_end: context.today.date,
    confidence: context.confidence.nutrition,
  }], context.confidence.nutrition);
}

function buildCoachWeightTrendEvidence(context) {
  var observations = context.days.filter(function (day) { return day.weight_kg !== null; });
  if (context.days.length < 14 || observations.length < 2) {
    return null;
  }
  var first = observations[0];
  var last = observations[observations.length - 1];
  var confidence = lowestCoachConfidence([
    context.confidence.weight,
    context.confidence.nutrition,
    context.confidence.activity,
  ]);
  return coachSuggestion('weight_trend', [{
    key: 'weight_trend',
    label: '体重の期間差',
    value: coachRound(last.weight_kg - first.weight_kg),
    unit: 'kg',
    comparison_value: coachRound(first.weight_kg),
    comparison_label: '期間開始時の体重',
    period_start: first.date,
    period_end: last.date,
    confidence: confidence,
  }], confidence);
}

function buildCoachEnergyPatternEvidence(context) {
  var adequate = context.days.filter(function (day) {
    return day.coverage.adequate && day.expenditure_kcal !== null;
  });
  if (adequate.length < 2) {
    return null;
  }
  var averageIntake = coachAverage(adequate.map(function (day) { return day.intake.calories_kcal; }));
  var averageExpenditure = coachAverage(adequate.map(function (day) { return day.expenditure_kcal; }));
  var confidence = lowestCoachConfidence([context.confidence.nutrition, context.confidence.activity]);
  return coachSuggestion('energy_pattern', [{
    key: 'energy_pattern',
    label: 'adequate日の平均摂取カロリー',
    value: coachRound(averageIntake),
    unit: 'kcal',
    comparison_value: coachRound(averageExpenditure),
    comparison_label: '同日の平均消費カロリー',
    period_start: adequate[0].date,
    period_end: adequate[adequate.length - 1].date,
    confidence: confidence,
  }], confidence);
}

function buildCoachProteinEvidence(context) {
  if (context.goals.protein_g === null || context.goals.protein_g <= 0) {
    return null;
  }
  var logged = context.days.filter(function (day) { return day.meal_count > 0; });
  var deficient = logged.filter(function (day) {
    return day.intake.protein_g < context.goals.protein_g * 0.9;
  });
  if (logged.length < 2 || deficient.length < 2 || deficient.length < Math.ceil(logged.length / 2)) {
    return null;
  }
  var averageProtein = coachAverage(logged.map(function (day) { return day.intake.protein_g; }));
  return coachSuggestion('protein', [{
    key: 'protein',
    label: '平均タンパク質摂取量',
    value: coachRound(averageProtein),
    unit: 'g',
    comparison_value: coachRound(context.goals.protein_g),
    comparison_label: '1日のタンパク質目標',
    period_start: logged[0].date,
    period_end: logged[logged.length - 1].date,
    confidence: context.confidence.nutrition,
  }], context.confidence.nutrition);
}

function buildCoachActivityEvidence(context) {
  var recent = getCoachRecentActivity(context.days);
  if (recent.observedDays < 5) {
    return null;
  }
  var comparison = recent.previousAverage !== null ? recent.previousAverage : recent.maximum;
  return coachSuggestion('activity', [{
    key: 'activity',
    label: '直近7日の平均歩数',
    value: coachRound(recent.average),
    unit: 'steps',
    comparison_value: coachRound(comparison),
    comparison_label: recent.previousAverage !== null ? 'その前の期間の平均歩数' : '直近7日の最高歩数',
    period_start: recent.days[0].date,
    period_end: recent.days[recent.days.length - 1].date,
    confidence: context.confidence.activity,
  }], context.confidence.activity);
}

function buildCoachProgressEvidence(context) {
  if (context.goals.target_weight_kg === null) {
    return null;
  }
  var observations = context.days.filter(function (day) { return day.weight_kg !== null; });
  if (observations.length < 2) {
    return null;
  }
  var previous = observations[observations.length - 2];
  var latest = observations[observations.length - 1];
  var previousDistance = Math.abs(previous.weight_kg - context.goals.target_weight_kg);
  var latestDistance = Math.abs(latest.weight_kg - context.goals.target_weight_kg);
  if (latestDistance >= previousDistance) {
    return null;
  }
  var confidence = lowestCoachConfidence([context.confidence.weight, context.confidence.nutrition]);
  return coachSuggestion('progress', [{
    key: 'progress',
    label: '目標に近づいた体重',
    value: coachRound(latest.weight_kg),
    unit: 'kg',
    comparison_value: coachRound(previous.weight_kg),
    comparison_label: '前回の記録',
    period_start: previous.date,
    period_end: latest.date,
    confidence: confidence,
  }], confidence);
}

function coachSuggestion(type, evidence, confidence) {
  return { type: type, evidence: evidence, confidence: confidence };
}

function actionKeyForCoachEvidence(type, actionsByKey) {
  if (type === 'data_quality') return 'logging';
  if (type === 'today_next_meal') return actionsByKey.macro_balance ? 'macro_balance' : 'energy';
  if (type === 'weight_trend') return 'activity';
  if (type === 'energy_pattern') return 'energy';
  if (type === 'protein') return 'protein';
  if (type === 'activity') return 'activity';
  if (type === 'progress') return 'logging';
  return null;
}

function findCoachLargestMacroGap(intake, goals) {
  var gaps = COACH_MACROS.map(function (macro) {
    var goal = goals[macro.key];
    var value = intake[macro.key];
    return goal !== null && value !== null && goal > 0 && value < goal
      ? { label: macro.label, remaining: goal - value, ratio: value / goal }
      : null;
  }).filter(function (gap) { return gap !== null; });
  if (gaps.length === 0) return null;
  gaps.sort(function (left, right) { return left.ratio - right.ratio; });
  return gaps[0];
}

function getCoachRecentActivity(days) {
  var recentDays = days.slice(-7);
  var observed = recentDays.filter(function (day) { return day.steps !== null; });
  var previousDays = days.slice(Math.max(0, days.length - 14), Math.max(0, days.length - 7));
  var previousObserved = previousDays.filter(function (day) { return day.steps !== null; });
  return {
    days: recentDays,
    observedDays: observed.length,
    average: observed.length > 0 ? coachAverage(observed.map(function (day) { return day.steps; })) : 0,
    maximum: observed.length > 0 ? Math.max.apply(null, observed.map(function (day) { return day.steps; })) : 0,
    previousAverage: previousObserved.length > 0
      ? coachAverage(previousObserved.map(function (day) { return day.steps; }))
      : null,
  };
}

function normalizeCoachDay(value) {
  if (!value || typeof value !== 'object') return null;
  var date = coachDate(value.date);
  if (!date) return null;
  var intakeSource = value.intake || value.total || {};
  var coverage = value.coverage || {};
  return {
    date: date,
    intake: {
      calories_kcal: coachNumber(intakeSource.calories_kcal),
      protein_g: coachNumber(intakeSource.protein_g),
      fat_g: coachNumber(intakeSource.fat_g),
      carbs_g: coachNumber(intakeSource.carbs_g),
    },
    meal_count: coachNumber(value.meal_count) || 0,
    coverage: {
      ratio: coachNumber(coverage.ratio) || 0,
      adequate: coverage.adequate === true,
    },
    weight_kg: coachNumber(value.weight_kg),
    steps: coachNumber(value.steps),
    expenditure_kcal: coachNumber(value.expenditure_kcal),
  };
}

function normalizeCoachGoals(value) {
  var goals = value && typeof value === 'object' ? value : {};
  return {
    calories_kcal: coachNumber(goals.calories_kcal),
    protein_g: coachNumber(goals.protein_g),
    fat_g: coachNumber(goals.fat_g),
    carbs_g: coachNumber(goals.carbs_g),
    target_weight_kg: coachNumber(goals.target_weight_kg),
  };
}

function coachResponseKey(value, snake, camel) {
  if (!value || typeof value !== 'object') return null;
  var key = value[snake] !== undefined ? value[snake] : value[camel];
  return typeof key === 'string' && key.trim() ? key : null;
}

function coachHeadline(type) {
  var headlines = {
    data_quality: 'まずは記録の抜けを減らす',
    today_next_meal: '次の一食は不足分を優先する',
    weight_trend: '体重の変化をゆるやかに確認する',
    energy_pattern: '摂取と消費の傾向を確認する',
    protein: 'タンパク質を補う機会をつくる',
    activity: 'いつもの歩数を少し伸ばす',
    progress: '目標に近づいた行動を続ける',
  };
  return headlines[type] || '記録を続けると、次の案内を出せます';
}

function coachSummary(type) {
  var summaries = {
    data_quality: '主な食事の記録がそろうと、より確かな案内ができます。',
    today_next_meal: '次の一食では、今日まだ足りない栄養素を意識してみましょう。',
    weight_trend: '体重の変化は、栄養と活動の記録と合わせて傾向として見守ります。',
    energy_pattern: '記録が十分な日の摂取と消費の傾向を確認できます。',
    protein: '継続して不足している栄養素を、次の一食で補いましょう。',
    activity: '最近の歩数を基準に、無理のない範囲で少し伸ばします。',
    progress: '目標に近づいた変化を、続けられた行動として承認します。',
  };
  return summaries[type] || '食事を記録すると、進み具合に合わせた案内が表示されます。';
}

function lowestCoachConfidence(values) {
  return values.reduce(function (lowest, value) {
    return COACH_CONFIDENCE_RANK[value] < COACH_CONFIDENCE_RANK[lowest] ? value : lowest;
  }, 'high');
}

function coachAverage(values) {
  return values.reduce(function (total, value) { return total + value; }, 0) / values.length;
}

function coachNumber(value) {
  return typeof value === 'number' && isFinite(value) ? value : null;
}

function coachRound(value) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function coachDate(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;
}

function coachAddDays(date, amount) {
  var epoch = Date.parse(date + 'T00:00:00Z');
  return isNaN(epoch) ? date : new Date(epoch + amount * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

/* Friendly aliases make the pure building blocks explicit to GAS callers. */
var generateCoachEvidence = buildCoachEvidence;
var generateCoachActionCandidates = buildCoachActionCandidates;
var buildCoachActionPairs = buildCoachCandidatePairs;

if (typeof module !== 'undefined') {
  module.exports = {
    buildCoachEvidence: buildCoachEvidence,
    generateCoachEvidence: generateCoachEvidence,
    buildCoachActionCandidates: buildCoachActionCandidates,
    generateCoachActionCandidates: generateCoachActionCandidates,
    buildCoachCandidatePairs: buildCoachCandidatePairs,
    buildCoachActionPairs: buildCoachActionPairs,
    validateCoachAiResponse: validateCoachAiResponse,
    buildCoachInsight: buildCoachInsight,
  };
}
