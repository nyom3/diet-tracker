import React from 'react';
import ReactDOM from 'react-dom/client';
import {
  Camera,
  Check,
  Clipboard,
  History,
  Loader2,
  MessageCircle,
  Minus,
  Plus,
  RefreshCw,
  Save,
  ChevronDown,
  Sparkles,
  Star,
  Trash2,
  Zap,
  X,
} from 'lucide-react';
import {
  addFavorite,
  confirmOpenAiEligibility,
  deleteMeal,
  estimateCalories,
  getAiStatus,
  getTargets,
  getTodaySummary,
  getWeeklyTrend,
  listFavorites,
  listRecentMeals,
  processInput,
  removeFavorite,
  saveTargets,
  setAiProviderMode,
  summarizeTodayFeedback,
  summarizeWeeklyFeedback,
  updateMeal,
} from './gasClient';
import { readSelectedImage } from './imageProcessing';
import type {
  AiProviderMode,
  AiStatus,
  DailyFeedback,
  EstimateMode,
  FavoriteMeal,
  FavoriteMealPayload,
  InputMode,
  MealType,
  NutritionItem,
  NutritionKey,
  NutritionResult,
  NutritionTargets,
  NutritionTotal,
  SavedMeal,
  SaveMealPayload,
  SaveTargetsPayload,
  TodaySummary,
  WeeklyReview,
  WeeklyTrend,
} from './types';
import './styles.css';

const mealTypes: MealType[] = ['朝', '昼', '夜', '間食'];
const recentMealsPreviewCount = 3;
const draftStorageKey = 'diet-tracker-meal-draft-v1';
const targetPanelStorageKey = 'panel_target_open';
const weeklyPanelStorageKey = 'panel_weekly_open';
const aiPanelStorageKey = 'panel_ai_open';
const quickUndoWindowMs = 8000;
const nutritionKeys: Array<{ key: NutritionKey; label: string; unit: string; step: string }> = [
  { key: 'calories_kcal', label: 'カロリー', unit: 'kcal', step: '1' },
  { key: 'protein_g', label: 'タンパク質', unit: 'g', step: '0.1' },
  { key: 'fat_g', label: '脂質', unit: 'g', step: '0.1' },
  { key: 'carbs_g', label: '炭水化物', unit: 'g', step: '0.1' },
];

const emptyTotal: NutritionTotal = {
  calories_kcal: 0,
  protein_g: 0,
  fat_g: 0,
  carbs_g: 0,
};
const defaultPfcRatio = {
  protein: 30,
  fat: 20,
  carbs: 50,
};
const emptyTargets: NutritionTargets = {
  calories_kcal: null,
  protein_g: null,
  fat_g: null,
  carbs_g: null,
};

type ResourceStatus = 'loading' | 'loaded' | 'error';

type QuickUndo = {
  id: string;
  description: string;
};

function formatWeightKg(weightKg: number | null | undefined): string {
  return typeof weightKg === 'number' && Number.isFinite(weightKg) ? `${weightKg.toFixed(1)}kg` : '-';
}

function summarizeAiStatusLine(aiStatus: AiStatus | null): string {
  if (!aiStatus) {
    return 'AI状況を取得中です。';
  }

  if (aiStatus.mode === 'gemini') {
    return 'AI: Gemini・手動選択中';
  }

  if (!aiStatus.openAiAvailable) {
    return `AI: Gemini使用中(${aiStatus.blockingReason || 'OpenAI利用不可'})`;
  }

  const used = aiStatus.usage.economyTokens + aiStatus.usage.reservedEconomyTokens;
  const appLimit = aiStatus.limits.economy.appLimit;
  const remainingPercent = appLimit > 0 ? Math.max(0, ((appLimit - used) / appLimit) * 100).toFixed(1) : '0.0';
  return `AI: OpenAI・無料利用 安全 残り${remainingPercent}%`;
}

function aiModeLabel(mode: AiProviderMode): string {
  if (mode === 'openai') return 'OpenAI';
  if (mode === 'gemini') return 'Gemini';
  return '自動';
}

function aiEligibilityLabel(status: AiStatus['eligibility']['status']): string {
  if (status === 'confirmed') return '確認済み';
  if (status === 'expired') return '要再確認(期限切れ)';
  if (status === 'paused') return '一時停止中';
  return '未確認';
}

function formatNextResetJst(dateUtc: string): string {
  const base = Date.parse(`${dateUtc}T00:00:00Z`);

  if (Number.isNaN(base)) {
    return '-';
  }

  const next = new Date(base + 24 * 60 * 60 * 1000);
  return new Intl.DateTimeFormat('ja-JP', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Asia/Tokyo',
  }).format(next);
}

function formatEpochMs(epochMs: number): string {
  if (!epochMs) {
    return '未確認';
  }

  return new Intl.DateTimeFormat('ja-JP', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Asia/Tokyo',
  }).format(new Date(epochMs));
}

type ErrorBoundaryState = {
  hasError: boolean;
};

class AppErrorBoundary extends React.Component<React.PropsWithChildren, ErrorBoundaryState> {
  state: ErrorBoundaryState = {
    hasError: false,
  };

  static getDerivedStateFromError(): ErrorBoundaryState {
    return { hasError: true };
  }

  componentDidCatch(error: unknown): void {
    console.error('画面表示でエラーが発生しました:', error);
  }

  render(): React.ReactNode {
    if (this.state.hasError) {
      return (
        <main className="app-shell error-fallback">
          <section className="panel">
            <p className="section-eyebrow">表示エラー</p>
            <h1>表示の一部でエラーが発生しました。</h1>
            <p>再読み込みしてください。入力中の内容がある場合は、ページ更新前に控えてください。</p>
            <button className="action-button primary-action" type="button" onClick={() => window.location.reload()}>
              再読み込み
            </button>
          </section>
        </main>
      );
    }

    return this.props.children;
  }
}

function App(): JSX.Element {
  const [mealType, setMealType] = React.useState<MealType>(() => getDefaultMealType());
  const [inputMode, setInputMode] = React.useState<InputMode>('photo');
  const [estimateMode, setEstimateMode] = React.useState<EstimateMode>('api');
  const [datetime, setDatetime] = React.useState(() => createLocalDatetimeValue());
  const [photoFile, setPhotoFile] = React.useState<File | null>(null);
  const [photoNote, setPhotoNote] = React.useState('');
  const [mealText, setMealText] = React.useState('');
  const [displayName, setDisplayName] = React.useState('');
  const [manualJson, setManualJson] = React.useState('');
  const [total, setTotal] = React.useState<NutritionTotal>(emptyTotal);
  const [items, setItems] = React.useState<NutritionItem[]>([]);
  const [servings, setServings] = React.useState<number[]>([]);
  const [hasNutrition, setHasNutrition] = React.useState(false);
  const [recentMeals, setRecentMeals] = React.useState<SavedMeal[]>([]);
  const [favorites, setFavorites] = React.useState<FavoriteMeal[]>([]);
  const [isRecentExpanded, setIsRecentExpanded] = React.useState(false);
  const [todaySummary, setTodaySummary] = React.useState<TodaySummary | null>(null);
  const [targets, setTargets] = React.useState<NutritionTargets>(emptyTargets);
  const [targetCaloriesInput, setTargetCaloriesInput] = React.useState('');
  const [isTargetPanelOpen, setIsTargetPanelOpen] = React.useState(() => readBooleanStorage(targetPanelStorageKey, false));
  const [pfcRatio, setPfcRatio] = React.useState(defaultPfcRatio);
  const [weeklyTrend, setWeeklyTrend] = React.useState<WeeklyTrend | null>(null);
  const [weeklyReview, setWeeklyReview] = React.useState<WeeklyReview | null>(null);
  const [isWeeklyPanelOpen, setIsWeeklyPanelOpen] = React.useState(() => readBooleanStorage(weeklyPanelStorageKey, false));
  const [dailyFeedback, setDailyFeedback] = React.useState<DailyFeedback | null>(null);
  const [selectedMealId, setSelectedMealId] = React.useState('');
  const [recentStatus, setRecentStatus] = React.useState<ResourceStatus>('loading');
  const [favoritesStatus, setFavoritesStatus] = React.useState<ResourceStatus>('loading');
  const [summaryStatus, setSummaryStatus] = React.useState<ResourceStatus>('loading');
  const [targetsStatus, setTargetsStatus] = React.useState<ResourceStatus>('loading');
  const [weeklyStatus, setWeeklyStatus] = React.useState<ResourceStatus>('loading');
  const [aiStatus, setAiStatus] = React.useState<AiStatus | null>(null);
  const [isAiPanelOpen, setIsAiPanelOpen] = React.useState(() => readBooleanStorage(aiPanelStorageKey, false));
  const [aiModeSwitching, setAiModeSwitching] = React.useState(false);
  const [status, setStatus] = React.useState<{ message: string; type?: 'success' | 'error' }>({ message: '' });
  const [busy, setBusy] = React.useState<
    'estimate' | 'save' | 'quick' | 'favorite' | 'removeFavorite' | 'feedback' | 'targets' | 'weekly' | null
  >(null);
  const [previewUrl, setPreviewUrl] = React.useState('');
  const [quickUndo, setQuickUndo] = React.useState<QuickUndo | null>(null);
  const draftPausedRef = React.useRef(true);
  const quickUndoTimeoutRef = React.useRef<number | null>(null);

  const estimationInput = inputMode === 'photo'
    ? photoNote.trim()
    : mealText.trim();
  const savedDescription = displayName.trim();
  const manualPrompt = createManualPrompt(inputMode, estimationInput);
  const effectiveTotal = items.length > 0 ? calculateTotal(items, servings) : total;
  const visibleRecentMeals = isRecentExpanded
    ? recentMeals
    : recentMeals.slice(0, recentMealsPreviewCount);
  const hiddenRecentMealsCount = Math.max(0, recentMeals.length - recentMealsPreviewCount);
  const calculatedTargets = calculateTargetsFromRatio(targetCaloriesInput, pfcRatio);
  const hasTargets = hasCompleteTargets(targets);
  const canSave =
    !busy &&
    Boolean(savedDescription) &&
    hasNutrition &&
    Object.values(effectiveTotal).every((value) => Number.isFinite(value) && value >= 0);

  React.useEffect(() => {
    if (!photoFile) {
      setPreviewUrl('');
      return undefined;
    }

    const nextUrl = URL.createObjectURL(photoFile);
    setPreviewUrl(nextUrl);
    return () => {
      URL.revokeObjectURL(nextUrl);
    };
  }, [photoFile]);

  React.useEffect(() => {
    void refreshDashboard(false);
  }, []);

  React.useEffect(() => {
    void loadAiStatus();
  }, []);

  React.useEffect(() => {
    return () => {
      if (quickUndoTimeoutRef.current !== null) {
        window.clearTimeout(quickUndoTimeoutRef.current);
      }
    };
  }, []);

  React.useEffect(() => {
    const draft = readMealDraft();

    if (!draft || selectedMealId) {
      return;
    }

    setMealType(draft.mealType);
    setDatetime(draft.datetime);
    setInputMode(draft.inputMode);
    setMealText(draft.mealText);
    setPhotoNote(draft.photoNote);
    setDisplayName(draft.displayName);
    draftPausedRef.current = false;
  }, []);

  React.useEffect(() => {
    if (selectedMealId || draftPausedRef.current) {
      return undefined;
    }

    const timeoutId = window.setTimeout(() => {
      writeMealDraft({
        mealType,
        datetime,
        inputMode,
        mealText,
        photoNote,
        displayName,
      });
    }, 500);

    return () => window.clearTimeout(timeoutId);
  }, [datetime, displayName, inputMode, mealText, mealType, photoNote, selectedMealId]);

  function markDraftDirty(): void {
    draftPausedRef.current = false;
  }

  function toggleTargetPanel(): void {
    setIsTargetPanelOpen((current) => {
      const next = !current;
      writeBooleanStorage(targetPanelStorageKey, next);
      return next;
    });
  }

  function toggleWeeklyPanel(): void {
    setIsWeeklyPanelOpen((current) => {
      const next = !current;
      writeBooleanStorage(weeklyPanelStorageKey, next);
      return next;
    });
  }

  function toggleAiPanel(): void {
    setIsAiPanelOpen((current) => {
      const next = !current;
      writeBooleanStorage(aiPanelStorageKey, next);
      return next;
    });
  }

  async function loadAiStatus(): Promise<void> {
    try {
      const nextStatus = await getAiStatus();
      setAiStatus(nextStatus);
    } catch (error) {
      console.warn('AI利用状況の読み込みに失敗しました:', error);
    }
  }

  async function handleAiModeChange(mode: AiProviderMode): Promise<void> {
    try {
      setAiModeSwitching(true);
      const nextStatus = await setAiProviderMode(mode);
      setAiStatus(nextStatus);
    } catch (error) {
      setStatus({ message: getErrorMessage(error), type: 'error' });
    } finally {
      setAiModeSwitching(false);
    }
  }

  async function handleEligibilityAction(action: 'confirm' | 'pause'): Promise<void> {
    try {
      setAiModeSwitching(true);
      const nextStatus = await confirmOpenAiEligibility(action);
      setAiStatus(nextStatus);
      setStatus({
        message: action === 'confirm' ? 'Data Controlsの確認日を更新しました。' : 'OpenAIを一時停止しました。',
        type: 'success',
      });
    } catch (error) {
      setStatus({ message: getErrorMessage(error), type: 'error' });
    } finally {
      setAiModeSwitching(false);
    }
  }

  function applyNutrition(result: NutritionResult, enableStepper: boolean): void {
    const nextTotal = normalizeTotal(result.total || result);
    const nextItems = Array.isArray(result.items) ? result.items.map(normalizeItem) : [];

    setTotal(nextTotal);
    setItems(nextItems);
    setServings(enableStepper ? nextItems.map(() => 1) : []);
    setHasNutrition(true);
    const autoName = [result.display_name, estimationInput, nextItems[0]?.name]
      .map((value) => value?.trim() ?? '')
      .find(Boolean);
    if (autoName && !displayName.trim()) setDisplayName(autoName);
  }

  async function handleEstimate(): Promise<void> {
    try {
      setBusy('estimate');
      setStatus({ message: '推定中です。' });
      const image = await readSelectedImage(inputMode, photoFile, photoNote);
      const result = await estimateCalories(estimationInput, image.base64, image.mimeType, image.widthPx, image.heightPx);
      applyNutrition(result, true);
      setStatus(
        result.fallback_notice
          ? { message: `推定結果を反映しました。${result.fallback_notice}`, type: 'error' }
          : { message: '推定結果を反映しました。', type: 'success' },
      );
    } catch (error) {
      setStatus({ message: getErrorMessage(error), type: 'error' });
    } finally {
      await loadAiStatus();
      setBusy(null);
    }
  }

  function handleApplyJson(): void {
    try {
      applyNutrition(JSON.parse(manualJson) as NutritionResult, false);
      setStatus({ message: 'JSONを反映しました。', type: 'success' });
    } catch {
      setStatus({ message: 'JSONを読み取れませんでした。', type: 'error' });
    }
  }

  async function handleCopyPrompt(): Promise<void> {
    try {
      await navigator.clipboard.writeText(manualPrompt);
      setStatus({ message: 'プロンプトをコピーしました。', type: 'success' });
    } catch {
      setStatus({ message: 'コピーに失敗しました。手動で選択してください。', type: 'error' });
    }
  }

  async function handleSave(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();

    try {
      const payload = buildPayload({
        datetime,
        mealType,
        description: savedDescription,
        estimateMode,
        total: effectiveTotal,
        items,
        servings,
      });
      setBusy('save');
      setStatus({ message: selectedMealId ? '更新中です。' : '保存中です。' });
      if (selectedMealId) {
        await updateMeal(selectedMealId, payload);
      } else {
        await processInput(payload);
      }
      clearMealDraft();
      resetForm();
      await refreshDashboard(false);
      setStatus({ message: selectedMealId ? '更新しました。' : '保存しました。', type: 'success' });
    } catch (error) {
      setStatus({ message: getErrorMessage(error), type: 'error' });
    } finally {
      setBusy(null);
    }
  }

  function resetForm(): void {
    draftPausedRef.current = true;
    clearMealDraft();
    setMealType(getDefaultMealType());
    setInputMode('photo');
    setEstimateMode('api');
    setDatetime(createLocalDatetimeValue());
    setPhotoFile(null);
    setPhotoNote('');
    setMealText('');
    setDisplayName('');
    setManualJson('');
    setTotal(emptyTotal);
    setItems([]);
    setServings([]);
    setHasNutrition(false);
    setSelectedMealId('');
  }

  function updateServing(index: number, delta: number): void {
    const nextServings = servings.length ? [...servings] : items.map(() => 1);
    nextServings[index] = Math.max(0.1, Math.round(((nextServings[index] || 1) + delta) * 10) / 10);
    setServings(nextServings);
    setTotal(calculateTotal(items, nextServings));
    setHasNutrition(true);
  }

  function updateItemName(index: number, value: string): void {
    const nextItems = items.map((item, itemIndex) => (
      itemIndex === index ? { ...item, name: value } : item
    ));
    setItems(nextItems);
    setTotal(calculateTotal(nextItems, servings));
    setHasNutrition(true);
  }

  function updateItemNutrition(index: number, key: NutritionKey, value: string): void {
    const nextItems = items.map((item, itemIndex) => (
      itemIndex === index ? { ...item, [key]: normalizeNumber(value) } : item
    ));
    setItems(nextItems);
    setTotal(calculateTotal(nextItems, servings));
    setHasNutrition(true);
  }

  async function loadRecentMeals(): Promise<boolean> {
    setRecentStatus('loading');
    try {
      const meals = await listRecentMeals(10);
      setRecentMeals(meals);
      setRecentStatus('loaded');
      return true;
    } catch (error) {
      console.warn('最近の記録の読み込みに失敗しました:', error);
      setRecentStatus('error');
      return false;
    }
  }

  async function loadFavorites(): Promise<boolean> {
    setFavoritesStatus('loading');
    try {
      const nextFavorites = await listFavorites();
      setFavorites(nextFavorites);
      setFavoritesStatus('loaded');
      return true;
    } catch (error) {
      console.warn('お気に入りの読み込みに失敗しました:', error);
      setFavoritesStatus('error');
      return false;
    }
  }

  async function loadSummary(): Promise<boolean> {
    setSummaryStatus('loading');
    try {
      const summary = await getTodaySummary();
      setTodaySummary(summary);
      setSummaryStatus('loaded');
      return true;
    } catch (error) {
      console.warn('今日の集計の読み込みに失敗しました:', error);
      setSummaryStatus('error');
      return false;
    }
  }

  async function loadTargets(): Promise<boolean> {
    setTargetsStatus('loading');
    try {
      const nextTargets = await getTargets();
      setTargets(nextTargets);
      setTargetCaloriesInput(nextTargets.calories_kcal === null ? '' : String(Math.round(nextTargets.calories_kcal)));
      setPfcRatio(derivePfcRatio(nextTargets));
      setTargetsStatus('loaded');
      return true;
    } catch (error) {
      console.warn('目標の読み込みに失敗しました:', error);
      setTargetsStatus('error');
      return false;
    }
  }

  async function loadWeekly(): Promise<boolean> {
    setWeeklyStatus('loading');
    try {
      const trend = await getWeeklyTrend();
      setWeeklyTrend(trend);
      setWeeklyReview(trend.latest_review);
      setWeeklyStatus('loaded');
      return true;
    } catch (error) {
      console.warn('週次トレンドの読み込みに失敗しました:', error);
      setWeeklyStatus('error');
      return false;
    }
  }

  async function refreshDashboard(showStatus: boolean): Promise<void> {
    const results = await Promise.all([
      loadRecentMeals(),
      loadFavorites(),
      loadSummary(),
      loadTargets(),
      loadWeekly(),
    ]);

    if (!showStatus) {
      return;
    }

    const hasFailure = results.some((ok) => !ok);
    setStatus(
      hasFailure
        ? { message: '一部のデータを読み込めませんでした。各パネルの再試行をお試しください。', type: 'error' }
        : { message: '記録状況を更新しました。', type: 'success' },
    );
  }

  function loadMealForEdit(meal: SavedMeal): void {
    const nextItems = parseBreakdownItems(meal.breakdown_json);

    setSelectedMealId(meal.id);
    setMealType(meal.meal_type);
    setInputMode('text');
    setEstimateMode(meal.source === 'manual' ? 'manual' : 'api');
    setDatetime(createLocalDatetimeValue(new Date(meal.timestamp)));
    setPhotoFile(null);
    setPhotoNote('');
    setMealText(meal.description);
    setDisplayName(meal.description);
    setManualJson('');
    setTotal({
      calories_kcal: meal.calories_kcal,
      protein_g: meal.protein_g,
      fat_g: meal.fat_g,
      carbs_g: meal.carbs_g,
    });
    setItems(nextItems);
    setServings(nextItems.map(() => 1));
    setHasNutrition(true);
    draftPausedRef.current = true;
    setStatus({ message: '最近の記録を読み込みました。', type: 'success' });
  }

  function showQuickUndo(id: string, description: string): void {
    if (quickUndoTimeoutRef.current !== null) {
      window.clearTimeout(quickUndoTimeoutRef.current);
    }
    setQuickUndo({ id, description });
    quickUndoTimeoutRef.current = window.setTimeout(() => {
      setQuickUndo(null);
      quickUndoTimeoutRef.current = null;
    }, quickUndoWindowMs);
  }

  async function handleQuickRegister(meal: SavedMeal): Promise<void> {
    try {
      setBusy('quick');
      setStatus({ message: 'クイック登録中です。' });
      const result = await processInput(buildQuickPayload(meal));
      await refreshDashboard(false);
      showQuickUndo(result.id, meal.description);
      setStatus({ message: 'クイック登録しました。', type: 'success' });
    } catch (error) {
      setStatus({ message: getErrorMessage(error), type: 'error' });
    } finally {
      setBusy(null);
    }
  }

  async function handleQuickRegisterFavorite(favorite: FavoriteMeal): Promise<void> {
    try {
      setBusy('quick');
      setStatus({ message: 'お気に入りを登録中です。' });
      const result = await processInput(buildQuickPayload(favorite));
      await refreshDashboard(false);
      showQuickUndo(result.id, favorite.description);
      setStatus({ message: 'お気に入りから登録しました。', type: 'success' });
    } catch (error) {
      setStatus({ message: getErrorMessage(error), type: 'error' });
    } finally {
      setBusy(null);
    }
  }

  async function handleUndoQuickRegister(): Promise<void> {
    if (!quickUndo) {
      return;
    }

    const { id, description } = quickUndo;

    if (quickUndoTimeoutRef.current !== null) {
      window.clearTimeout(quickUndoTimeoutRef.current);
      quickUndoTimeoutRef.current = null;
    }
    setQuickUndo(null);

    try {
      setBusy('quick');
      setStatus({ message: '取り消し中です。' });
      await deleteMeal(id);
      await refreshDashboard(false);
      setStatus({ message: `${description}の登録を取り消しました。`, type: 'success' });
    } catch (error) {
      setStatus({ message: getErrorMessage(error), type: 'error' });
    } finally {
      setBusy(null);
    }
  }

  async function handleAddFavorite(meal: SavedMeal): Promise<void> {
    try {
      setBusy('favorite');
      setStatus({ message: 'お気に入りに追加中です。' });
      await addFavorite(buildFavoritePayload(meal));
      await refreshDashboard(false);
      setStatus({ message: 'お気に入りに追加しました。', type: 'success' });
    } catch (error) {
      setStatus({ message: getErrorMessage(error), type: 'error' });
    } finally {
      setBusy(null);
    }
  }

  async function handleRemoveFavorite(favorite: FavoriteMeal): Promise<void> {
    try {
      setBusy('removeFavorite');
      setStatus({ message: 'お気に入りを削除中です。' });
      await removeFavorite(favorite.id);
      setFavorites((current) => current.filter((item) => item.id !== favorite.id));
      setStatus({ message: 'お気に入りを削除しました。', type: 'success' });
    } catch (error) {
      setStatus({ message: getErrorMessage(error), type: 'error' });
    } finally {
      setBusy(null);
    }
  }

  async function handleDailyFeedback(): Promise<void> {
    try {
      setBusy('feedback');
      setStatus({ message: 'コメントを取得中です。' });
      const feedback = await summarizeTodayFeedback();
      setDailyFeedback(feedback);
      setTodaySummary({
        date: feedback.date,
        count: feedback.count,
        total: feedback.total,
      });
      setStatus(
        feedback.fallback_notice
          ? { message: `コメントを取得しました。${feedback.fallback_notice}`, type: 'error' }
          : { message: 'コメントを取得しました。', type: 'success' },
      );
    } catch (error) {
      setStatus({ message: getErrorMessage(error), type: 'error' });
    } finally {
      await loadAiStatus();
      setBusy(null);
    }
  }

  async function handleSaveTargets(): Promise<void> {
    try {
      const payload = buildTargetsPayload(calculatedTargets);
      setBusy('targets');
      setStatus({ message: '目標を保存中です。' });
      const result = await saveTargets(payload);
      setTargets(result.targets);
      await refreshDashboard(false);
      setStatus({ message: '目標を保存しました。', type: 'success' });
    } catch (error) {
      setStatus({ message: getErrorMessage(error), type: 'error' });
    } finally {
      setBusy(null);
    }
  }

  async function handleWeeklyFeedback(): Promise<void> {
    try {
      setBusy('weekly');
      setStatus({ message: '週次コメントを取得中です。' });
      const review = await summarizeWeeklyFeedback();
      setWeeklyReview(review);
      await refreshDashboard(false);
      setStatus(
        review.fallback_notice
          ? { message: `週次コメントを取得しました。${review.fallback_notice}`, type: 'error' }
          : { message: '週次コメントを取得しました。', type: 'success' },
      );
    } catch (error) {
      setStatus({ message: getErrorMessage(error), type: 'error' });
    } finally {
      await loadAiStatus();
      setBusy(null);
    }
  }

  return (
    <main className="app-shell">
      <section className={`panel ai-status-panel collapsible-panel ${isAiPanelOpen ? 'open' : ''}`} aria-expanded={isAiPanelOpen}>
        <button
          className="collapsible-heading"
          type="button"
          aria-expanded={isAiPanelOpen}
          onClick={toggleAiPanel}
        >
          <span>
            <span className="section-label">AI</span>
            <strong>{summarizeAiStatusLine(aiStatus)}</strong>
          </span>
          <ChevronDown className={isAiPanelOpen ? 'expanded' : ''} size={18} aria-hidden="true" />
        </button>
        {isAiPanelOpen && (
          <div className="collapsible-body">
            <SegmentedGroup label="AIプロバイダー">
              {(['auto', 'openai', 'gemini'] as AiProviderMode[]).map((mode) => (
                <SegmentedButton
                  key={mode}
                  active={(aiStatus?.mode ?? 'auto') === mode}
                  onClick={() => {
                    if (busy !== null || aiModeSwitching) return;
                    void handleAiModeChange(mode);
                  }}
                >
                  {aiModeLabel(mode)}
                </SegmentedButton>
              ))}
            </SegmentedGroup>
            {aiStatus ? (
              <>
                <ul className="ai-status-detail">
                  <li>
                    <span>現在の状態</span>
                    <strong>{aiStatus.openAiAvailable ? 'OpenAI利用可' : `Gemini使用中(${aiStatus.blockingReason || '手動選択'})`}</strong>
                  </li>
                  <li>
                    <span>本日の使用token</span>
                    <strong>{aiStatus.usage.economyTokens.toLocaleString()} + 予約中{aiStatus.usage.reservedEconomyTokens.toLocaleString()}</strong>
                  </li>
                  {aiStatus.lastUsage && (
                    <li>
                      <span>直近のOpenAI利用</span>
                      <strong>
                        {aiStatus.lastUsage.totalTokens.toLocaleString()} token
                        （入力{aiStatus.lastUsage.inputTokens.toLocaleString()} / 出力{aiStatus.lastUsage.outputTokens.toLocaleString()}）
                      </strong>
                    </li>
                  )}
                  <li>
                    <span>アプリ安全上限までの残量</span>
                    <strong>{Math.max(0, aiStatus.limits.economy.appLimit - aiStatus.usage.economyTokens - aiStatus.usage.reservedEconomyTokens).toLocaleString()} token</strong>
                  </li>
                  <li>
                    <span>公式無料枠までの参考残量</span>
                    <strong>{Math.max(0, aiStatus.limits.economy.officialLimit - aiStatus.usage.economyTokens - aiStatus.usage.reservedEconomyTokens).toLocaleString()} token</strong>
                  </li>
                  <li>
                    <span>次回リセット</span>
                    <strong>{formatNextResetJst(aiStatus.usage.dateUtc)}</strong>
                  </li>
                  <li>
                    <span>Data Controls最終確認</span>
                    <strong>{aiEligibilityLabel(aiStatus.eligibility.status)} ({formatEpochMs(aiStatus.eligibility.confirmedAt)})</strong>
                  </li>
                  {aiStatus.lastFallbackReason && (
                    <li>
                      <span>直近のフォールバック理由</span>
                      <strong>{aiStatus.lastFallbackReason}</strong>
                    </li>
                  )}
                </ul>
                <div className="ai-eligibility-box">
                  <p>30日ごとにData Controlsを開き、「You're enrolled for complimentary daily tokens」を確認してください。</p>
                  <div className="ai-eligibility-actions">
                    <a
                      className="action-button secondary-action"
                      href="https://platform.openai.com/settings/organization/data-controls/sharing"
                      target="_blank"
                      rel="noreferrer"
                    >
                      Data Controlsを開く
                    </a>
                    <button
                      className="action-button secondary-action"
                      type="button"
                      disabled={busy !== null || aiModeSwitching}
                      onClick={() => void handleEligibilityAction('confirm')}
                    >
                      確認して更新
                    </button>
                    <button
                      className="action-button secondary-action"
                      type="button"
                      disabled={busy !== null || aiModeSwitching}
                      onClick={() => void handleEligibilityAction('pause')}
                    >
                      OpenAIを一時停止
                    </button>
                  </div>
                </div>
              </>
            ) : (
              <p className="empty-text">AI状況を取得できませんでした。手動入力・保存は引き続き利用できます。</p>
            )}
          </div>
        )}
      </section>

      <header className="app-header">
        <div>
          <p className="eyebrow">Meal Logger</p>
          <h1>食事記録</h1>
        </div>
        <div className="today-chip">{formatToday()}</div>
      </header>

      <section className="panel today-panel">
        <PanelStatusNote
          status={summaryStatus}
          hasData={todaySummary !== null}
          loadingText="今日の記録を読み込み中です。"
          errorText="今日の記録を読み込めませんでした。"
          onRetry={() => void loadSummary()}
        />
        <PanelStatusNote
          status={targetsStatus}
          hasData={hasTargets}
          loadingText="目標を読み込み中です。"
          errorText="目標を読み込めませんでした。"
          onRetry={() => void loadTargets()}
        />
        <div>
          <span className="section-label">今日</span>
          <h2>
            <span className={isOverTarget(todaySummary?.total.calories_kcal || 0, targets.calories_kcal) ? 'over' : ''}>
              {formatTargetProgress(todaySummary?.total.calories_kcal || 0, targets.calories_kcal, 'kcal')}
            </span>
            <small>
              <span className={isOverTarget(todaySummary?.total.protein_g || 0, targets.protein_g) ? 'over' : ''}>
                P{formatTargetProgress(todaySummary?.total.protein_g || 0, targets.protein_g, 'g')}
              </span>
              <span className={isOverTarget(todaySummary?.total.fat_g || 0, targets.fat_g) ? 'over' : ''}>
                F{formatTargetProgress(todaySummary?.total.fat_g || 0, targets.fat_g, 'g')}
              </span>
              <span className={isOverTarget(todaySummary?.total.carbs_g || 0, targets.carbs_g) ? 'over' : ''}>
                C{formatTargetProgress(todaySummary?.total.carbs_g || 0, targets.carbs_g, 'g')}
              </span>
            </small>
          </h2>
          {!hasTargets && targetsStatus === 'loaded' && (
            <p className="target-empty-note">目標を設定すると残り/超過を表示します。</p>
          )}
        </div>
        <button
          className="action-button secondary-action feedback-action"
          type="button"
          disabled={busy !== null || !todaySummary?.count}
          onClick={handleDailyFeedback}
        >
          {busy === 'feedback' ? <Loader2 className="spin" size={18} /> : <MessageCircle size={18} />}
          コメント
        </button>
        {dailyFeedback && (
          <p className="feedback-text">{dailyFeedback.feedback}</p>
        )}
      </section>

      <form className="meal-form" onSubmit={handleSave}>
        {selectedMealId && (
          <div className="edit-banner">
            <span>記録を編集中</span>
            <button type="button" onClick={resetForm}>
              <X size={16} />
              解除
            </button>
          </div>
        )}
        <section className="panel compact-panel">
          <SegmentedGroup label="食事タイプ">
            {mealTypes.map((value) => (
              <SegmentedButton key={value} active={mealType === value} onClick={() => {
                markDraftDirty();
                setMealType(value);
              }}>
                {value}
              </SegmentedButton>
            ))}
          </SegmentedGroup>
          <label className="field datetime-field">
            <span>食事日時</span>
            <input value={datetime} type="datetime-local" onChange={(event) => {
              markDraftDirty();
              setDatetime(event.target.value);
            }} />
          </label>
        </section>

        <section className="panel input-panel">
          <div className="section-heading">
            <div>
              <span className="section-label">入力</span>
              <h2>食事内容</h2>
            </div>
            <div className="mode-switch">
              <SegmentedButton active={inputMode === 'photo'} onClick={() => {
                markDraftDirty();
                setInputMode('photo');
              }}>
                写真
              </SegmentedButton>
              <SegmentedButton active={inputMode === 'text'} onClick={() => {
                markDraftDirty();
                setInputMode('text');
              }}>
                テキスト
              </SegmentedButton>
            </div>
          </div>

          {inputMode === 'photo' ? (
            <div className="photo-grid">
              <label className={`photo-drop ${previewUrl ? 'has-preview' : ''}`}>
                {previewUrl ? (
                  <img src={previewUrl} alt="選択した食事" />
                ) : (
                  <span>
                    <Camera size={24} />
                    写真を選択
                  </span>
                )}
                <input
                  type="file"
                  accept="image/jpeg,image/png"
                  onChange={(event) => {
                    markDraftDirty();
                    setPhotoFile(event.target.files?.[0] || null);
                  }}
                />
              </label>
              <label className="field">
                <span>画像の補足・訂正</span>
                <textarea
                  value={photoNote}
                  placeholder="例: 白湯スープではなく豆乳。ご飯は少なめ"
                  onChange={(event) => {
                    markDraftDirty();
                    setPhotoNote(event.target.value);
                  }}
                />
                <small className="field-hint">この補足は画像と一緒に推定へ渡されます。</small>
              </label>
            </div>
          ) : (
            <label className="field">
              <span>食事内容</span>
              <textarea
                value={mealText}
                placeholder="例: 牛丼並盛、味噌汁"
                onChange={(event) => {
                  markDraftDirty();
                  setMealText(event.target.value);
                }}
              />
            </label>
          )}
          <label className="field">
            <span>食事名</span>
            <input
              value={displayName}
              placeholder={estimateMode === 'api' ? '推定後に自動入力されます' : '食事名を入力してください'}
              onChange={(event) => {
                markDraftDirty();
                setDisplayName(event.target.value);
              }}
            />
            <small className="field-hint">履歴に表示される名前です。</small>
          </label>
        </section>

        <section className="panel">
          <div className="section-heading">
            <div>
              <span className="section-label">推定</span>
              <h2>カロリーとPFC</h2>
            </div>
            <div className="mode-switch">
              <SegmentedButton active={estimateMode === 'api'} onClick={() => setEstimateMode('api')}>
                API
              </SegmentedButton>
              <SegmentedButton active={estimateMode === 'manual'} onClick={() => setEstimateMode('manual')}>
                手動
              </SegmentedButton>
            </div>
          </div>

          {estimateMode === 'api' ? (
            <button className="action-button secondary-action" type="button" disabled={busy !== null} onClick={handleEstimate}>
              {busy === 'estimate' ? <Loader2 className="spin" size={18} /> : <Sparkles size={18} />}
              推定する
            </button>
          ) : (
            <div className="manual-box">
              <label className="field">
                <span>プロンプト</span>
                <textarea className="mono" value={manualPrompt} readOnly />
              </label>
              <button className="action-button secondary-action" type="button" onClick={handleCopyPrompt}>
                <Clipboard size={18} />
                コピー
              </button>
              <label className="field">
                <span>JSON</span>
                <textarea
                  value={manualJson}
                  placeholder='{"items":[{"name":"牛丼","calories_kcal":652,"protein_g":24,"fat_g":18,"carbs_g":92}],"total":{"calories_kcal":652,"protein_g":24,"fat_g":18,"carbs_g":92}}'
                  onChange={(event) => setManualJson(event.target.value)}
                />
              </label>
              <button className="action-button secondary-action" type="button" onClick={handleApplyJson}>
                <Check size={18} />
                JSONを反映
              </button>
            </div>
          )}
        </section>

        <section className="result-panel">
          <div className="calorie-card">
            <span>推定結果</span>
            <strong>{Math.round(effectiveTotal.calories_kcal || 0)}</strong>
            <em>kcal</em>
          </div>
          {items.length > 0 ? (
            <div className="macro-summary" aria-label="品目から再計算したPFC合計">
              {nutritionKeys.slice(1).map(({ key, label, unit }) => (
                <span key={key}>
                  {label} <strong>{effectiveTotal[key]}</strong>{unit}
                </span>
              ))}
            </div>
          ) : (
            <>
              <div className="macro-grid">
                {nutritionKeys.slice(1).map(({ key, label, unit, step }) => (
                  <label className="macro-card" key={key}>
                    <span>{label}</span>
                    <input
                      type="number"
                      min="0"
                      step={step}
                      inputMode="decimal"
                      value={total[key]}
                      onChange={(event) => {
                        setTotal({ ...total, [key]: normalizeNumber(event.target.value) });
                        setHasNutrition(true);
                      }}
                    />
                    <em>{unit}</em>
                  </label>
                ))}
              </div>
              <label className="calorie-edit">
                <span>カロリーを調整</span>
                <input
                  type="number"
                  min="0"
                  step="1"
                  inputMode="numeric"
                  value={total.calories_kcal}
                  onChange={(event) => {
                    setTotal({ ...total, calories_kcal: normalizeNumber(event.target.value) });
                    setHasNutrition(true);
                  }}
                />
              </label>
            </>
          )}
        </section>

        {items.length > 0 && (
          <section className="panel">
            <div className="section-heading">
              <div>
                <span className="section-label">内訳</span>
                <h2>品目ごとの調整</h2>
              </div>
            </div>
            <ul className="item-list">
              {items.map((item, index) => {
                const serving = servings[index] || 1;
                return (
                  <li key={`item-${index}`}>
                    <div className="item-head">
                      <label className="field item-name-field">
                        <span>品名</span>
                        <input
                          value={item.name}
                          onChange={(event) => updateItemName(index, event.target.value)}
                        />
                      </label>
                      <span>{Math.round(item.calories_kcal * serving)} kcal</span>
                    </div>
                    <div className="item-nutrition-grid">
                      {nutritionKeys.map(({ key, label, unit, step }) => (
                        <label className="item-nutrition-field" key={key}>
                          <span>{label}（1人前）</span>
                          <input
                            type="number"
                            min="0"
                            step={step}
                            inputMode={key === 'calories_kcal' ? 'numeric' : 'decimal'}
                            value={item[key]}
                            onChange={(event) => updateItemNutrition(index, key, event.target.value)}
                          />
                          <em>{unit}</em>
                        </label>
                      ))}
                    </div>
                    <small className="item-serving-hint">
                      入力値は1人前あたり。現在の合計は {Math.round(item.calories_kcal * serving)} kcal です。
                    </small>
                    {estimateMode === 'api' && (
                      <div className="stepper" aria-label={`${item.name}の人前`}>
                        <button type="button" onClick={() => updateServing(index, -0.1)}>
                          <Minus size={16} />
                        </button>
                        <span>{serving.toFixed(1)} 人前</span>
                        <button type="button" onClick={() => updateServing(index, 0.1)}>
                          <Plus size={16} />
                        </button>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          </section>
        )}

        <div className="sticky-actions">
          <p className={`status ${status.type || ''}`} aria-live="polite">{status.message}</p>
          <button className="action-button primary-action" type="submit" disabled={!canSave || busy !== null}>
            {busy === 'save' ? <Loader2 className="spin" size={18} /> : <Save size={18} />}
            {selectedMealId ? '上書き保存' : '保存'}
          </button>
        </div>
      </form>

      {quickUndo && (
        <div className="quick-undo-banner" role="status" aria-live="polite">
          <span>{quickUndo.description}を登録しました。</span>
          <button
            type="button"
            className="quick-undo-button"
            disabled={busy !== null}
            onClick={() => void handleUndoQuickRegister()}
          >
            取り消す
          </button>
        </div>
      )}

      <section className="panel recent-panel">
        <div className="section-heading">
          <div>
            <span className="section-label">履歴</span>
            <h2>最近の記録</h2>
          </div>
          <button
            className="icon-button"
            type="button"
            aria-label="最近の記録を更新"
            onClick={() => void refreshDashboard(true)}
          >
            {recentStatus === 'loading' || favoritesStatus === 'loading' ? <Loader2 className="spin" size={18} /> : <RefreshCw size={18} />}
          </button>
        </div>
        <PanelStatusNote
          status={recentStatus}
          hasData={recentMeals.length > 0}
          loadingText="最近の記録を読み込み中です。"
          errorText="最近の記録を読み込めませんでした。"
          onRetry={() => void loadRecentMeals()}
        />
        {recentMeals.length > 0 ? (
          <ul className="recent-list">
            {visibleRecentMeals.map((meal) => (
              <li key={meal.id}>
                <button className="recent-edit-button" type="button" onClick={() => loadMealForEdit(meal)}>
                  <History size={18} />
                  <span>
                    <strong>{meal.description}</strong>
                    <em>{formatMealTime(meal.timestamp)} / {meal.meal_type} / {Math.round(meal.calories_kcal)} kcal</em>
                  </span>
                </button>
                <div className="meal-action-row">
                  <button
                    className="favorite-add-button"
                    type="button"
                    disabled={busy !== null}
                    onClick={() => void handleAddFavorite(meal)}
                  >
                    {busy === 'favorite' ? <Loader2 className="spin" size={16} /> : <Star size={16} />}
                    お気に入り追加
                  </button>
                  <button
                    className="quick-register-button"
                    type="button"
                    disabled={busy !== null}
                    onClick={() => void handleQuickRegister(meal)}
                  >
                    {busy === 'quick' ? <Loader2 className="spin" size={16} /> : <Zap size={16} />}
                    登録
                  </button>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          recentStatus === 'loaded' && <p className="empty-text">まだ記録がありません。食事を保存するとここに表示されます。</p>
        )}
        {hiddenRecentMealsCount > 0 && (
          <button
            className="recent-toggle-button"
            type="button"
            aria-expanded={isRecentExpanded}
            onClick={() => setIsRecentExpanded((expanded) => !expanded)}
          >
            {isRecentExpanded ? '閉じる' : `さらに表示（あと${hiddenRecentMealsCount}件）`}
          </button>
        )}
      </section>

      <section className="panel favorite-panel">
        <div className="section-heading">
          <div>
            <span className="section-label">定番</span>
            <h2>お気に入り</h2>
          </div>
        </div>
        <PanelStatusNote
          status={favoritesStatus}
          hasData={favorites.length > 0}
          loadingText="お気に入りを読み込み中です。"
          errorText="お気に入りを読み込めませんでした。"
          onRetry={() => void loadFavorites()}
        />
        {favorites.length > 0 ? (
          <ul className="recent-list">
            {favorites.map((favorite) => (
              <li key={favorite.id}>
                <div className="favorite-info">
                  <Star size={18} />
                  <span>
                    <strong>{favorite.description}</strong>
                    <em>{Math.round(favorite.calories_kcal)} kcal / P{favorite.protein_g} / F{favorite.fat_g} / C{favorite.carbs_g}</em>
                  </span>
                </div>
                <div className="meal-action-row">
                  <button
                    className="quick-register-button"
                    type="button"
                    disabled={busy !== null}
                    onClick={() => void handleQuickRegisterFavorite(favorite)}
                  >
                    {busy === 'quick' ? <Loader2 className="spin" size={16} /> : <Zap size={16} />}
                    登録
                  </button>
                  <button
                    className="favorite-remove-button"
                    type="button"
                    disabled={busy !== null}
                    onClick={() => void handleRemoveFavorite(favorite)}
                  >
                    {busy === 'removeFavorite' ? <Loader2 className="spin" size={16} /> : <Trash2 size={16} />}
                    削除
                  </button>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          favoritesStatus === 'loaded' && (
            <p className="empty-text">最近の記録からお気に入りに追加すると、ここからワンタップ登録できます。</p>
          )
        )}
      </section>

      <section className={`panel target-panel collapsible-panel ${isTargetPanelOpen ? 'open' : ''}`} aria-expanded={isTargetPanelOpen}>
        <button
          className="collapsible-heading"
          type="button"
          aria-expanded={isTargetPanelOpen}
          onClick={toggleTargetPanel}
        >
          <span>
            <span className="section-label">目標</span>
            <strong>1日の基準</strong>
          </span>
          <ChevronDown className={isTargetPanelOpen ? 'expanded' : ''} size={18} aria-hidden="true" />
        </button>
        <PanelStatusNote
          status={targetsStatus}
          hasData={hasTargets}
          loadingText="目標を読み込み中です。"
          errorText="目標を読み込めませんでした。"
          onRetry={() => void loadTargets()}
        />
        {isTargetPanelOpen && (
          <div className="collapsible-body">
            <div className="target-grid">
              <label className="field">
                <span>目標 kcal</span>
                <input
                  value={targetCaloriesInput}
                  type="number"
                  min="0"
                  step="1"
                  inputMode="numeric"
                  onChange={(event) => setTargetCaloriesInput(event.target.value)}
                />
              </label>
              <div className="ratio-grid">
                <RatioField label="P%" value={pfcRatio.protein} onChange={(value) => setPfcRatio({ ...pfcRatio, protein: value })} />
                <RatioField label="F%" value={pfcRatio.fat} onChange={(value) => setPfcRatio({ ...pfcRatio, fat: value })} />
                <RatioField label="C%" value={pfcRatio.carbs} onChange={(value) => setPfcRatio({ ...pfcRatio, carbs: value })} />
              </div>
            </div>
            <div className="target-preview">
              <span>{Math.round(calculatedTargets.calories_kcal)} kcal</span>
              <span>P {calculatedTargets.protein_g}g</span>
              <span>F {calculatedTargets.fat_g}g</span>
              <span>C {calculatedTargets.carbs_g}g</span>
            </div>
            <button className="action-button secondary-action" type="button" disabled={busy !== null} onClick={handleSaveTargets}>
              {busy === 'targets' ? <Loader2 className="spin" size={18} /> : <Save size={18} />}
              目標を保存
            </button>
          </div>
        )}
      </section>

      <section className={`panel weekly-panel collapsible-panel ${isWeeklyPanelOpen ? 'open' : ''}`} aria-expanded={isWeeklyPanelOpen}>
        <div className="weekly-heading-row">
          <button
            className="collapsible-heading"
            type="button"
            aria-expanded={isWeeklyPanelOpen}
            onClick={toggleWeeklyPanel}
          >
            <span>
              <span className="section-label">7日</span>
              <strong>トレンド</strong>
            </span>
            <ChevronDown className={isWeeklyPanelOpen ? 'expanded' : ''} size={18} aria-hidden="true" />
          </button>
          <button
            className="action-button secondary-action weekly-feedback-button"
            type="button"
            disabled={busy !== null}
            onClick={handleWeeklyFeedback}
          >
            {busy === 'weekly' ? <Loader2 className="spin" size={18} /> : <MessageCircle size={18} />}
            週次コメント
          </button>
        </div>
        <PanelStatusNote
          status={weeklyStatus}
          hasData={weeklyTrend !== null}
          loadingText="7日トレンドを読み込み中です。"
          errorText="7日トレンドを読み込めませんでした。"
          onRetry={() => void loadWeekly()}
        />
        {isWeeklyPanelOpen && (
          <div className="collapsible-body">
            {weeklyTrend ? (
              <ul className="trend-list">
                {weeklyTrend.days.map((day) => (
                  <li key={day.date}>
                    <div>
                      <strong>{formatShortDate(day.date)}</strong>
                      <span>{day.count > 0 ? `${day.count}件` : '食事0件'} / 体重 {formatWeightKg(day.weight_kg)}</span>
                    </div>
                    <div className="trend-values">
                      <span className={isOverTarget(day.total.calories_kcal, targets.calories_kcal) ? 'over' : ''}>
                        {Math.round(day.total.calories_kcal)}{targets.calories_kcal === null ? '' : `/${Math.round(targets.calories_kcal)}`} kcal
                      </span>
                      <small>P{day.total.protein_g} / F{day.total.fat_g} / C{day.total.carbs_g}</small>
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              weeklyStatus === 'loaded' && <p className="empty-text">直近7日間の記録がありません。</p>
            )}
            {weeklyReview && (
              <p className="feedback-text">
                前回 {formatShortDate(weeklyReview.generated_at)}: {weeklyReview.text}
              </p>
            )}
          </div>
        )}
      </section>
    </main>
  );
}

function PanelStatusNote({
  status,
  hasData,
  loadingText,
  errorText,
  onRetry,
}: {
  status: ResourceStatus;
  hasData: boolean;
  loadingText: string;
  errorText: string;
  onRetry: () => void;
}): JSX.Element | null {
  if (status === 'loading' && !hasData) {
    return (
      <p className="panel-status" aria-live="polite">
        {loadingText}
      </p>
    );
  }

  if (status === 'error') {
    return (
      <p className="panel-status panel-status-error" role="alert">
        <span>{errorText}</span>
        <button type="button" className="retry-button" onClick={onRetry}>
          再試行
        </button>
      </p>
    );
  }

  return null;
}

function SegmentedGroup({ label, children }: { label: string; children: React.ReactNode }): JSX.Element {
  return (
    <fieldset className="segmented-field">
      <legend>{label}</legend>
      <div className="segmented-row">{children}</div>
    </fieldset>
  );
}

function SegmentedButton({
  active,
  children,
  onClick,
}: {
  active: boolean;
  children: React.ReactNode;
  onClick: () => void;
}): JSX.Element {
  return (
    <button className={`segmented-button ${active ? 'active' : ''}`} type="button" onClick={onClick}>
      {children}
    </button>
  );
}

function RatioField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
}): JSX.Element {
  return (
    <label className="ratio-field">
      <span>{label}</span>
      <input
        value={value}
        type="number"
        min="0"
        step="1"
        inputMode="numeric"
        onChange={(event) => onChange(normalizeNumber(event.target.value))}
      />
    </label>
  );
}

function buildPayload({
  datetime,
  mealType,
  description,
  estimateMode,
  total,
  items,
  servings,
}: {
  datetime: string;
  mealType: MealType;
  description: string;
  estimateMode: EstimateMode;
  total: NutritionTotal;
  items: NutritionItem[];
  servings: number[];
}): SaveMealPayload {
  if (!datetime) {
    throw new Error('食事日時を入力してください。');
  }

  const selectedDate = new Date(datetime);

  if (Number.isNaN(selectedDate.getTime())) {
    throw new Error('食事日時が不正です。');
  }

  if (!description) {
    throw new Error('食事内容を入力してください。');
  }

  nutritionKeys.forEach(({ key, label }) => {
    if (!Number.isFinite(total[key]) || total[key] < 0) {
      throw new Error(`${label}を入力してください。`);
    }
  });

  return {
    timestamp: datetime + ':00.000+09:00',
    meal_type: mealType,
    description,
    calories_kcal: total.calories_kcal,
    protein_g: total.protein_g,
    fat_g: total.fat_g,
    carbs_g: total.carbs_g,
    source: estimateMode,
    breakdown_json: JSON.stringify(applyServings(items, servings)),
  };
}

function buildQuickPayload(meal: SavedMeal | FavoriteMeal): SaveMealPayload {
  return {
    timestamp: createLocalDatetimeValue() + ':00.000+09:00',
    meal_type: getDefaultMealType(),
    description: meal.description,
    calories_kcal: meal.calories_kcal,
    protein_g: meal.protein_g,
    fat_g: meal.fat_g,
    carbs_g: meal.carbs_g,
    source: 'manual',
    breakdown_json: meal.breakdown_json,
  };
}

function buildFavoritePayload(meal: SavedMeal): FavoriteMealPayload {
  return {
    description: meal.description,
    calories_kcal: meal.calories_kcal,
    protein_g: meal.protein_g,
    fat_g: meal.fat_g,
    carbs_g: meal.carbs_g,
    breakdown_json: meal.breakdown_json,
  };
}

function buildTargetsPayload(targets: NutritionTotal): SaveTargetsPayload {
  nutritionKeys.forEach(({ key, label }) => {
    if (!Number.isFinite(targets[key]) || targets[key] <= 0) {
      throw new Error(`目標${label}を入力してください。`);
    }
  });

  return {
    calories_kcal: Math.round(targets.calories_kcal),
    protein_g: roundToTenth(targets.protein_g),
    fat_g: roundToTenth(targets.fat_g),
    carbs_g: roundToTenth(targets.carbs_g),
  };
}

function createManualPrompt(inputMode: InputMode, description: string): string {
  const schema =
    '{"items":[{"name":"品名","calories_kcal":数値,"protein_g":数値,"fat_g":数値,"carbs_g":数値}],"total":{"calories_kcal":数値,"protein_g":数値,"fat_g":数値,"carbs_g":数値}}';

  if (inputMode === 'photo') {
    return `この画像の食事の品ごとのカロリーとPFCを推定してください。JSONのみ回答してください。\n\n補足: ${description || 'なし'}\n\n${schema}`;
  }

  return `次の食事の品ごとのカロリーとPFCを推定してください。JSONのみ回答してください。\n\n食事: ${description}\n\n${schema}`;
}

function normalizeTotal(result: Partial<NutritionTotal>): NutritionTotal {
  return {
    calories_kcal: normalizeNumber(result.calories_kcal),
    protein_g: normalizeNumber(result.protein_g),
    fat_g: normalizeNumber(result.fat_g),
    carbs_g: normalizeNumber(result.carbs_g),
  };
}

function normalizeItem(item: Partial<NutritionItem>): NutritionItem {
  return {
    name: String(item.name || '品名未設定'),
    calories_kcal: normalizeNumber(item.calories_kcal),
    protein_g: normalizeNumber(item.protein_g),
    fat_g: normalizeNumber(item.fat_g),
    carbs_g: normalizeNumber(item.carbs_g),
  };
}

function normalizeNumber(value: unknown): number {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) && numberValue >= 0 ? numberValue : 0;
}

function calculateTotal(items: NutritionItem[], servings: number[]): NutritionTotal {
  return applyServings(items, servings).reduce<NutritionTotal>(
    (sum, item) => ({
      calories_kcal: Math.round(sum.calories_kcal + item.calories_kcal),
      protein_g: roundToTenth(sum.protein_g + item.protein_g),
      fat_g: roundToTenth(sum.fat_g + item.fat_g),
      carbs_g: roundToTenth(sum.carbs_g + item.carbs_g),
    }),
    { ...emptyTotal },
  );
}

function calculateTargetsFromRatio(
  caloriesInput: string,
  ratio: { protein: number; fat: number; carbs: number },
): NutritionTotal {
  const calories = normalizeNumber(caloriesInput);
  const ratioTotal = ratio.protein + ratio.fat + ratio.carbs;
  const safeRatio = ratioTotal > 0 ? ratio : defaultPfcRatio;
  const safeTotal = ratioTotal > 0 ? ratioTotal : 100;

  return {
    calories_kcal: Math.round(calories),
    protein_g: roundToTenth((calories * (safeRatio.protein / safeTotal)) / 4),
    fat_g: roundToTenth((calories * (safeRatio.fat / safeTotal)) / 9),
    carbs_g: roundToTenth((calories * (safeRatio.carbs / safeTotal)) / 4),
  };
}

function applyServings(items: NutritionItem[], servings: number[]): NutritionItem[] {
  return items.map((item, index) => {
    const serving = servings[index] || 1;
    return {
      name: item.name,
      calories_kcal: roundToTenth(item.calories_kcal * serving),
      protein_g: roundToTenth(item.protein_g * serving),
      fat_g: roundToTenth(item.fat_g * serving),
      carbs_g: roundToTenth(item.carbs_g * serving),
    };
  });
}

function roundToTenth(value: number): number {
  return Math.round(value * 10) / 10;
}

function createLocalDatetimeValue(date = new Date()): string {
  const now = Number.isNaN(date.getTime()) ? new Date() : date;
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}T${pad(now.getHours())}:${pad(now.getMinutes())}`;
}

function getDefaultMealType(date = new Date()): MealType {
  const hour = date.getHours();

  if (hour >= 5 && hour < 10) return '朝';
  if (hour >= 10 && hour < 15) return '昼';
  if (hour >= 17 && hour < 22) return '夜';
  return '間食';
}

function formatToday(): string {
  return new Intl.DateTimeFormat('ja-JP', { month: 'numeric', day: 'numeric', weekday: 'short' }).format(new Date());
}

function formatMealTime(timestamp: string): string {
  const date = new Date(timestamp);

  if (Number.isNaN(date.getTime())) {
    return timestamp;
  }

  return new Intl.DateTimeFormat('ja-JP', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

function formatShortDate(value: string): string {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat('ja-JP', {
    month: 'numeric',
    day: 'numeric',
  }).format(date);
}

function formatTargetProgress(actual: number, target: number | null | undefined, unit: string): string {
  if (target == null) {
    return `${roundDisplay(actual)} ${unit}`;
  }

  const diff = roundToTenth(target - actual);
  const suffix = diff >= 0 ? `あと${roundDisplay(diff)}` : `超過${roundDisplay(Math.abs(diff))}`;
  return `${roundDisplay(actual)} / ${roundDisplay(target)} ${unit}（${suffix}）`;
}

function roundDisplay(value: number): string {
  return Number.isInteger(value) ? String(value) : String(roundToTenth(value));
}

function hasCompleteTargets(targets: NutritionTargets): boolean {
  return nutritionKeys.every(({ key }) => targets[key] != null);
}

function derivePfcRatio(targets: NutritionTargets): { protein: number; fat: number; carbs: number } {
  if (
    targets.calories_kcal == null ||
    targets.protein_g == null ||
    targets.fat_g == null ||
    targets.carbs_g == null ||
    targets.calories_kcal <= 0
  ) {
    return defaultPfcRatio;
  }

  return {
    protein: Math.round((targets.protein_g * 4 * 100) / targets.calories_kcal),
    fat: Math.round((targets.fat_g * 9 * 100) / targets.calories_kcal),
    carbs: Math.round((targets.carbs_g * 4 * 100) / targets.calories_kcal),
  };
}

function isOverTarget(actual: number, target: number | null | undefined): boolean {
  return target != null && actual > target;
}

function parseBreakdownItems(breakdownJson: string): NutritionItem[] {
  try {
    const parsed = JSON.parse(breakdownJson);
    const rawItems = Array.isArray(parsed) ? parsed : parsed.items;
    return Array.isArray(rawItems) ? rawItems.map(normalizeItem) : [];
  } catch {
    return [];
  }
}

type MealDraft = {
  mealType: MealType;
  datetime: string;
  inputMode: InputMode;
  mealText: string;
  photoNote: string;
  displayName: string;
};

function readMealDraft(): MealDraft | null {
  try {
    const raw = window.localStorage.getItem(draftStorageKey);

    if (!raw) {
      return null;
    }

    const parsed = JSON.parse(raw) as Partial<MealDraft>;
    const mealType = mealTypes.includes(parsed.mealType as MealType)
      ? parsed.mealType as MealType
      : getDefaultMealType();
    const inputMode = parsed.inputMode === 'text' ? 'text' : 'photo';

    return {
      mealType,
      datetime: typeof parsed.datetime === 'string' && parsed.datetime ? parsed.datetime : createLocalDatetimeValue(),
      inputMode,
      mealText: typeof parsed.mealText === 'string' ? parsed.mealText : '',
      photoNote: typeof parsed.photoNote === 'string' ? parsed.photoNote : '',
      displayName: typeof parsed.displayName === 'string' ? parsed.displayName : '',
    };
  } catch {
    return null;
  }
}

function writeMealDraft(draft: MealDraft): void {
  try {
    window.localStorage.setItem(draftStorageKey, JSON.stringify(draft));
  } catch {
    // localStorage may be unavailable in private browsing or constrained WebViews.
  }
}

function clearMealDraft(): void {
  try {
    window.localStorage.removeItem(draftStorageKey);
  } catch {
    // Ignore storage cleanup failures; saving must not fail because draft cleanup failed.
  }
}

function readBooleanStorage(key: string, fallback: boolean): boolean {
  try {
    const raw = window.localStorage.getItem(key);

    if (raw === null) {
      return fallback;
    }

    return raw === 'true';
  } catch {
    return fallback;
  }
}

function writeBooleanStorage(key: string, value: boolean): void {
  try {
    window.localStorage.setItem(key, String(value));
  } catch {
    // Panel state persistence is optional; UI toggling should still work.
  }
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  // GAS withFailureHandler passes a plain object, not an Error instance
  if (typeof error === 'object' && error !== null && 'message' in error) {
    return String((error as { message: unknown }).message);
  }
  return '処理に失敗しました。';
}

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <AppErrorBoundary>
      <App />
    </AppErrorBoundary>
  </React.StrictMode>,
);
