import type { DashboardData, DashboardDay, NutritionKey } from './types';

export type TrendPoint = {
  date: string;
  value: number | null;
};

export type TrendDomain = {
  min: number;
  max: number;
};

export type PfcMetric = 'protein_g' | 'fat_g' | 'carbs_g';
export type PfcDisplayMode = 'ratio' | 'grams';

export function getPfcDisplayMode(goals: DashboardData['goals'], metric: PfcMetric): PfcDisplayMode {
  return goals[metric] === null ? 'grams' : 'ratio';
}

export function getPfcChartValue(
  day: DashboardDay,
  goals: DashboardData['goals'],
  metric: PfcMetric,
): number | null {
  const actual = day.intake[metric];
  const target = goals[metric];
  if (target === null) {
    return actual;
  }
  return target > 0 ? (actual / target) * 100 : null;
}

export function isEnergyDecisionPending(day: DashboardDay): boolean {
  return !day.coverage.adequate || day.expenditure_kcal === null;
}

export function calculateTrendDomain(values: Array<number | null>, minimumSpan = 1): TrendDomain {
  const validValues = values.filter((value): value is number => value !== null && Number.isFinite(value));
  if (validValues.length === 0) {
    return { min: 0, max: minimumSpan };
  }

  const min = Math.min(...validValues);
  const max = Math.max(...validValues);
  if (max - min >= minimumSpan) {
    const padding = (max - min) * 0.12;
    return { min: Math.max(0, min - padding), max: max + padding };
  }

  const center = (min + max) / 2;
  const halfSpan = minimumSpan / 2;
  return { min: Math.max(0, center - halfSpan), max: center + halfSpan };
}

export function splitTrendSegments(points: TrendPoint[]): TrendPoint[][] {
  const segments: TrendPoint[][] = [];
  let current: TrendPoint[] = [];

  points.forEach((point) => {
    if (point.value === null || !Number.isFinite(point.value)) {
      if (current.length > 0) {
        segments.push(current);
        current = [];
      }
      return;
    }
    current.push(point);
  });

  if (current.length > 0) {
    segments.push(current);
  }
  return segments;
}

export function normalizeSelectedDate(dates: string[], selectedDate: string): string {
  if (dates.includes(selectedDate)) {
    return selectedDate;
  }
  return dates[dates.length - 1] ?? '';
}

export function getAdjacentDate(dates: string[], selectedDate: string, amount: number): string {
  if (dates.length === 0) {
    return '';
  }
  const index = dates.indexOf(selectedDate);
  const currentIndex = index < 0 ? dates.length - 1 : index;
  const nextIndex = Math.min(dates.length - 1, Math.max(0, currentIndex + amount));
  return dates[nextIndex];
}

export function calculateRollingAverage(
  days: DashboardDay[],
  field: 'steps',
  windowSize?: number,
): TrendPoint[];
export function calculateRollingAverage(
  days: DashboardDay[],
  field: 'weight_kg',
  windowSize: number,
  minimumSamples: number,
): TrendPoint[];
export function calculateRollingAverage(
  days: DashboardDay[],
  field: 'steps' | 'weight_kg',
  windowSize = 7,
  minimumSamples = 1,
): TrendPoint[] {
  return days.map((day, index) => {
    const window = days.slice(Math.max(0, index - windowSize + 1), index + 1);
    const values = window
      .map((item) => item[field])
      .filter((value): value is number => value !== null && Number.isFinite(value));
    return {
      date: day.date,
      value: values.length >= minimumSamples ? average(values) : null,
    };
  });
}

export function buildMetricPoints(days: DashboardDay[], field: NutritionKey | 'steps' | 'weight_kg' | 'weight_trend_kg' | 'expenditure_kcal' | 'energy_balance_kcal'): TrendPoint[] {
  return days.map((day) => ({ date: day.date, value: readMetricValue(day, field) }));
}

export function formatMetricValue(value: number | null, unit: string, digits = 0): string {
  return value === null ? '—' : `${value.toFixed(digits)}${unit}`;
}

function readMetricValue(
  day: DashboardDay,
  field: NutritionKey | 'steps' | 'weight_kg' | 'weight_trend_kg' | 'expenditure_kcal' | 'energy_balance_kcal',
): number | null {
  if (field === 'calories_kcal' || field === 'protein_g' || field === 'fat_g' || field === 'carbs_g') {
    return day.intake[field];
  }
  if (field === 'steps') return day.steps;
  if (field === 'weight_kg') return day.weight_kg;
  if (field === 'weight_trend_kg') return day.weight_trend_kg;
  if (field === 'expenditure_kcal') return day.expenditure_kcal;
  return day.energy_balance_kcal;
}

function average(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}
