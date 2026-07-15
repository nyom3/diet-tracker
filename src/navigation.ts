export const appViewStorageKey = 'diet-tracker-selected-view-v1';

export type AppView = 'today' | 'record' | 'trend';

const appViews: AppView[] = ['today', 'record', 'trend'];

type ReadableStorage = Pick<Storage, 'getItem'>;
type WritableStorage = Pick<Storage, 'setItem'>;

export function isAppView(value: unknown): value is AppView {
  return typeof value === 'string' && appViews.includes(value as AppView);
}

export function readInitialAppView(storage?: ReadableStorage): AppView {
  try {
    const selectedStorage = storage ?? window.sessionStorage;
    const storedView = selectedStorage.getItem(appViewStorageKey);
    return isAppView(storedView) ? storedView : 'today';
  } catch {
    return 'today';
  }
}

export function persistAppView(view: AppView, storage?: WritableStorage): void {
  try {
    const selectedStorage = storage ?? window.sessionStorage;
    selectedStorage.setItem(appViewStorageKey, view);
  } catch {
    // Screen selection persistence is optional when sessionStorage is unavailable.
  }
}
