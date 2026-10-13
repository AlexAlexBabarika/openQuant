import {
  apiFetch,
  getSessionGeneration,
  readErrorMessage,
} from '$lib/core/api';

export interface DataQualityIssue {
  code: string;
  message: string;
  column: string | null;
  count: number;
  rows: number[];
}

export interface DataQualityReport {
  errors: DataQualityIssue[];
  warnings: DataQualityIssue[];
  provenance: {
    provider: string;
    interval: string;
    data_version: string;
    row_count: number;
    start: string | null;
    end: string | null;
    timestamp_timezone: string | null;
    timestamp_unit: string | null;
    nominal_interval_seconds: number | null;
    calendar: 'unknown';
    adjustment: 'unknown';
    staleness: 'not_assessed';
    example_limit: number;
  };
}

export type QualityObserver = (report: DataQualityReport | null) => void;
const object = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v);
const only = (v: Record<string, unknown>, keys: string[]) =>
  Object.keys(v).every(k => keys.includes(k));
const text = (v: unknown) => typeof v === 'string';
const count = (v: unknown) =>
  typeof v === 'number' && Number.isSafeInteger(v) && v >= 0;

export function validDataQuality(value: unknown): value is DataQualityReport {
  if (!object(value) || !only(value, ['errors', 'warnings', 'provenance']))
    return false;
  const p = value.provenance;
  if (
    !object(p) ||
    !only(p, [
      'provider',
      'interval',
      'data_version',
      'row_count',
      'start',
      'end',
      'timestamp_timezone',
      'timestamp_unit',
      'nominal_interval_seconds',
      'calendar',
      'adjustment',
      'staleness',
      'example_limit',
    ]) ||
    ![p.provider, p.interval, p.data_version].every(text) ||
    !count(p.row_count) ||
    p.example_limit !== 5 ||
    ![p.start, p.end, p.timestamp_timezone, p.timestamp_unit].every(
      v => v === null || text(v),
    ) ||
    !(
      p.nominal_interval_seconds === null || count(p.nominal_interval_seconds)
    ) ||
    p.calendar !== 'unknown' ||
    p.adjustment !== 'unknown' ||
    p.staleness !== 'not_assessed'
  )
    return false;
  return [value.errors, value.warnings].every(
    items =>
      Array.isArray(items) &&
      items.length <= 100 &&
      items.every(
        i =>
          object(i) &&
          only(i, ['code', 'message', 'column', 'count', 'rows']) &&
          text(i.code) &&
          text(i.message) &&
          (i.column === null || text(i.column)) &&
          count(i.count) &&
          Array.isArray(i.rows) &&
          i.rows.length <= 5 &&
          i.rows.every(count),
      ),
  );
}

export async function runWithQuality<T>(
  path: string,
  params: Record<string, unknown>,
  signal?: AbortSignal,
  observe?: QualityObserver,
): Promise<T> {
  const generation = getSessionGeneration();
  const { symbol, provider, period = '1y', interval = '1d' } = params;
  const preview = await apiFetch(
    '/backtests/quality-preview',
    {
      method: 'POST',
      signal,
      body: JSON.stringify({ symbol, provider, period, interval }),
    },
    true,
  );
  if (generation !== getSessionGeneration() || signal?.aborted)
    throw new Error('Account changed or request cancelled. Run again.');
  let version: string | undefined;
  if (preview.ok) {
    const data = await preview.json();
    if (
      !validDataQuality(data.data_quality) ||
      typeof data.data_version !== 'string'
    )
      throw new Error('Unsupported quality preview.');
    observe?.(data.data_quality);
    if (data.data_quality.errors.length)
      throw new Error('Data quality errors block execution.');
    version = data.data_version;
  } else if (preview.status === 404) observe?.(null);
  else throw new Error(await readErrorMessage(preview));
  if (generation !== getSessionGeneration() || signal?.aborted)
    throw new Error('Account changed or request cancelled. Run again.');
  const response = await apiFetch(
    path,
    {
      method: 'POST',
      signal,
      body: JSON.stringify({
        ...params,
        ...(version ? { preview_data_version: version } : {}),
      }),
    },
    true,
  );
  if (!response.ok) {
    const data = await response
      .clone()
      .json()
      .catch(() => null);
    if (validDataQuality(data?.detail?.data_quality))
      observe?.(data.detail.data_quality);
    throw new Error(await readErrorMessage(response));
  }
  return (await response.json()) as T;
}
