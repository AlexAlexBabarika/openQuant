import { LineStyle } from 'lightweight-charts';
import type { EquityOverlay } from '$lib/features/runs/runTypes';

export function recordedValue(value: unknown, available?: boolean): string {
  if (available === false || value === undefined || value === null)
    return 'Unavailable';
  if (typeof value === 'number' && !Number.isFinite(value))
    return 'Unavailable';
  return typeof value === 'string' ? value : JSON.stringify(value);
}

export function categories<T extends { category?: string }>(
  rows: T[],
  fallback: string,
): { label: string; rows: T[] }[] {
  const groups = new Map<string, T[]>();
  for (const row of rows) {
    const label = row.category ?? fallback;
    const group = groups.get(label) ?? [];
    group.push(row);
    groups.set(label, group);
  }
  return Array.from(groups, ([label, rows]) => ({ label, rows }));
}

export function equityComparisonLines(overlay: EquityOverlay) {
  return [
    { data: overlay.a, color: '#3b82f6', lineStyle: LineStyle.Solid },
    { data: overlay.b, color: '#f59e0b', lineStyle: LineStyle.Dashed },
  ];
}

export function observedRange(points: EquityOverlay['a']): string {
  if (!points.length) return 'No recorded points';
  const date = (t: number) => new Date(t * 1000).toISOString();
  return `${date(points[0].t)} → ${date(points[points.length - 1].t)} (UTC)`;
}
