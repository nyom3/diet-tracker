function mealTimestampMs(meal) {
  var timestamp = new Date(meal && meal.timestamp).getTime();
  return isFinite(timestamp) ? timestamp : null;
}

function isMealOnDateValue(meal, date, dateKeyForTimestamp) {
  var timestamp = mealTimestampMs(meal);
  return timestamp !== null && dateKeyForTimestamp(timestamp) === date;
}

function isMealOnDateUntilValue(meal, date, nowMs, dateKeyForTimestamp) {
  var timestamp = mealTimestampMs(meal);
  return timestamp !== null && timestamp <= nowMs && dateKeyForTimestamp(timestamp) === date;
}

function sortMealsByTimestampDescending(meals) {
  return meals.slice().sort(function (a, b) {
    var aTimestamp = mealTimestampMs(a);
    var bTimestamp = mealTimestampMs(b);
    return (bTimestamp === null ? -Infinity : bTimestamp) - (aTimestamp === null ? -Infinity : aTimestamp);
  });
}

function isValidDateKey(date) {
  if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return false;
  }

  var parts = date.split('-').map(Number);
  var parsed = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2]));
  return parsed.getUTCFullYear() === parts[0] &&
    parsed.getUTCMonth() === parts[1] - 1 &&
    parsed.getUTCDate() === parts[2];
}

function isDateKeyNotAfter(date, latestDate) {
  return isValidDateKey(date) && isValidDateKey(latestDate) && date <= latestDate;
}

function resolveFoodLogReadRange(lastRow, attempt, options) {
  var totalRows = Math.max(0, Math.floor(Number(lastRow) || 0) - 1);
  var config = options || {};
  var initialRows = Math.max(1, Math.floor(Number(config.initialRows) || 500));
  var growthFactor = Math.max(2, Math.floor(Number(config.growthFactor) || 4));
  var attemptIndex = Math.max(0, Math.floor(Number(attempt) || 0));
  var requestedRows = initialRows * Math.pow(growthFactor, attemptIndex);
  var rowCount = Math.min(totalRows, requestedRows);

  return {
    startRow: rowCount > 0 ? Math.floor(lastRow) - rowCount + 1 : 2,
    rowCount: rowCount,
    isFull: rowCount === totalRows,
  };
}

function countRecentMealsForReadValue(meals, nowMs, today, dateKeyForTimestamp, limit) {
  var maxCount = Math.max(0, Math.floor(Number(limit) || 0));

  if (maxCount === 0) {
    return 0;
  }

  return meals.filter(function (meal) {
    var timestamp = mealTimestampMs(meal);
    return timestamp !== null && timestamp <= nowMs && dateKeyForTimestamp(timestamp) !== today;
  }).length;
}

if (typeof module !== 'undefined') {
  module.exports = {
    mealTimestampMs: mealTimestampMs,
    isMealOnDateValue: isMealOnDateValue,
    isMealOnDateUntilValue: isMealOnDateUntilValue,
    sortMealsByTimestampDescending: sortMealsByTimestampDescending,
    isValidDateKey: isValidDateKey,
    isDateKeyNotAfter: isDateKeyNotAfter,
    resolveFoodLogReadRange: resolveFoodLogReadRange,
    countRecentMealsForReadValue: countRecentMealsForReadValue,
  };
}
