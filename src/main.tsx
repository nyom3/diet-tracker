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
  Sparkles,
  Zap,
  X,
} from 'lucide-react';
import {
  estimateCalories,
  getTodaySummary,
  listRecentMeals,
  processInput,
  summarizeTodayFeedback,
  updateMeal,
} from './gasClient';
import type {
  DailyFeedback,
  EstimateMode,
  ImagePayload,
  InputMode,
  MealType,
  NutritionItem,
  NutritionKey,
  NutritionResult,
  NutritionTotal,
  SavedMeal,
  SaveMealPayload,
  TodaySummary,
} from './types';
import './styles.css';

const mealTypes: MealType[] = ['朝', '昼', '夜', '間食'];
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
  const [todaySummary, setTodaySummary] = React.useState<TodaySummary | null>(null);
  const [dailyFeedback, setDailyFeedback] = React.useState<DailyFeedback | null>(null);
  const [selectedMealId, setSelectedMealId] = React.useState('');
  const [loadingRecent, setLoadingRecent] = React.useState(false);
  const [status, setStatus] = React.useState<{ message: string; type?: 'success' | 'error' }>({ message: '' });
  const [busy, setBusy] = React.useState<'estimate' | 'save' | 'quick' | 'feedback' | null>(null);
  const [previewUrl, setPreviewUrl] = React.useState('');

  const estimationInput = inputMode === 'photo'
    ? photoNote.trim()
    : mealText.trim();
  const savedDescription = displayName.trim();
  const manualPrompt = createManualPrompt(inputMode, estimationInput);
  const effectiveTotal = items.length > 0 ? calculateTotal(items, servings) : total;
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

  function applyNutrition(result: NutritionResult, enableStepper: boolean): void {
    const nextTotal = normalizeTotal(result.total || result);
    const nextItems = Array.isArray(result.items) ? result.items.map(normalizeItem) : [];

    setTotal(nextTotal);
    setItems(nextItems);
    setServings(enableStepper ? nextItems.map(() => 1) : []);
    setHasNutrition(true);
    if (enableStepper) {
      const autoName = result.display_name || (nextItems.length > 0 ? nextItems[0].name : '');
      if (autoName && !displayName.trim()) setDisplayName(autoName);
    }
  }

  async function handleEstimate(): Promise<void> {
    try {
      setBusy('estimate');
      setStatus({ message: '推定中です。' });
      const image = await readSelectedImage(inputMode, photoFile, photoNote);
      const result = await estimateCalories(estimationInput, image.base64, image.mimeType);
      applyNutrition(result, true);
      setStatus({ message: '推定結果を反映しました。', type: 'success' });
    } catch (error) {
      setStatus({ message: getErrorMessage(error), type: 'error' });
    } finally {
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

  async function refreshDashboard(showStatus: boolean): Promise<void> {
    try {
      setLoadingRecent(true);
      const [meals, summary] = await Promise.all([
        listRecentMeals(10),
        getTodaySummary(),
      ]);
      setRecentMeals(meals);
      setTodaySummary(summary);
      if (showStatus) {
        setStatus({ message: '記録状況を更新しました。', type: 'success' });
      }
    } catch (error) {
      if (showStatus) {
        setStatus({ message: getErrorMessage(error), type: 'error' });
      } else {
        console.warn('記録状況の読み込みに失敗しました:', error);
      }
    } finally {
      setLoadingRecent(false);
    }
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
    setStatus({ message: '最近の記録を読み込みました。', type: 'success' });
  }

  async function handleQuickRegister(meal: SavedMeal): Promise<void> {
    try {
      setBusy('quick');
      setStatus({ message: 'クイック登録中です。' });
      await processInput(buildQuickPayload(meal));
      await refreshDashboard(false);
      setStatus({ message: 'クイック登録しました。', type: 'success' });
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
      setStatus({ message: 'コメントを取得しました。', type: 'success' });
    } catch (error) {
      setStatus({ message: getErrorMessage(error), type: 'error' });
    } finally {
      setBusy(null);
    }
  }

  return (
    <main className="app-shell">
      <header className="app-header">
        <div>
          <p className="eyebrow">Meal Logger</p>
          <h1>食事記録</h1>
        </div>
        <div className="today-chip">{formatToday()}</div>
      </header>

      <section className="panel today-panel">
        <div>
          <span className="section-label">今日</span>
          <h2>
            {Math.round(todaySummary?.total.calories_kcal || 0)} kcal
            <small>
              P{todaySummary?.total.protein_g || 0} / F{todaySummary?.total.fat_g || 0} / C{todaySummary?.total.carbs_g || 0}
            </small>
          </h2>
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
            {loadingRecent ? <Loader2 className="spin" size={18} /> : <RefreshCw size={18} />}
          </button>
        </div>
        {recentMeals.length > 0 ? (
          <ul className="recent-list">
            {recentMeals.map((meal) => (
              <li key={meal.id}>
                <button className="recent-edit-button" type="button" onClick={() => loadMealForEdit(meal)}>
                  <History size={18} />
                  <span>
                    <strong>{meal.description}</strong>
                    <em>{formatMealTime(meal.timestamp)} / {meal.meal_type} / {Math.round(meal.calories_kcal)} kcal</em>
                  </span>
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
              </li>
            ))}
          </ul>
        ) : (
          <p className="empty-text">GAS Web App 上で最近の記録を読み込みます。</p>
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
              <SegmentedButton key={value} active={mealType === value} onClick={() => setMealType(value)}>
                {value}
              </SegmentedButton>
            ))}
          </SegmentedGroup>
          <label className="field datetime-field">
            <span>食事日時</span>
            <input value={datetime} type="datetime-local" onChange={(event) => setDatetime(event.target.value)} />
          </label>
        </section>

        <section className="panel input-panel">
          <div className="section-heading">
            <div>
              <span className="section-label">入力</span>
              <h2>食事内容</h2>
            </div>
            <div className="mode-switch">
              <SegmentedButton active={inputMode === 'photo'} onClick={() => setInputMode('photo')}>
                写真
              </SegmentedButton>
              <SegmentedButton active={inputMode === 'text'} onClick={() => setInputMode('text')}>
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
                  onChange={(event) => setPhotoFile(event.target.files?.[0] || null)}
                />
              </label>
              <label className="field">
                <span>画像の補足・訂正</span>
                <textarea
                  value={photoNote}
                  placeholder="例: 白湯スープではなく豆乳。ご飯は少なめ"
                  onChange={(event) => setPhotoNote(event.target.value)}
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
                onChange={(event) => setMealText(event.target.value)}
              />
            </label>
          )}
          <label className="field">
            <span>食事名</span>
            <input
              value={displayName}
              placeholder={estimateMode === 'api' ? '推定後に自動入力されます' : '食事名を入力してください'}
              onChange={(event) => setDisplayName(event.target.value)}
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
    </main>
  );
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

function buildQuickPayload(meal: SavedMeal): SaveMealPayload {
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

function createManualPrompt(inputMode: InputMode, description: string): string {
  const schema =
    '{"items":[{"name":"品名","calories_kcal":数値,"protein_g":数値,"fat_g":数値,"carbs_g":数値}],"total":{"calories_kcal":数値,"protein_g":数値,"fat_g":数値,"carbs_g":数値}}';

  if (inputMode === 'photo') {
    return `この画像の食事の品ごとのカロリーとPFCを推定してください。JSONのみ回答してください。\n\n補足: ${description || 'なし'}\n\n${schema}`;
  }

  return `次の食事の品ごとのカロリーとPFCを推定してください。JSONのみ回答してください。\n\n食事: ${description}\n\n${schema}`;
}

function readSelectedImage(inputMode: InputMode, file: File | null, note: string): Promise<ImagePayload> {
  if (inputMode !== 'photo') {
    return Promise.resolve({ base64: '', mimeType: '' });
  }

  if (!file) {
    if (!note.trim()) {
      return Promise.reject(new Error('写真またはメモを入力してください。'));
    }

    return Promise.resolve({ base64: '', mimeType: '' });
  }

  if (!/^image\/(jpeg|png)$/.test(file.type)) {
    return Promise.reject(new Error('JPEGまたはPNGを選択してください。'));
  }

  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      resolve({
        base64: String(reader.result).replace(/^data:[^;]+;base64,/, ''),
        mimeType: file.type,
      });
    };
    reader.onerror = () => reject(new Error('画像を読み取れませんでした。'));
    reader.readAsDataURL(file);
  });
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

function parseBreakdownItems(breakdownJson: string): NutritionItem[] {
  try {
    const parsed = JSON.parse(breakdownJson);
    const rawItems = Array.isArray(parsed) ? parsed : parsed.items;
    return Array.isArray(rawItems) ? rawItems.map(normalizeItem) : [];
  } catch {
    return [];
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
    <App />
  </React.StrictMode>,
);
