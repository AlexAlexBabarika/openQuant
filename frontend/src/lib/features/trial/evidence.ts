export interface EquityPoint {
  t: number;
  value: number;
}

export interface ChartBounds {
  start: number;
  end: number;
  min: number;
  max: number;
}

const money = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 2,
});

export function formatMoney(value: number): string {
  return Number.isFinite(value) ? money.format(value) : '—';
}

export function formatPercent(value: number, signed = false): string {
  if (!Number.isFinite(value)) return '—';
  const rounded = Math.round(value * 10000) / 100;
  return `${signed && rounded > 0 ? '+' : ''}${rounded.toFixed(2)}%`;
}

export function formatDate(value: string | number): string {
  const date = new Date(typeof value === 'number' ? value * 1000 : value);
  if (!Number.isFinite(date.getTime())) return '—';
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

export function validCost(value: number | undefined): value is number {
  return (
    value !== undefined && Number.isFinite(value) && value >= 0 && value <= 50
  );
}

export function chartBounds(
  series: readonly (readonly EquityPoint[])[],
): ChartBounds | null {
  let start = Infinity;
  let end = -Infinity;
  let min = Infinity;
  let max = -Infinity;
  for (const points of series) {
    for (const point of points) {
      if (!Number.isFinite(point.t) || !Number.isFinite(point.value)) continue;
      start = Math.min(start, point.t);
      end = Math.max(end, point.t);
      min = Math.min(min, point.value);
      max = Math.max(max, point.value);
    }
  }
  if (!Number.isFinite(start)) return null;
  const padding = Math.max((max - min) * 0.1, Math.abs(max) * 0.01, 1);
  return {
    start,
    end: end === start ? start + 1 : end,
    min: min - padding,
    max: max + padding,
  };
}

export function chartX(t: number, bounds: ChartBounds, width = 960): number {
  return (
    78 + ((t - bounds.start) / (bounds.end - bounds.start)) * (width - 108)
  );
}

export function chartY(value: number, bounds: ChartBounds): number {
  return 292 - ((value - bounds.min) / (bounds.max - bounds.min)) * 250;
}

export function equityPath(
  points: readonly EquityPoint[],
  bounds: ChartBounds,
  width = 960,
): string {
  let connected = false;
  return points
    .map(point => {
      if (!Number.isFinite(point.t) || !Number.isFinite(point.value)) {
        connected = false;
        return '';
      }
      const command = connected ? 'L' : 'M';
      connected = true;
      return `${command}${chartX(point.t, bounds, width).toFixed(2)},${chartY(point.value, bounds).toFixed(2)}`;
    })
    .filter(Boolean)
    .join(' ');
}

export function finalEquity(points: readonly EquityPoint[]): string {
  return points.length
    ? formatMoney(points[points.length - 1].value)
    : 'No equity data';
}
