import type {
  DailyFeedback,
  NutritionResult,
  NutritionTargets,
  SavedMeal,
  SaveMealPayload,
  SaveTargetsPayload,
  TodaySummary,
  WeeklyReview,
  WeeklyTrend,
} from './types';

declare global {
  interface Window {
    google?: {
      script?: {
        run?: GoogleScriptRun;
      };
    };
  }
}

type GoogleScriptRun = {
  withSuccessHandler: (handler: (value: unknown) => void) => GoogleScriptRun;
  withFailureHandler: (handler: (error: Error) => void) => GoogleScriptRun;
  estimateCalories: (description: string, imageBase64: string, imageMimeType: string) => void;
  processInput: (payload: SaveMealPayload) => void;
  listRecentMeals: (limit: number) => void;
  updateMeal: (id: string, payload: SaveMealPayload) => void;
  getTodaySummary: () => void;
  getTargets: () => void;
  saveTargets: (payload: SaveTargetsPayload) => void;
  getWeeklyTrend: () => void;
  getLatestWeeklyReview: () => void;
  summarizeTodayFeedback: () => void;
  summarizeWeeklyFeedback: () => void;
};

export function estimateCalories(
  description: string,
  imageBase64: string,
  imageMimeType: string,
): Promise<NutritionResult> {
  return callGas<NutritionResult>((runner) => {
    runner.estimateCalories(description, imageBase64, imageMimeType);
  });
}

export function processInput(payload: SaveMealPayload): Promise<{ ok: boolean; id: string }> {
  return callGas<{ ok: boolean; id: string }>((runner) => {
    runner.processInput(payload);
  });
}

export function listRecentMeals(limit: number): Promise<SavedMeal[]> {
  return callGas<SavedMeal[]>((runner) => {
    runner.listRecentMeals(limit);
  });
}

export function updateMeal(id: string, payload: SaveMealPayload): Promise<{ ok: boolean; id: string }> {
  return callGas<{ ok: boolean; id: string }>((runner) => {
    runner.updateMeal(id, payload);
  });
}

export function getTodaySummary(): Promise<TodaySummary> {
  return callGas<TodaySummary>((runner) => {
    runner.getTodaySummary();
  });
}

export function getTargets(): Promise<NutritionTargets> {
  return callGas<NutritionTargets>((runner) => {
    runner.getTargets();
  });
}

export function saveTargets(payload: SaveTargetsPayload): Promise<{ ok: boolean; targets: NutritionTargets }> {
  return callGas<{ ok: boolean; targets: NutritionTargets }>((runner) => {
    runner.saveTargets(payload);
  });
}

export function getWeeklyTrend(): Promise<WeeklyTrend> {
  return callGas<WeeklyTrend>((runner) => {
    runner.getWeeklyTrend();
  });
}

export function getLatestWeeklyReview(): Promise<WeeklyReview | null> {
  return callGas<WeeklyReview | null>((runner) => {
    runner.getLatestWeeklyReview();
  });
}

export function summarizeTodayFeedback(): Promise<DailyFeedback> {
  return callGas<DailyFeedback>((runner) => {
    runner.summarizeTodayFeedback();
  });
}

export function summarizeWeeklyFeedback(): Promise<WeeklyReview> {
  return callGas<WeeklyReview>((runner) => {
    runner.summarizeWeeklyFeedback();
  });
}

function callGas<T>(invoke: (runner: GoogleScriptRun) => void): Promise<T> {
  return new Promise((resolve, reject) => {
    const runner = window.google?.script?.run;

    if (!runner) {
      reject(new Error('GAS Web App 上で開いてください。'));
      return;
    }

    const configuredRunner = runner
      .withSuccessHandler((value: unknown) => {
        resolve(value as T);
      })
      .withFailureHandler((error: Error) => {
        reject(error);
      });

    invoke(configuredRunner);
  });
}
