import React from 'react';
import { Check, ChevronDown, ChevronLeft, ChevronRight, Loader2, Sparkles } from 'lucide-react';
import { acceptCoachAction, generateCoachInsight } from '../gasClient';
import type { CoachEvidence, CoachInsight, DashboardData, DashboardDay, DashboardRangeDays } from '../types';
import {
  buildMetricPoints,
  calculateRollingAverage,
  calculateTrendDomain,
  formatMetricValue,
  getAdjacentDate,
  getPfcChartValue,
  getPfcDisplayMode,
  isEnergyDecisionPending,
  normalizeSelectedDate,
  splitTrendSegments,
  type PfcMetric,
  type TrendDomain,
  type TrendPoint,
} from '../trendMetrics';

type ResourceStatus = 'loading' | 'loaded' | 'error';

type TrendViewProps = {
  data: DashboardData | null;
  status: ResourceStatus;
  rangeDays: DashboardRangeDays;
  onRangeChange: (rangeDays: DashboardRangeDays) => void;
  onRetry: () => void;
  onActionAccepted: () => Promise<boolean>;
  children?: React.ReactNode;
};

type TrendSeries = {
  label: string;
  points: TrendPoint[];
  color: string;
  mode?: 'line' | 'bar' | 'points';
  dash?: string;
  marker?: 'circle' | 'square' | 'triangle';
  opacity?: number;
  targetValue?: number;
};

type TableColumn = {
  label: string;
  value: (day: DashboardDay) => string;
};

type DetailValue = {
  label: string;
  value: string;
  note?: string;
};

const rangeOptions: DashboardRangeDays[] = [7, 30, 90];
const pfcOptions: Array<{ metric: PfcMetric; label: string }> = [
  { metric: 'protein_g', label: 'タンパク質' },
  { metric: 'fat_g', label: '脂質' },
  { metric: 'carbs_g', label: '炭水化物' },
];

const chartColors = {
  primary: '#175c4a',
  secondary: '#d97706',
  accent: '#2563eb',
  muted: '#8b9a93',
  target: '#9a3412',
  baseline: '#64748b',
};

export function TrendView({ data, status, rangeDays, onRangeChange, onRetry, onActionAccepted, children }: TrendViewProps): JSX.Element {
  const [selectedDate, setSelectedDate] = React.useState('');
  const [pfcMetric, setPfcMetric] = React.useState<PfcMetric>('protein_g');
  const [coachInsight, setCoachInsight] = React.useState<CoachInsight | null>(null);
  const [coachStatus, setCoachStatus] = React.useState<ResourceStatus>('loaded');
  const [coachError, setCoachError] = React.useState('');
  const [actionAccepted, setActionAccepted] = React.useState(false);

  React.useEffect(() => {
    if (!data) {
      return;
    }
    setSelectedDate((current) => {
      return normalizeSelectedDate(data.days.map((day) => day.date), current);
    });
  }, [data]);

  React.useEffect(() => {
    setCoachInsight(null);
    setCoachStatus('loaded');
    setCoachError('');
    setActionAccepted(false);
  }, [rangeDays]);

  const selectedDay = data?.days.find((day) => day.date === selectedDate) ?? data?.days[data.days.length - 1] ?? null;
  const selectedIndex = data && selectedDay ? data.days.findIndex((day) => day.date === selectedDay.date) : -1;
  const canGoPrevious = selectedIndex > 0;
  const canGoNext = selectedIndex >= 0 && selectedIndex < (data?.days.length ?? 0) - 1;

  function moveSelectedDay(amount: number): void {
    if (!data || selectedIndex < 0) {
      return;
    }
    setSelectedDate(getAdjacentDate(data.days.map((day) => day.date), selectedDay?.date ?? '', amount));
  }

  async function handleGenerateCoachInsight(): Promise<void> {
    if (!data) {
      return;
    }
    setCoachStatus('loading');
    setCoachError('');
    try {
      setCoachInsight(await generateCoachInsight({ scope: 'trend', range_days: rangeDays }));
      setCoachStatus('loaded');
    } catch (error) {
      setCoachStatus('error');
      setCoachError(error instanceof Error ? error.message : 'AI分析を取得できませんでした。');
    }
  }

  async function handleAcceptCoachAction(): Promise<void> {
    const selectedAction = coachInsight?.selected_action;
    if (!selectedAction || actionAccepted) {
      return;
    }
    setCoachStatus('loading');
    setCoachError('');
    try {
      await acceptCoachAction({ scope: 'trend', range_days: rangeDays, action_key: selectedAction.key });
      setActionAccepted(true);
      setCoachStatus('loaded');
      await onActionAccepted();
    } catch (error) {
      setCoachStatus('error');
      setCoachError(error instanceof Error ? error.message : '行動を開始できませんでした。');
    }
  }

  return (
    <main id="trend-view" className="app-view trend-view" tabIndex={-1}>
      <section className="trend-intro">
        <p className="section-eyebrow">推移</p>
        <h1>記録の流れを見る</h1>
        <p>食事・体重・活動を同じ期間で確認します。欠測は推測せず、そのまま表示します。</p>
      </section>

      <section className="panel trend-controls" aria-label="推移の表示条件">
        <div className="trend-range-row">
          <div>
            <span className="section-label">表示期間</span>
            <div className="range-switch" role="group" aria-label="表示期間">
              {rangeOptions.map((option) => (
                <button
                  key={option}
                  className={rangeDays === option ? 'selected' : ''}
                  type="button"
                  aria-pressed={rangeDays === option}
                  onClick={() => onRangeChange(option)}
                >
                  {option}日
                </button>
              ))}
            </div>
          </div>
          <div className="trend-confidence-summary">
            {data ? (
              <>
                <span>記録カバレッジ <strong>{Math.round(data.summary.recording_coverage_ratio * 100)}%</strong></span>
                <span>十分な日 {data.summary.adequate_days}/{data.range_days}日</span>
              </>
            ) : (
              <span>データを読み込み中です。</span>
            )}
          </div>
        </div>
        {data && (
          <div className="confidence-list" aria-label="データ確度">
            <ConfidenceBadge label="栄養" value={data.confidence.nutrition} />
            <ConfidenceBadge label="体重" value={data.confidence.weight} />
            <ConfidenceBadge label="活動" value={data.confidence.activity} />
          </div>
        )}
        {data && selectedDay && (
          <div className="date-detail-controls">
            <button
              className="icon-action"
              type="button"
              aria-label="前の日"
              disabled={!canGoPrevious}
              onClick={() => moveSelectedDay(-1)}
            >
              <ChevronLeft size={20} aria-hidden="true" />
            </button>
            <label className="date-picker-field">
              <span>選択日</span>
              <input
                type="date"
                value={selectedDay.date}
                min={data.window_start}
                max={data.window_end}
                onChange={(event) => setSelectedDate(event.target.value)}
              />
            </label>
            <button
              className="icon-action"
              type="button"
              aria-label="次の日"
              disabled={!canGoNext}
              onClick={() => moveSelectedDay(1)}
            >
              <ChevronRight size={20} aria-hidden="true" />
            </button>
          </div>
        )}
      </section>

      <section className="panel coach-insight-panel" aria-labelledby="coach-insight-heading">
        <div className="section-heading">
          <div>
            <span className="section-label">根拠付きコーチ</span>
            <h2 id="coach-insight-heading">この期間をAIで分析</h2>
          </div>
          <button
            className="action-button primary-action coach-insight-button"
            type="button"
            disabled={!data || coachStatus === 'loading'}
            onClick={() => void handleGenerateCoachInsight()}
          >
            {coachStatus === 'loading' ? <Loader2 className="spin" size={18} /> : <Sparkles size={18} />}
            分析する
          </button>
        </div>
        {coachStatus === 'loading' && <p className="coach-insight-status" role="status">分析中です。少しお待ちください。</p>}
        {coachStatus === 'error' && <p className="coach-insight-status error" role="alert">{coachError}</p>}
        {coachInsight && coachStatus !== 'loading' && (
          <CoachInsightPanel insight={coachInsight} actionAccepted={actionAccepted} onAccept={() => void handleAcceptCoachAction()} />
        )}
      </section>

      {children}

      {status === 'loading' && !data && (
        <section className="panel loading-panel" role="status">
          <Loader2 className="spin" size={22} aria-hidden="true" /> 推移データを読み込んでいます。
        </section>
      )}
      {status === 'error' && !data && (
        <section className="panel error-panel" role="alert">
          <p>推移データを読み込めませんでした。</p>
          <button className="action-button secondary-action" type="button" onClick={onRetry}>再試行</button>
        </section>
      )}
      {data && selectedDay && (
        <>
          <section className="trend-summary-grid" aria-label="期間の要約">
            <SummaryCard label="平均摂取" value={formatMetricValue(data.summary.average_intake_kcal, ' kcal')} />
            <SummaryCard label="平均タンパク質" value={formatMetricValue(data.summary.average_protein_g, ' g')} />
            <SummaryCard label="平均歩数" value={formatMetricValue(data.summary.average_steps, ' 歩')} />
          </section>

          <WeightChart data={data} selectedDay={selectedDay} />
          <EnergyChart data={data} selectedDay={selectedDay} />
          <PfcChart data={data} selectedDay={selectedDay} metric={pfcMetric} onMetricChange={setPfcMetric} />
          <StepsChart data={data} selectedDay={selectedDay} />
          <CoverageChart data={data} selectedDay={selectedDay} />
        </>
      )}
    </main>
  );
}

function CoachInsightPanel({
  insight,
  actionAccepted,
  onAccept,
}: {
  insight: CoachInsight;
  actionAccepted: boolean;
  onAccept: () => void;
}): JSX.Element {
  return (
    <div className="coach-insight-content" aria-live="polite">
      <p className="coach-insight-source">{insight.source === 'ai' ? 'AI分析' : 'ルールベースの案内'}・確度{confidenceLabel(insight.confidence)}</p>
      <h3>{insight.headline}</h3>
      <p>{insight.summary}</p>
      {insight.fallback_notice && <p className="coach-insight-fallback">{insight.fallback_notice}</p>}
      {insight.evidence.length > 0 && (
        <div>
          <span className="section-label">根拠</span>
          <ul className="coach-evidence-list">
            {insight.evidence.map((evidence) => <CoachEvidenceRow key={evidence.key} evidence={evidence} />)}
          </ul>
        </div>
      )}
      {insight.selected_action && (
        <div className="coach-selected-action">
          <div>
            <span className="section-label">選択された行動</span>
            <strong>{insight.selected_action.text}</strong>
          </div>
          <button className="action-button secondary-action" type="button" disabled={actionAccepted} onClick={onAccept}>
            {actionAccepted ? <Check size={18} /> : null}
            {actionAccepted ? '開始済み' : 'この行動を始める'}
          </button>
        </div>
      )}
      {insight.alternative_action && (
        <p className="coach-alternative-action"><span className="section-label">別の候補</span>{insight.alternative_action.text}</p>
      )}
    </div>
  );
}

function CoachEvidenceRow({ evidence }: { evidence: CoachEvidence }): JSX.Element {
  const value = `${formatEvidenceNumber(evidence.value)} ${evidence.unit}`;
  const comparison = evidence.comparison_value === null
    ? ''
    : `（${evidence.comparison_label || '比較'} ${formatEvidenceNumber(evidence.comparison_value)} ${evidence.unit}）`;
  return <li><span>{evidence.label}</span><strong>{value}{comparison}</strong></li>;
}

function formatEvidenceNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

function confidenceLabel(value: DashboardData['confidence']['nutrition']): string {
  return value === 'high' ? '高' : value === 'medium' ? '中' : '低';
}

function ConfidenceBadge({ label, value }: { label: string; value: DashboardData['confidence']['nutrition'] }): JSX.Element {
  const text = value === 'high' ? '高' : value === 'medium' ? '中' : '低';
  return <span className={`confidence-badge confidence-${value}`}><strong>{label}</strong> {text}</span>;
}

function SummaryCard({ label, value }: { label: string; value: string }): JSX.Element {
  return <div className="trend-summary-card"><span>{label}</span><strong>{value}</strong></div>;
}

function WeightChart({ data, selectedDay }: { data: DashboardData; selectedDay: DashboardDay }): JSX.Element {
  const raw = buildMetricPoints(data.days, 'weight_kg');
  const trend = buildMetricPoints(data.days, 'weight_trend_kg');
  const target = data.goals.target_weight_kg;
  const targetPoints = data.days.map((day) => ({ date: day.date, value: target }));
  const domain = calculateTrendDomain([...raw.map((point) => point.value), ...trend.map((point) => point.value), target]);
  const summary = data.summary.latest_weight_trend_kg === null
    ? '有効な体重トレンドはまだありません。'
    : `最新トレンド ${formatMetricValue(data.summary.latest_weight_trend_kg, ' kg', 1)}${data.summary.weight_change_kg === null ? '' : `、期間差 ${formatSigned(data.summary.weight_change_kg, ' kg')}`}`;
  return (
    <TrendChart
      id="weight-chart"
      title="体重"
      description="生の体重、7日間の測定平均、設定されている場合のみ目標体重を表示します。欠測日は線をつなぎません。"
      domain={domain}
      series={[
        { label: '生の体重', points: raw, color: chartColors.muted, mode: 'points', marker: 'circle', opacity: 0.65, targetValue: target ?? undefined },
        { label: '7日トレンド', points: trend, color: chartColors.primary, mode: 'line', marker: 'circle' },
        ...(target === null ? [] : [{ label: '目標体重', points: targetPoints, color: chartColors.target, mode: 'line' as const, dash: '7 5', marker: 'square' as const }]),
      ]}
      selectedDay={selectedDay}
      days={data.days}
      summary={summary}
      detailValues={[
        { label: '生の体重', value: formatMetricValue(selectedDay.weight_kg, ' kg', 1), note: overTargetNote(selectedDay.weight_kg, target) },
        { label: '7日トレンド', value: formatMetricValue(selectedDay.weight_trend_kg, ' kg', 1) },
        ...(target === null ? [] : [{ label: '目標体重', value: formatMetricValue(target, ' kg', 1) }]),
      ]}
      tableColumns={[
        { label: '生の体重', value: (day) => formatMetricValue(day.weight_kg, ' kg', 1) },
        { label: '7日トレンド', value: (day) => formatMetricValue(day.weight_trend_kg, ' kg', 1) },
        ...(target === null ? [] : [{ label: '目標体重', value: () => formatMetricValue(target, ' kg', 1) }]),
      ]}
    />
  );
}

function EnergyChart({ data, selectedDay }: { data: DashboardData; selectedDay: DashboardDay }): JSX.Element {
  const intake = buildMetricPoints(data.days, 'calories_kcal');
  const expenditure = buildMetricPoints(data.days, 'expenditure_kcal');
  const target = data.goals.calories_kcal;
  const targetPoints = data.days.map((day) => ({ date: day.date, value: target }));
  const domain = calculateTrendDomain([0, ...intake.map((point) => point.value), ...expenditure.map((point) => point.value), target]);
  const pending = isEnergyDecisionPending(selectedDay);
  const summary = pending
    ? '記録カバレッジまたは消費データが不十分な日は判定保留です。'
    : `選択日の差分 ${formatSigned(selectedDay.energy_balance_kcal, ' kcal')}`;
  return (
    <TrendChart
      id="energy-chart"
      title="摂取・消費エネルギー"
      description="日別の摂取カロリーを棒、消費カロリーを線で表示します。判定保留日は不足とは扱いません。"
      domain={domain}
      series={[
        { label: '摂取', points: intake, color: chartColors.primary, mode: 'bar', marker: 'square', targetValue: target ?? undefined },
        { label: '消費', points: expenditure, color: chartColors.accent, mode: 'line', marker: 'circle' },
        ...(target === null ? [] : [{ label: '摂取目標', points: targetPoints, color: chartColors.target, mode: 'line' as const, dash: '7 5', marker: 'triangle' as const }]),
      ]}
      selectedDay={selectedDay}
      days={data.days}
      summary={summary}
      detailValues={[
        { label: '摂取', value: formatMetricValue(selectedDay.intake.calories_kcal, ' kcal'), note: overTargetNote(selectedDay.intake.calories_kcal, target) },
        { label: '消費', value: formatMetricValue(selectedDay.expenditure_kcal, ' kcal') },
        { label: 'エネルギー差', value: pending ? '判定保留' : formatSigned(selectedDay.energy_balance_kcal, ' kcal'), note: pending ? '記録カバレッジ2/3以上かつ消費データが必要です。' : undefined },
      ]}
      tableColumns={[
        { label: '摂取', value: (day) => formatMetricValue(day.intake.calories_kcal, ' kcal') },
        { label: '消費', value: (day) => formatMetricValue(day.expenditure_kcal, ' kcal') },
        { label: '差分', value: (day) => isEnergyDecisionPending(day) ? '判定保留' : formatSigned(day.energy_balance_kcal, ' kcal') },
      ]}
    />
  );
}

function PfcChart({
  data,
  selectedDay,
  metric,
  onMetricChange,
}: { data: DashboardData; selectedDay: DashboardDay; metric: PfcMetric; onMetricChange: (metric: PfcMetric) => void }): JSX.Element {
  const mode = getPfcDisplayMode(data.goals, metric);
  const points = data.days.map((day) => ({ date: day.date, value: getPfcChartValue(day, data.goals, metric) }));
  const domain = mode === 'ratio'
    ? calculateTrendDomain([...points.map((point) => point.value), 100])
    : calculateTrendDomain(points.map((point) => point.value));
  const label = pfcOptions.find((option) => option.metric === metric)?.label ?? 'タンパク質';
  const unit = mode === 'ratio' ? '%' : ' g';
  const selectedValue = points.find((point) => point.date === selectedDay.date)?.value ?? null;
  return (
    <TrendChart
      id="pfc-chart"
      title="PFC"
      description={mode === 'ratio' ? '選択した栄養素の実績を目標比で表示します。100%が基準です。' : '目標未設定の栄養素は実績グラムで表示します。'}
      domain={domain}
      series={[
        { label, points, color: chartColors.secondary, mode: 'line', marker: 'circle', targetValue: mode === 'ratio' ? 100 : undefined },
        ...(mode === 'ratio' ? [{ label: '100%基準', points: data.days.map((day) => ({ date: day.date, value: 100 })), color: chartColors.baseline, mode: 'line' as const, dash: '3 5', marker: 'square' as const }] : []),
      ]}
      selectedDay={selectedDay}
      days={data.days}
      summary={`${label}: ${formatMetricValue(selectedValue, unit)}${mode === 'ratio' ? '（目標比）' : '（実績）'}`}
      toolbar={(
        <div className="metric-switch" role="group" aria-label="PFCの表示項目">
          {pfcOptions.map((option) => (
            <button
              key={option.metric}
              className={metric === option.metric ? 'selected' : ''}
              type="button"
              aria-pressed={metric === option.metric}
              onClick={() => onMetricChange(option.metric)}
            >
              {option.label}
            </button>
          ))}
        </div>
      )}
      detailValues={[{ label, value: formatMetricValue(selectedValue, unit), note: mode === 'ratio' ? `${selectedValue !== null && selectedValue > 100 ? '目標超過・' : ''}実績 / 目標 × 100` : '目標未設定のためグラム表示' }]}
      tableColumns={[{ label: `${label}${mode === 'ratio' ? '（目標比）' : ''}`, value: (day) => formatMetricValue(getPfcChartValue(day, data.goals, metric), unit) }]}
    />
  );
}

function StepsChart({ data, selectedDay }: { data: DashboardData; selectedDay: DashboardDay }): JSX.Element {
  const points = buildMetricPoints(data.days, 'steps');
  const average = calculateRollingAverage(data.days, 'steps');
  const domain = calculateTrendDomain([0, ...points.map((point) => point.value), ...average.map((point) => point.value)]);
  return (
    <TrendChart
      id="steps-chart"
      title="歩数"
      description="日別の歩数を棒、直近7日間の利用可能な値の平均を線で表示します。"
      domain={domain}
      series={[
        { label: '日別歩数', points, color: chartColors.accent, mode: 'bar', marker: 'square' },
        { label: '7日平均', points: average, color: chartColors.primary, mode: 'line', marker: 'circle' },
      ]}
      selectedDay={selectedDay}
      days={data.days}
      summary={`選択日の歩数 ${formatMetricValue(selectedDay.steps, ' 歩')}。歩数目標は設定していません。`}
      detailValues={[
        { label: '日別歩数', value: formatMetricValue(selectedDay.steps, ' 歩') },
        { label: '7日平均', value: formatMetricValue(average.find((point) => point.date === selectedDay.date)?.value ?? null, ' 歩') },
      ]}
      tableColumns={[
        { label: '歩数', value: (day) => formatMetricValue(day.steps, ' 歩') },
        { label: '7日平均', value: (day) => formatMetricValue(average.find((point) => point.date === day.date)?.value ?? null, ' 歩') },
      ]}
    />
  );
}

function CoverageChart({ data, selectedDay }: { data: DashboardData; selectedDay: DashboardDay }): JSX.Element {
  const points = data.days.map((day) => ({ date: day.date, value: day.coverage.ratio * 3 }));
  return (
    <TrendChart
      id="coverage-chart"
      title="記録カバレッジ"
      description="朝・昼・夜の記録種類数を0/3から3/3で表示します。間食は比率に含めません。"
      domain={{ min: 0, max: 3 }}
      series={[{ label: '記録種類数', points, color: chartColors.secondary, mode: 'bar', marker: 'triangle' }]}
      selectedDay={selectedDay}
      days={data.days}
      summary={`${selectedDay.coverage.logged_main_meal_types.length}/3（${selectedDay.coverage.adequate ? '十分' : '記録途中'}）。実際に食べた全量ではなく、記録の十分さの近似です。`}
      detailValues={[{ label: '朝・昼・夜', value: `${selectedDay.coverage.logged_main_meal_types.length}/3`, note: selectedDay.coverage.logged_main_meal_types.join('・') || '記録なし' }]}
      tableColumns={[{ label: '朝・昼・夜', value: (day) => `${day.coverage.logged_main_meal_types.length}/3` }]}
    />
  );
}

function TrendChart({
  id,
  title,
  description,
  domain,
  series,
  selectedDay,
  days,
  summary,
  detailValues,
  tableColumns,
  toolbar,
}: {
  id: string;
  title: string;
  description: string;
  domain: TrendDomain;
  series: TrendSeries[];
  selectedDay: DashboardDay;
  days: DashboardDay[];
  summary: string;
  detailValues: DetailValue[];
  tableColumns: TableColumn[];
  toolbar?: React.ReactNode;
}): JSX.Element {
  const width = 640;
  const height = 250;
  const plot = { left: 48, top: 20, width: 570, height: 172 };
  const pointsByDate = new Map(days.map((day) => [day.date, day] as const));
  const allDates = series[0]?.points.map((point) => point.date) ?? [];
  const xForIndex = (index: number): number => plot.left + (allDates.length <= 1 ? plot.width / 2 : (index / (allDates.length - 1)) * plot.width);
  const yForValue = (value: number): number => plot.top + ((domain.max - value) / (domain.max - domain.min)) * plot.height;
  const selectedPointIndex = allDates.indexOf(selectedDay.date);
  const yTicks = [domain.max, (domain.max + domain.min) / 2, domain.min];
  const barWidth = Math.max(2, Math.min(24, plot.width / Math.max(1, allDates.length) * 0.62));
  const dateTickIndexes = getDateTickIndexes(allDates.length);

  return (
    <section className="panel chart-panel">
      <div className="chart-heading">
        <div>
          <span className="section-label">グラフ</span>
          <h2>{title}</h2>
        </div>
        {toolbar}
      </div>
      <div className="chart-frame">
        <svg className="trend-chart-svg" viewBox={`0 0 ${width} ${height}`} role="img" aria-labelledby={`${id}-title ${id}-description`}>
          <title id={`${id}-title`}>{title}</title>
          <desc id={`${id}-description`}>{description}</desc>
          {yTicks.map((value, index) => (
            <g key={`${id}-tick-${index}`}>
              <line x1={plot.left} x2={plot.left + plot.width} y1={yForValue(value)} y2={yForValue(value)} className="chart-grid-line" />
              <text x={plot.left - 8} y={yForValue(value) + 4} textAnchor="end" className="chart-axis-label">{formatAxisValue(value)}</text>
            </g>
          ))}
          <line x1={plot.left} x2={plot.left + plot.width} y1={plot.top + plot.height} y2={plot.top + plot.height} className="chart-axis-line" />
          {dateTickIndexes.map((index) => (
            <text key={`${id}-date-${index}`} x={xForIndex(index)} y={plot.top + plot.height + 24} textAnchor="middle" className="chart-axis-label">{formatShortDate(allDates[index])}</text>
          ))}
          {series.map((item) => item.mode === 'bar' ? (
            <g key={item.label} aria-label={item.label}>
              {item.points.map((point, index) => point.value === null ? null : (
                <rect key={`${item.label}-${point.date}`} x={xForIndex(index) - barWidth / 2} y={yForValue(Math.max(domain.min, point.value))} width={barWidth} height={Math.max(0, plot.top + plot.height - yForValue(Math.max(domain.min, point.value)))} fill={item.color} opacity={item.opacity ?? 0.72} stroke={item.targetValue !== undefined && point.value > item.targetValue ? '#18201b' : undefined} strokeDasharray={item.targetValue !== undefined && point.value > item.targetValue ? '3 2' : undefined} className="chart-bar" />
              ))}
            </g>
          ) : (
            <g key={item.label} aria-label={item.label}>
              {item.mode === 'points' ? item.points.map((point, index) => point.value === null ? null : renderMarker(item.targetValue !== undefined && point.value > item.targetValue ? 'square' : 'circle', xForIndex(index), yForValue(point.value), item.color, `${item.label}-${point.date}`)) : splitTrendSegments(item.points).map((segment, segmentIndex) => (
                <polyline
                  key={`${item.label}-segment-${segmentIndex}`}
                  points={segment.map((point) => `${xForIndex(allDates.indexOf(point.date))},${yForValue(point.value as number)}`).join(' ')}
                  fill="none"
                  stroke={item.color}
                  strokeWidth={item.dash ? 2 : 3}
                  strokeDasharray={item.dash}
                  className="chart-line"
                />
              ))}
              {item.mode !== 'points' && item.points.map((point, index) => point.value === null ? null : renderMarker(item.targetValue !== undefined && point.value > item.targetValue ? 'square' : item.marker ?? 'circle', xForIndex(index), yForValue(point.value), item.color, `${item.label}-${point.date}`))}
            </g>
          ))}
          {selectedPointIndex >= 0 && (
            <line x1={xForIndex(selectedPointIndex)} x2={xForIndex(selectedPointIndex)} y1={plot.top} y2={plot.top + plot.height} className="selected-date-line" />
          )}
        </svg>
      </div>
      <div className="chart-legend" aria-label={`${title}の凡例`}>
        {series.map((item) => <span key={item.label}><i className={`legend-mark ${item.mode ?? 'line'} ${item.dash ? 'dashed' : ''}`} style={{ backgroundColor: item.color }} />{item.label}</span>)}
      </div>
      <p className="chart-summary">{summary}</p>
      <div className="chart-detail" aria-label={`${title}の選択日詳細`}>
        <strong>{formatDate(selectedDay.date)}の詳細</strong>
        <div className="chart-detail-grid">
          {detailValues.map((item) => <span key={item.label}><small>{item.label}</small><b>{item.value}</b>{item.note && <em>{item.note}</em>}</span>)}
        </div>
      </div>
      <details className="chart-table-details">
        <summary><span>データ表を表示</span><ChevronDown size={18} aria-hidden="true" /></summary>
        <div className="chart-table-scroll">
          <table>
            <caption>{title}（{formatDate(selectedDay.date)}を選択中）</caption>
            <thead><tr><th scope="col">日付</th>{tableColumns.map((column) => <th key={column.label} scope="col">{column.label}</th>)}</tr></thead>
            <tbody>{allDates.map((date) => {
              const day = pointsByDate.get(date) ?? selectedDay;
              return <tr key={date} className={date === selectedDay.date ? 'selected-row' : ''}><th scope="row">{formatShortDate(date)}</th>{tableColumns.map((column) => <td key={column.label}>{column.value(day)}</td>)}</tr>;
            })}</tbody>
          </table>
        </div>
      </details>
    </section>
  );
}

function renderMarker(marker: NonNullable<TrendSeries['marker']>, x: number, y: number, color: string, key: string): JSX.Element {
  if (marker === 'square') {
    return <rect key={key} x={x - 3} y={y - 3} width="6" height="6" fill={color} />;
  }
  if (marker === 'triangle') {
    return <path key={key} d={`M ${x} ${y - 4} L ${x + 4} ${y + 3} L ${x - 4} ${y + 3} Z`} fill={color} />;
  }
  return <circle key={key} cx={x} cy={y} r="3.5" fill={color} />;
}

function formatDate(value: string): string {
  const timestamp = Date.parse(`${value}T00:00:00Z`);
  if (Number.isNaN(timestamp)) return value;
  return new Intl.DateTimeFormat('ja-JP', { month: 'long', day: 'numeric', weekday: 'short', timeZone: 'Asia/Tokyo' }).format(new Date(timestamp));
}

function formatShortDate(value: string): string {
  if (!value) return '';
  return value.slice(5).replace('-', '/');
}

function formatAxisValue(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

function formatSigned(value: number | null, unit: string): string {
  if (value === null) return '—';
  return `${value > 0 ? '+' : ''}${value.toFixed(1)}${unit}`;
}

function overTargetNote(actual: number | null, target: number | null): string | undefined {
  return actual !== null && target !== null && actual > target ? '目標超過' : undefined;
}

function getDateTickIndexes(length: number): number[] {
  if (length <= 4) return Array.from({ length }, (_, index) => index);
  const indexes = new Set([0, Math.floor((length - 1) / 2), length - 1]);
  return [...indexes].sort((a, b) => a - b);
}
