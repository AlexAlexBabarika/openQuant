import type { ResearchReview, RunSummary } from '../trial-report/types';
import type {
  WorkspaceContext,
  WorkspaceReport,
  WorkspaceSettings,
} from './workspace';
import { workspaceFingerprint } from './workspace';
import { validDataQuality } from '$lib/features/runs/dataQuality';

export const MAX_REVIEW_REASON = 2000;
export const MAX_SAVED_REPORT = 3_000_000;
export const emptyReview = (): ResearchReview => ({
  decision: 'unreviewed',
  reason: '',
});
export const reviewDecisions = [
  'unreviewed',
  'revise',
  'reject',
  'continue-research',
] as const;

export interface SavedReview {
  version: 1;
  account: string;
  received_at: string;
  input_fingerprint: string;
  context: Omit<WorkspaceContext, 'code'>;
  report: WorkspaceReport;
}

export interface ReviewStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export type RecoveryResult =
  | { status: 'ready'; saved: SavedReview | null }
  | { status: 'unavailable' | 'unreadable'; saved: null };

export function latestReviewKey(account: string): string {
  return `openquant:robustness-review:v1:account:${encodeURIComponent(account)}`;
}

export async function reviewInputFingerprint(
  context: WorkspaceContext,
  settings: WorkspaceSettings,
): Promise<string> {
  const bytes = new TextEncoder().encode(
    workspaceFingerprint(context, settings),
  );
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), byte =>
    byte.toString(16).padStart(2, '0'),
  ).join('');
}

const object = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);
const finite = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);
const text = (value: unknown): value is string => typeof value === 'string';
const texts = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every(text);
const date = (value: unknown): value is string =>
  text(value) && Number.isFinite(Date.parse(value));
const count = (value: unknown): value is number =>
  finite(value) && Number.isInteger(value) && value >= 0;
const only = (value: Record<string, unknown>, keys: string[]): boolean =>
  Object.keys(value).every(key => keys.includes(key));

function run(value: unknown): value is RunSummary {
  return (
    object(value) &&
    only(value, [
      'total_return',
      'max_drawdown',
      'trade_count',
      'total_cost',
      'equity',
    ]) &&
    finite(value.total_return) &&
    finite(value.max_drawdown) &&
    count(value.trade_count) &&
    finite(value.total_cost) &&
    Array.isArray(value.equity) &&
    value.equity.length <= 10_000 &&
    value.equity.every(
      point =>
        object(point) &&
        only(point, ['t', 'value']) &&
        finite(point.t) &&
        finite(point.value),
    )
  );
}

function walkForward(value: unknown): boolean {
  if (
    !object(value) ||
    !only(value, ['status', 'folds', 'assumption', 'limitation']) ||
    !['measured', 'inadequate-sample'].includes(String(value.status)) ||
    !text(value.assumption) ||
    !text(value.limitation) ||
    !Array.isArray(value.folds) ||
    value.folds.length !== 3
  )
    return false;
  return value.folds.every(
    (fold, index) =>
      object(fold) &&
      only(fold, [
        'id',
        'status',
        'train_start',
        'train_end',
        'training_bars',
        'validation_start',
        'validation_end',
        'validation_bars',
        'strategy',
        'benchmark',
      ]) &&
      fold.id === index + 1 &&
      fold.status === value.status &&
      [
        fold.train_start,
        fold.train_end,
        fold.validation_start,
        fold.validation_end,
      ].every(date) &&
      count(fold.training_bars) &&
      count(fold.validation_bars) &&
      (fold.status === 'measured'
        ? run(fold.strategy) && run(fold.benchmark)
        : fold.strategy === null && fold.benchmark === null),
  );
}

function regimes(value: unknown): boolean {
  if (
    !object(value) ||
    !only(value, [
      'status',
      'method',
      'threshold',
      'observations',
      'assumption',
      'limitation',
    ]) ||
    !['measured', 'inadequate-sample', 'unsupported-data'].includes(
      String(value.status),
    ) ||
    value.method !== 'validation-close-return-v1' ||
    value.threshold !== 0.05 ||
    !text(value.assumption) ||
    !text(value.limitation) ||
    !Array.isArray(value.observations) ||
    value.observations.length !== (value.status === 'measured' ? 3 : 0)
  )
    return false;
  return value.observations.every(
    (obs, index) =>
      object(obs) &&
      only(obs, ['fold_id', 'label', 'market_return']) &&
      obs.fold_id === index + 1 &&
      ['rising', 'falling', 'sideways'].includes(String(obs.label)) &&
      finite(obs.market_return),
  );
}

export function validReview(value: unknown): value is ResearchReview {
  return (
    object(value) &&
    only(value, ['decision', 'reason']) &&
    reviewDecisions.some(decision => decision === value.decision) &&
    text(value.reason) &&
    value.reason.length <= MAX_REVIEW_REASON
  );
}

export function validWorkspaceReport(value: unknown): value is WorkspaceReport {
  if (
    !object(value) ||
    !only(value, [
      'schema_version',
      'source',
      'report_id',
      'code_hash',
      'engine_version',
      'suite_version',
      'strategy',
      'dataset',
      'config',
      'baseline',
      'realistic',
      'benchmark',
      'holdout',
      'sensitivity',
      'selected_parameter',
      'findings',
      'assumptions',
      'limitations',
      'cost_stress',
      'research_review',
      'walk_forward',
      'regimes',
      'data_quality',
    ])
  )
    return false;
  if (
    (value.walk_forward != null && !walkForward(value.walk_forward)) ||
    (value.regimes != null && !regimes(value.regimes)) ||
    (value.data_quality != null && !validDataQuality(value.data_quality))
  )
    return false;
  if (
    value.schema_version !== 1 ||
    value.source !== 'workspace' ||
    !text(value.report_id) ||
    !text(value.code_hash) ||
    !text(value.engine_version) ||
    (value.suite_version != null && !text(value.suite_version)) ||
    !object(value.strategy) ||
    value.strategy.id !== 'workspace' ||
    !only(value.strategy, ['id', 'name', 'description', 'lesson']) ||
    ![
      value.strategy.name,
      value.strategy.description,
      value.strategy.lesson,
    ].every(text)
  )
    return false;
  const data = value.dataset,
    config = value.config;
  if (
    !object(data) ||
    !only(data, [
      'id',
      'version',
      'label',
      'synthetic',
      'start',
      'end',
      'split_date',
      'training_bars',
      'holdout_bars',
    ]) ||
    data.synthetic !== false ||
    ![data.id, data.version, data.label].every(text) ||
    ![data.start, data.end, data.split_date].every(date) ||
    !count(data.training_bars) ||
    !count(data.holdout_bars)
  )
    return false;
  if (
    !object(config) ||
    !only(config, [
      'strategy_id',
      'commission_bps',
      'slippage_bps',
      'starting_cash',
      'seed',
      'holdout_fraction',
      'params',
      'sensitivity_parameter',
    ]) ||
    config.strategy_id !== 'workspace' ||
    !finite(config.commission_bps) ||
    config.commission_bps < 0 ||
    config.commission_bps > 50 ||
    !finite(config.slippage_bps) ||
    config.slippage_bps < 0 ||
    config.slippage_bps > 50 ||
    !finite(config.starting_cash) ||
    config.starting_cash <= 0 ||
    config.starting_cash > 1e12 ||
    !count(config.seed) ||
    config.seed > 2 ** 32 - 1 ||
    !finite(config.holdout_fraction) ||
    config.holdout_fraction < 0.1 ||
    config.holdout_fraction > 0.5 ||
    (config.sensitivity_parameter !== null &&
      !text(config.sensitivity_parameter)) ||
    !object(config.params) ||
    Object.keys(config.params).length > 16 ||
    !Object.values(config.params).every(param => text(param) || finite(param))
  )
    return false;
  if (
    ![value.baseline, value.realistic, value.benchmark].every(run) ||
    !object(value.holdout) ||
    !only(value.holdout, ['strategy', 'benchmark']) ||
    !run(value.holdout.strategy) ||
    !run(value.holdout.benchmark)
  )
    return false;
  if (
    !Array.isArray(value.sensitivity) ||
    value.sensitivity.length > 3 ||
    !value.sensitivity.every(
      row =>
        object(row) &&
        only(row, ['parameter_value', 'total_return', 'max_drawdown']) &&
        (text(row.parameter_value) || finite(row.parameter_value)) &&
        finite(row.total_return) &&
        finite(row.max_drawdown),
    )
  )
    return false;
  if (
    value.selected_parameter !== null &&
    (!object(value.selected_parameter) ||
      !only(value.selected_parameter, ['name', 'value']) ||
      !text(value.selected_parameter.name) ||
      !(
        text(value.selected_parameter.value) ||
        finite(value.selected_parameter.value)
      ))
  )
    return false;
  if (
    !Array.isArray(value.findings) ||
    !value.findings.every(
      row =>
        object(row) &&
        only(row, ['id', 'severity', 'title', 'detail']) &&
        ['info', 'warning'].includes(String(row.severity)) &&
        [row.id, row.title, row.detail].every(text),
    ) ||
    !texts(value.assumptions) ||
    !texts(value.limitations)
  )
    return false;
  if (
    value.research_review !== undefined &&
    !validReview(value.research_review)
  )
    return false;
  if (value.cost_stress != null) {
    const stress = value.cost_stress;
    if (
      !object(stress) ||
      !only(stress, ['status', 'points', 'limitation']) ||
      !text(stress.limitation) ||
      !['measured', 'zero-cost'].includes(String(stress.status)) ||
      !Array.isArray(stress.points) ||
      stress.points.length !== 3 ||
      !stress.points.every(
        (point, index) =>
          object(point) &&
          only(point, [
            'multiplier',
            'commission_bps',
            'slippage_bps',
            'summary',
          ]) &&
          point.multiplier === index + 1 &&
          point.commission_bps ===
            (config.commission_bps as number) * (index + 1) &&
          point.slippage_bps ===
            (config.slippage_bps as number) * (index + 1) &&
          run(point.summary),
      )
    )
      return false;
    if (
      (stress.status === 'zero-cost') !==
        (config.commission_bps === 0 && config.slippage_bps === 0) ||
      JSON.stringify(stress.points[0].summary) !==
        JSON.stringify(value.realistic) ||
      (stress.status === 'zero-cost' &&
        stress.points.some(
          point =>
            JSON.stringify(point.summary) !== JSON.stringify(value.realistic) ||
            point.summary.total_cost !== 0,
        ))
    )
      return false;
  }
  return true;
}

function validSaved(value: unknown, account: string): value is SavedReview {
  if (
    !object(value) ||
    !only(value, [
      'version',
      'account',
      'received_at',
      'input_fingerprint',
      'context',
      'report',
    ]) ||
    value.version !== 1 ||
    value.account !== account ||
    !date(value.received_at) ||
    !text(value.input_fingerprint) ||
    !/^[a-f0-9]{64}$/.test(value.input_fingerprint) ||
    !object(value.context)
  )
    return false;
  return (
    only(value.context, ['name', 'symbol', 'provider', 'period', 'interval']) &&
    [
      value.context.name,
      value.context.symbol,
      value.context.provider,
      value.context.period,
      value.context.interval,
    ].every(text) &&
    validWorkspaceReport(value.report)
  );
}

export function loadLatestReview(
  storage: ReviewStorage,
  account: string | null,
): RecoveryResult {
  if (!account) return { status: 'ready', saved: null };
  let raw: string | null;
  try {
    raw = storage.getItem(latestReviewKey(account));
  } catch {
    return { status: 'unavailable', saved: null };
  }
  if (raw === null) return { status: 'ready', saved: null };
  try {
    const parsed: unknown =
      raw.length <= MAX_SAVED_REPORT ? JSON.parse(raw) : null;
    return validSaved(parsed, account)
      ? { status: 'ready', saved: parsed }
      : { status: 'unreadable', saved: null };
  } catch {
    return { status: 'unreadable', saved: null };
  }
}

export function saveLatestReview(
  storage: ReviewStorage,
  saved: SavedReview,
  currentAccount: () => string | null,
): 'saved' | 'obsolete' | 'unreadable' | 'unavailable' | 'too-large' {
  if (saved.account !== currentAccount()) return 'obsolete';
  const previous = loadLatestReview(storage, saved.account);
  if (previous.status !== 'ready') return previous.status;
  try {
    if (!validSaved(saved, saved.account)) return 'unreadable';
    const raw = JSON.stringify(saved);
    if (raw.length > MAX_SAVED_REPORT) return 'too-large';
    if (saved.account !== currentAccount()) return 'obsolete';
    storage.setItem(latestReviewKey(saved.account), raw);
    return 'saved';
  } catch {
    return 'unavailable';
  }
}

export function createReviewFence(currentAccount: () => string | null) {
  let generation = 0;
  return {
    invalidate() {
      generation += 1;
    },
    capture() {
      const account = currentAccount(),
        token = ++generation;
      return {
        account,
        current: () =>
          account !== null &&
          account === currentAccount() &&
          token === generation,
      };
    },
  };
}

export function restoredReviewIsStale(
  saved: SavedReview,
  fingerprint: string | null,
): boolean {
  return fingerprint === null || saved.input_fingerprint !== fingerprint;
}

export function selectSavedReview(
  saved: SavedReview | null,
  account: string | null,
): SavedReview | null {
  return account && saved && validSaved(saved, account)
    ? structuredClone(saved)
    : null;
}
