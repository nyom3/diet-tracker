import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const dashboardSource = await readFile(new URL('../gas/DashboardMetrics.js', import.meta.url), 'utf8');
const coachSource = await readFile(new URL('../gas/CoachRules.js', import.meta.url), 'utf8');
const codeSource = await readFile(new URL('../gas/Code.gs', import.meta.url), 'utf8');

const pair = {
  evidence_key: 'protein',
  action_key: 'protein',
  evidence: [{ key: 'protein', label: 'タンパク質', value: 20, unit: 'g', comparison_value: 80, comparison_label: '目標', period_start: '2026-07-15', period_end: '2026-07-15', confidence: 'medium' }],
  action: { key: 'protein', category: 'protein', text: '次の一食にタンパク質源を1品追加する', target_date: '2026-07-16' },
  confidence: 'medium',
  type: 'protein',
};

function createHarness(initialRows = []) {
  const rows = initialRows.map((row) => [...row]);
  const sheet = {
    getLastRow: () => rows.length + 1,
    getRange(row, column, rowCount, columnCount) {
      return {
        getValues: () => rows.slice(row - 2, row - 2 + rowCount).map((values) => values.slice(column - 1, column - 1 + columnCount)),
        setValues(values) {
          values.forEach((next, offset) => {
            const target = rows[row - 2 + offset];
            target.splice(column - 1, columnCount, ...next);
          });
        },
      };
    },
    appendRow(row) {
      rows.push([...row]);
    },
  };
  const context = { module: { exports: {} } };
  vm.runInNewContext(dashboardSource, context);
  vm.runInNewContext(coachSource, context);
  vm.runInNewContext(codeSource, context);
  let lockAvailable = true;
  let releaseCount = 0;
  context.Utilities = { getUuid: () => 'uuid-1' };
  context.LockService = {
    getScriptLock: () => ({
      tryLock: () => lockAvailable,
      releaseLock: () => { releaseCount += 1; },
    }),
  };
  context.getCoachActionsSheet = () => sheet;
  context.getCoachDashboardContext = () => ({
    dashboard: {
      window_end: '2026-07-15',
      window_start: '2026-07-09',
      goals: {},
      days: [],
    },
  });
  context.buildCoachEvidence = () => [pair];
  context.buildCoachActionCandidates = () => [pair.action];
  context.buildCoachCandidatePairs = () => [pair];
  return {
    context,
    rows,
    setLockAvailable: (value) => { lockAvailable = value; },
    getReleaseCount: () => releaseCount,
  };
}

const row = (overrides = {}) => {
  const base = [
    'action_existing',
    '2026-07-15T00:00:00.000Z',
    '2026-07-16',
    'protein',
    'protein',
    '次の一食にタンパク質源を1品追加する',
    'planned',
    '',
    JSON.stringify(pair.evidence),
  ];
  const indexes = { id: 0, created_at: 1, target_date: 2, category: 3, action_key: 4, text: 5, status: 6, completed_at: 7, evidence_json: 8 };
  Object.entries(overrides).forEach(([key, value]) => { base[indexes[key]] = value; });
  return base;
};

test('acceptCoachActionは候補を再計算し、同日plannedをdismissして根拠スナップショットだけ保存する', () => {
  const harness = createHarness([row()]);
  const result = harness.context.acceptCoachAction({ scope: 'trend', range_days: 30, action_key: 'protein' });

  assert.equal(result.status, 'planned');
  assert.equal(result.text, pair.action.text);
  assert.equal(harness.rows[0][6], 'dismissed');
  assert.equal(harness.rows.length, 2);
  assert.equal(harness.rows[1][4], 'protein');
  assert.equal(harness.rows[1][5], pair.action.text);
  assert.deepEqual(JSON.parse(harness.rows[1][8]), pair.evidence);
  assert.equal(harness.getReleaseCount(), 1);
});

test('候補を再現できない場合はcoach_actionsへ書き込まない', () => {
  const harness = createHarness();
  assert.throws(
    () => harness.context.acceptCoachAction({ scope: 'trend', range_days: 30, action_key: 'missing' }),
    /再現できません/,
  );
  assert.equal(harness.rows.length, 0);
});

test('Script Lockを取得できない場合は更新せず再試行エラーを返す', () => {
  const harness = createHarness();
  harness.setLockAvailable(false);
  assert.throws(
    () => harness.context.acceptCoachAction({ scope: 'trend', range_days: 30, action_key: 'protein' }),
    /競合しました/,
  );
  assert.equal(harness.rows.length, 0);
  assert.equal(harness.getReleaseCount(), 0);
});

test('setCoachActionStatusはplannedだけを完了・見送りへ更新し、二重更新を拒否する', () => {
  const harness = createHarness([row()]);
  const result = harness.context.setCoachActionStatus('action_existing', 'completed');

  assert.equal(result.status, 'completed');
  assert.match(harness.rows[0][7], /^20/);
  assert.throws(() => harness.context.setCoachActionStatus('action_existing', 'dismissed'), /更新できません/);
});

test('期限切れplanned行動は読み取り時だけexpiredになる', () => {
  const harness = createHarness([row({ target_date: '2026-07-14' })]);
  const result = harness.context.findActiveCoachAction(harness.context.readCoachActionRecords(harness.context.getCoachActionsSheet()), '2026-07-15');

  assert.equal(result.status, 'expired');
  assert.equal(harness.rows[0][6], 'planned');
});
