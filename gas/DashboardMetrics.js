var DASHBOARD_JST_OFFSET_MS = 9 * 60 * 60 * 1000;
var DASHBOARD_DAY_MS = 24 * 60 * 60 * 1000;
var DASHBOARD_MAIN_MEAL_TYPES = ['朝', '昼', '夜'];
var DASHBOARD_VALID_RANGE_DAYS = [7, 30, 90];

function getDashboardPeriod(rangeDays, now) {
  assertDashboardRangeDays(rangeDays);
  var windowEnd = dashboardToDateKey(now);

  if (!windowEnd) {
    throw new RangeError('有効な基準日が必要です');
  }

  return {
    window_start: dashboardAddCalendarDays(windowEnd, 1 - rangeDays),
    window_end: windowEnd,
  };
}

function buildDashboardData(input) {
  var period = getDashboardPeriod(input.rangeDays, input.now || new Date());
  var nowDetails = dashboardDateInputDetails(input.now || new Date());
  var dates = dashboardEnumerateDateKeys(period.window_start, period.window_end);
  var healthColumnIndexes = createDashboardHealthColumnIndexes(input.healthHeaders);
  var accumulators = {};

  dates.forEach(function (date) {
    accumulators[date] = createDashboardDayAccumulator();
  });

  (input.foodLogs || []).forEach(function (row) {
    var food = readDashboardFoodRecord(row);

    if (
      !food.date ||
      !Object.prototype.hasOwnProperty.call(accumulators, food.date) ||
      (nowDetails.epochMs !== null && food.timestamp !== null && food.timestamp > nowDetails.epochMs)
    ) {
      return;
    }

    var day = accumulators[food.date];
    day.mealCount += 1;

    if (DASHBOARD_MAIN_MEAL_TYPES.indexOf(food.mealType) !== -1) {
      day.mealTypes[food.mealType] = true;
    }

    day.intake.calories += food.calories;
    day.intake.protein += food.protein;
    day.intake.fat += food.fat;
    day.intake.carbs += food.carbs;
  });

  (input.healthRows || []).forEach(function (row) {
    var health = readDashboardHealthRecord(row, healthColumnIndexes);

    if (!health.date || !Object.prototype.hasOwnProperty.call(accumulators, health.date)) {
      return;
    }

    mergeDashboardHealthRecord(accumulators[health.date].health, health);
  });

  var days = dates.map(function (date, index) {
    var accumulator = accumulators[date];
    var coverage = createDashboardMealCoverage(accumulator.mealTypes);
    var expenditure = accumulator.health.expenditure;

    return {
      date: date,
      intake: {
        calories_kcal: accumulator.intake.calories,
        protein_g: accumulator.intake.protein,
        fat_g: accumulator.intake.fat,
        carbs_g: accumulator.intake.carbs,
      },
      meal_count: accumulator.mealCount,
      coverage: coverage,
      weight_kg: accumulator.health.weight,
      weight_trend_kg: calculateDashboardWeightTrend(dates, accumulators, index),
      body_fat_pct: accumulator.health.bodyFat,
      steps: accumulator.health.steps,
      expenditure_kcal: expenditure,
      energy_balance_kcal: coverage.adequate && expenditure !== null
        ? accumulator.intake.calories - expenditure
        : null,
    };
  });

  return {
    range_days: input.rangeDays,
    window_start: period.window_start,
    window_end: period.window_end,
    goals: readDashboardTargets(input.targets || []),
    confidence: calculateDashboardConfidence(days, input.rangeDays),
    summary: calculateDashboardSummary(days, input.rangeDays),
    days: days,
  };
}

function calculateDashboardWeightTrend(dates, accumulators, index) {
  var start = Math.max(0, index - 6);
  var weights = [];

  for (var cursor = start; cursor <= index; cursor += 1) {
    var weight = accumulators[dates[cursor]].health.weight;
    if (weight !== null) {
      weights.push(weight);
    }
  }

  return weights.length >= 3 ? dashboardAverage(weights) : null;
}

function calculateDashboardConfidence(days, rangeDays) {
  var adequateDays = days.filter(function (day) { return day.coverage.adequate; }).length;
  var weightObservations = days.filter(function (day) { return day.weight_kg !== null; }).length;
  var activityObservations = days.filter(function (day) {
    return day.steps !== null || day.expenditure_kcal !== null;
  }).length;

  return {
    nutrition: dashboardConfidenceForRatio(adequateDays / rangeDays),
    weight: dashboardConfidenceForRatio((weightObservations * 7) / rangeDays, 3, 1),
    activity: dashboardConfidenceForRatio(activityObservations / rangeDays),
  };
}

function calculateDashboardSummary(days, rangeDays) {
  var loggingDays = days.filter(function (day) { return day.meal_count > 0; });
  var adequateDays = days.filter(function (day) { return day.coverage.adequate; });
  var trendDays = days.filter(function (day) { return day.weight_trend_kg !== null; });
  var validSteps = days
    .filter(function (day) { return day.steps !== null; })
    .map(function (day) { return day.steps; });
  var firstTrend = trendDays.length > 0 ? trendDays[0].weight_trend_kg : null;
  var lastTrend = trendDays.length > 0 ? trendDays[trendDays.length - 1].weight_trend_kg : null;

  return {
    logging_days: loggingDays.length,
    adequate_days: adequateDays.length,
    recording_coverage_ratio: dashboardRound(
      days.reduce(function (total, day) { return total + day.coverage.ratio; }, 0) / rangeDays,
    ),
    average_intake_kcal: dashboardAverageOrNull(loggingDays.map(function (day) { return day.intake.calories_kcal; })),
    average_protein_g: dashboardAverageOrNull(loggingDays.map(function (day) { return day.intake.protein_g; })),
    average_steps: dashboardAverageOrNull(validSteps),
    latest_weight_trend_kg: lastTrend,
    weight_change_kg: rangeDays >= 7 && firstTrend !== null && lastTrend !== null && trendDays.length >= 2
      ? dashboardRound(lastTrend - firstTrend)
      : null,
  };
}

function createDashboardDayAccumulator() {
  return {
    intake: { calories: 0, protein: 0, fat: 0, carbs: 0 },
    mealTypes: {},
    mealCount: 0,
    health: { steps: null, expenditure: null, weight: null, bodyFat: null },
  };
}

function readDashboardFoodRecord(row) {
  var timestampValue = dashboardValueAt(row, 1, 'timestamp');
  return {
    date: dashboardToDateKey(timestampValue),
    timestamp: dashboardToTimestamp(timestampValue),
    mealType: String(dashboardValueAt(row, 2, 'meal_type') || ''),
    calories: dashboardToNumber(dashboardValueAt(row, 4, 'calories_kcal')) || 0,
    protein: dashboardToNumber(dashboardValueAt(row, 5, 'protein_g')) || 0,
    fat: dashboardToNumber(dashboardValueAt(row, 6, 'fat_g')) || 0,
    carbs: dashboardToNumber(dashboardValueAt(row, 7, 'carbs_g')) || 0,
  };
}

function readDashboardHealthRecord(row, columnIndexes) {
  var valueAt = function (key) {
    if (Array.isArray(row)) {
      var index = columnIndexes[key];
      return index === undefined ? undefined : row[index];
    }
    return row && row[key];
  };
  var stepsValue = valueAt('steps');
  var expenditureValue = valueAt('total_calories_kcal');
  var weightValue = valueAt('weight_kg');
  var bodyFatValue = valueAt('body_fat_pct');

  return {
    date: dashboardToDateKey(valueAt('date')),
    steps: dashboardNonNegativeNumber(stepsValue),
    expenditure: dashboardNonNegativeNumber(expenditureValue),
    weight: dashboardBoundedNumber(weightValue, 20, 300),
    bodyFat: dashboardBoundedNumber(bodyFatValue, 0, 100),
    present: {
      steps: dashboardHasExplicitValue(stepsValue),
      expenditure: dashboardHasExplicitValue(expenditureValue),
      weight: dashboardHasExplicitValue(weightValue),
      bodyFat: dashboardHasExplicitValue(bodyFatValue),
    },
  };
}

function createDashboardHealthColumnIndexes(headers) {
  var indexes = {};

  (headers || []).forEach(function (header, index) {
    var key = String(header || '').trim();
    if (key) {
      indexes[key] = index;
    }
  });

  return indexes;
}

function mergeDashboardHealthRecord(target, row) {
  ['steps', 'expenditure', 'weight', 'bodyFat'].forEach(function (field) {
    if (row.present[field]) {
      target[field] = row[field];
    }
  });
}

function dashboardHasExplicitValue(value) {
  return value !== '' && value !== null && value !== undefined;
}

function createDashboardMealCoverage(mealTypes) {
  var logged = DASHBOARD_MAIN_MEAL_TYPES.filter(function (mealType) {
    return mealTypes[mealType] === true;
  });

  return {
    logged_main_meal_types: logged,
    ratio: logged.length / DASHBOARD_MAIN_MEAL_TYPES.length,
    adequate: logged.length >= 2,
  };
}

function readDashboardTargets(rows) {
  var goals = {
    calories_kcal: null,
    protein_g: null,
    fat_g: null,
    carbs_g: null,
    target_weight_kg: null,
  };

  rows.forEach(function (row) {
    var key = String(dashboardValueAt(row, 0, 'key') || '');
    var value = dashboardValueAt(row, 1, 'value');

    if (key === 'target_weight_kg') {
      goals.target_weight_kg = dashboardBoundedNumber(value, 20, 300);
    } else if (Object.prototype.hasOwnProperty.call(goals, key)) {
      goals[key] = dashboardNonNegativeNumber(value);
    }
  });

  return goals;
}

function dashboardValueAt(row, index, key) {
  return Array.isArray(row) ? row[index] : row && row[key];
}

function dashboardToDateKey(value) {
  if (typeof value === 'string') {
    var trimmed = value.trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
      return dashboardIsValidDateKey(trimmed) ? trimmed : null;
    }
    var timestamp = dashboardParseTimestamp(trimmed);
    return timestamp === null ? null : dashboardEpochToJstDateKey(timestamp);
  }

  if (value instanceof Date) {
    return isNaN(value.getTime()) ? null : dashboardEpochToJstDateKey(value.getTime());
  }

  if (typeof value === 'number' && isFinite(value)) {
    return dashboardEpochToJstDateKey(value);
  }

  return null;
}

function dashboardToTimestamp(value) {
  if (typeof value === 'string') {
    var trimmed = value.trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
      return null;
    }
    return dashboardParseTimestamp(trimmed);
  }

  if (value instanceof Date) {
    return isNaN(value.getTime()) ? null : value.getTime();
  }

  return typeof value === 'number' && isFinite(value) ? value : null;
}

function dashboardDateInputDetails(value) {
  return { epochMs: dashboardToTimestamp(value) };
}

function dashboardParseTimestamp(value) {
  var hasTimeZone = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(value);
  var normalized = hasTimeZone ? value : value + '+09:00';
  var timestamp = Date.parse(normalized);
  return isNaN(timestamp) ? null : timestamp;
}

function dashboardEpochToJstDateKey(epochMs) {
  return new Date(epochMs + DASHBOARD_JST_OFFSET_MS).toISOString().slice(0, 10);
}

function dashboardIsValidDateKey(date) {
  var epoch = Date.parse(date + 'T00:00:00Z');
  return !isNaN(epoch) && new Date(epoch).toISOString().slice(0, 10) === date;
}

function dashboardAddCalendarDays(date, amount) {
  return new Date(Date.parse(date + 'T00:00:00Z') + amount * DASHBOARD_DAY_MS)
    .toISOString()
    .slice(0, 10);
}

function dashboardEnumerateDateKeys(start, end) {
  var dates = [];
  for (var cursor = start; cursor <= end; cursor = dashboardAddCalendarDays(cursor, 1)) {
    dates.push(cursor);
  }
  return dates;
}

function assertDashboardRangeDays(rangeDays) {
  if (DASHBOARD_VALID_RANGE_DAYS.indexOf(rangeDays) === -1) {
    throw new RangeError('期間は7、30、90日のいずれかです');
  }
}

function dashboardToNumber(value) {
  if (value === '' || value === null || value === undefined) {
    return null;
  }
  var number = typeof value === 'number' ? value : Number(value);
  return isFinite(number) ? number : null;
}

function dashboardNonNegativeNumber(value) {
  var number = dashboardToNumber(value);
  return number !== null && number >= 0 ? number : null;
}

function dashboardBoundedNumber(value, minimum, maximum) {
  var number = dashboardToNumber(value);
  return number !== null && number >= minimum && number <= maximum ? number : null;
}

function dashboardConfidenceForRatio(ratio, highThreshold, mediumThreshold) {
  highThreshold = highThreshold === undefined ? 0.7 : highThreshold;
  mediumThreshold = mediumThreshold === undefined ? 0.4 : mediumThreshold;

  if (ratio >= highThreshold) return 'high';
  if (ratio >= mediumThreshold) return 'medium';
  return 'low';
}

function dashboardAverage(values) {
  return values.reduce(function (total, value) { return total + value; }, 0) / values.length;
}

function dashboardAverageOrNull(values) {
  return values.length === 0 ? null : dashboardRound(dashboardAverage(values));
}

function dashboardRound(value) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

if (typeof module !== 'undefined') {
  module.exports = {
    buildDashboardData: buildDashboardData,
    getDashboardPeriod: getDashboardPeriod,
    calculateDashboardWeightTrend: calculateDashboardWeightTrend,
    calculateDashboardConfidence: calculateDashboardConfidence,
    calculateDashboardSummary: calculateDashboardSummary,
  };
}
