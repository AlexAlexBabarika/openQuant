import type { OptionsAnalysis, OptionsExpiryPoint } from './optionsTypes';

export type OptionsComparisonSnapshot = Readonly<{
  id: string;
  capturedAt: string;
  label: string;
  source: string | null;
  result: OptionsAnalysis;
}>;
function freeze<T>(v: T): T {
  if (v && typeof v === 'object') {
    Object.values(v).forEach(freeze);
    Object.freeze(v);
  }
  return v;
}
export function comparisonSnapshot(
  id: string,
  result: OptionsAnalysis,
  source: string | null,
): OptionsComparisonSnapshot {
  return freeze({
    id,
    capturedAt: new Date().toISOString(),
    label: result.request.strategy.name,
    source,
    result: structuredClone(result),
  });
}
export function comparisonContext(item: OptionsComparisonSnapshot): string[] {
  const r = item.result,
    d = r.request,
    s = d.strategy;
  return [
    `Underlying ${s.underlying ?? 'not declared'} · submitted spot ${d.spot} USD`,
    `Declared IV ${d.volatility * 100}% · rate ${d.rate * 100}% · yield ${d.dividend_yield * 100}% (annual)`,
    `Enabled option IV fractions: ${s.legs.flatMap((l, i) => (l.enabled && l.kind !== 'underlying' ? [`leg ${i + 1}: ${l.implied_volatility ?? d.volatility}`] : [])).join('; ') || 'none'}`,
    `Fee ${s.entry_fee_per_contract} USD/option contract once · total ${r.summary.entry_fees} USD`,
    `Common expiry ${s.days_to_expiry} calendar days · valuation ${s.valuation_date ?? 'not declared'} · expiry ${s.expiry_date ?? 'not declared'}`,
    `${r.model.name} v${r.model.version} · ${r.model.day_basis} · ${r.model.input_source} · ${r.model.exercise_style} · ${r.model.settlement} · USD`,
  ];
}
/** No interpolation/fallback analytics: old responses lack canonical curve vertices. */
export function comparisonCurve(
  item: OptionsComparisonSnapshot,
): OptionsExpiryPoint[] | null {
  const curve = item.result.expiry_curve;
  const request = item.result.request;
  const spots = request.spot_grid;
  const min = spots[0],
    max = spots[spots.length - 1];
  const vertices = [
    ...new Set([
      min,
      max,
      ...request.strategy.legs
        .filter(l => l.enabled && l.strike !== null)
        .map(l => l.strike!),
      ...item.result.summary.breakevens,
    ]),
  ]
    .filter(spot => spot >= min && spot <= max)
    .sort((a, b) => a - b);
  if (
    !curve ||
    curve.length < 2 ||
    curve.length > 35 ||
    curve.length !== vertices.length ||
    curve.some(
      (p, i) =>
        !Number.isFinite(p.spot) ||
        !Number.isFinite(p.pnl) ||
        p.spot !== vertices[i] ||
        (i > 0 && p.spot <= curve[i - 1].spot),
    )
  )
    return null;
  return curve;
}
const cell = (v: string) => `"${v.replace(/"/g, '""')}"`;
export function optionsResultCsv(result: OptionsAnalysis): string {
  const rows = ['section,path,value'];
  const visit = (section: string, path: string, value: unknown) => {
    if (value !== null && typeof value === 'object') {
      const entries = Object.entries(value);
      if (!entries.length)
        rows.push([section, path, JSON.stringify(value)].map(cell).join(','));
      else
        entries.forEach(([k, v]) =>
          visit(section, path ? `${path}.${k}` : k, v),
        );
    } else {
      // JSON-quoted string values cannot become spreadsheet formulas.
      rows.push(
        [section, path, JSON.stringify(value) ?? 'null'].map(cell).join(','),
      );
    }
  };
  Object.entries(result).forEach(([k, v]) =>
    visit(k === 'request' ? 'submitted input' : 'canonical output', k, v),
  );
  return rows.join('\r\n') + '\r\n';
}
export function optionsResultReport(
  result: OptionsAnalysis,
  source: string | null,
  stdout: string | null,
): string {
  return JSON.stringify(
    {
      format: 'openquant-options-report',
      version: 1,
      exportedAt: new Date().toISOString(),
      provenance:
        'Manual/synthetic European cash-settled USD research. Not provider verified, brokerage execution or a server backup. Evidence from the submitted request, not current edits.',
      submittedSource: source,
      stdout,
      result,
    },
    null,
    2,
  );
}
