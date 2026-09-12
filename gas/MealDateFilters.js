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

if (typeof module !== 'undefined') {
  module.exports = {
    mealTimestampMs: mealTimestampMs,
    isMealOnDateValue: isMealOnDateValue,
    isMealOnDateUntilValue: isMealOnDateUntilValue,
    sortMealsByTimestampDescending: sortMealsByTimestampDescending,
    isValidDateKey: isValidDateKey,
    isDateKeyNotAfter: isDateKeyNotAfter,
  };
}
