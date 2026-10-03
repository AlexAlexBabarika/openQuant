import { METRIC_GROUPS } from '$lib/features/backtest/metricDefs';

export interface HeatmapScale {
  min: number;
  max: number;
  state: 'missing' | 'constant' | 'range';
}

export function heatmapScale(cells: (number | null)[][]): HeatmapScale {
  let min = Infinity;
  let max = -Infinity;
  for (const row of cells) {
    for (const value of row) {
      if (value == null || !Number.isFinite(value)) continue;
      min = Math.min(min, value);
      max = Math.max(max, value);
    }
  }
  return {
    min,
    max,
    state: min === Infinity ? 'missing' : min === max ? 'constant' : 'range',
  };
}

export function heatmapColor(
  value: number | null,
  scale: HeatmapScale,
): string {
  if (value == null || !Number.isFinite(value) || scale.state === 'missing') {
    return 'transparent';
  }
  const t =
    scale.state === 'constant'
      ? 0.5
      : Math.max(0, Math.min(1, (value - scale.min) / (scale.max - scale.min)));
  return `oklch(0.6 0.15 ${250 - 250 * t})`;
}

export function heatmapLegend(scale: HeatmapScale) {
  if (scale.state === 'missing') return [];
  const positions =
    scale.state === 'constant' ? [0.5] : [0, 0.25, 0.5, 0.75, 1];
  return positions.map(position => {
    const value = scale.min + (scale.max - scale.min) * position;
    return { position, value, color: heatmapColor(value, scale) };
  });
}

export function heatmapMetric(metric: string) {
  const spec = METRIC_GROUPS.flatMap(group => group.metrics).find(
    s => s.key === metric,
  );
  const kind = spec?.kind;
  const unit =
    kind === 'pct' || kind === 'signedPct'
      ? 'fraction (1 = 100%)'
      : kind === 'ratio'
        ? 'ratio (unitless)'
        : kind === 'currency'
          ? 'USD'
          : kind === 'bars'
            ? 'bars'
            : kind === 'int'
              ? 'count'
              : 'raw units';
  return { label: spec?.label ?? metric, unit };
}

export function heatmapValue(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return '—';
  return value > 0 ? `+${value}` : String(value);
}

export function heatmapCellLabel(
  metric: string,
  value: number | null,
  xParam: string,
  x: number,
  yParam: string,
  y: number,
): string {
  const { label, unit } = heatmapMetric(metric);
  const result =
    value == null || !Number.isFinite(value)
      ? 'no result'
      : `${heatmapValue(value)} ${unit}`;
  return `${label}: ${result}; ${xParam}=${x}; ${yParam}=${y}`;
}
