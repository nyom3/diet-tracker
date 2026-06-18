import type { DailyFeedback, NutritionResult, SavedMeal, SaveMealPayload, TodaySummary } from './types';

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
  summarizeTodayFeedback: () => void;
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

export function summarizeTodayFeedback(): Promise<DailyFeedback> {
  return callGas<DailyFeedback>((runner) => {
    runner.summarizeTodayFeedback();
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
