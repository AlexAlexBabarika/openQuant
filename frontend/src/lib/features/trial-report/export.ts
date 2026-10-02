import { TRIAL_SHARE_NOTICE } from './sharing';
import type { RunSummary, TrialReport } from './types';

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, char => {
    switch (char) {
      case '&':
        return '&amp;';
      case '<':
        return '&lt;';
      case '>':
        return '&gt;';
      case '"':
        return '&quot;';
      default:
        return '&#39;';
    }
  });
}

const numberFormat = new Intl.NumberFormat('en-US', {
  maximumFractionDigits: 2,
});
const percentFormat = new Intl.NumberFormat('en-US', {
  style: 'percent',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

function number(value: number): string {
  return Number.isFinite(value)
    ? escapeHtml(numberFormat.format(value))
    : 'Unavailable';
}

function exactNumber(value: number): string {
  return Number.isFinite(value) ? escapeHtml(String(value)) : 'Unavailable';
}

function percent(value: number): string {
  return Number.isFinite(value)
    ? escapeHtml(percentFormat.format(value))
    : 'Unavailable';
}

function date(t: number): string {
  const value = new Date(t * 1000);
  return Number.isFinite(value.getTime())
    ? escapeHtml(value.toISOString().slice(0, 10))
    : 'Unavailable';
}

function metricRow(label: string, run: RunSummary): string {
  return `<tr><th scope="row">${escapeHtml(label)}</th><td>${percent(run.total_return)}</td><td>${percent(run.max_drawdown)}</td><td>${number(run.trade_count)}</td><td>${number(run.total_cost)}</td></tr>`;
}

function metrics(rows: [string, RunSummary][]): string {
  return `<div class="table-wrap"><table><thead><tr><th scope="col">Run</th><th scope="col">Total return</th><th scope="col">Max drawdown</th><th scope="col">Trades</th><th scope="col">Total cost (currency units)</th></tr></thead><tbody>${rows.map(([label, run]) => metricRow(label, run)).join('')}</tbody></table></div>`;
}

function list(items: string[]): string {
  return items.length
    ? `<ul>${items.map(item => `<li>${escapeHtml(item)}</li>`).join('')}</ul>`
    : '<p>None reported.</p>';
}

const curveColors = ['#075985', '#a33b09', '#6d28d9'];

function equityChart(title: string, runs: [string, RunSummary][]): string {
  let minT = Infinity,
    maxT = -Infinity,
    minValue = Infinity,
    maxValue = -Infinity;
  for (const [, run] of runs) {
    for (const point of run.equity) {
      if (!Number.isFinite(point.t) || !Number.isFinite(point.value)) continue;
      minT = Math.min(minT, point.t);
      maxT = Math.max(maxT, point.t);
      minValue = Math.min(minValue, point.value);
      maxValue = Math.max(maxValue, point.value);
    }
  }
  if (minT === Infinity)
    return '<p>No finite equity observations available.</p>';
  const project = (value: number, min: number, max: number): number => {
    if (min === max) return 0.5;
    const scale = Math.max(Math.abs(min), Math.abs(max));
    return (value / scale - min / scale) / (max / scale - min / scale);
  };
  const curves = runs
    .map(([label, run], index) => {
      let path = '',
        move = true;
      let observations = 0,
        lastX = '',
        lastY = '';
      for (const point of run.equity) {
        if (!Number.isFinite(point.t) || !Number.isFinite(point.value)) {
          move = true;
          continue;
        }
        const x = 72 + project(point.t, minT, maxT) * 616;
        const y = 24 + (1 - project(point.value, minValue, maxValue)) * 190;
        if (!Number.isFinite(x) || !Number.isFinite(y)) {
          move = true;
          continue;
        }
        path += `${move ? 'M' : 'L'}${x.toFixed(2)},${y.toFixed(2)} `;
        observations += 1;
        lastX = x.toFixed(2);
        lastY = y.toFixed(2);
        move = false;
      }
      return `<path d="${escapeHtml(path.trim())}" fill="none" stroke="${curveColors[index]}" stroke-width="2.5"${index === 2 ? ' stroke-dasharray="6 3"' : ''}><title>${escapeHtml(label)}</title></path>${observations === 1 ? `<circle cx="${escapeHtml(lastX)}" cy="${escapeHtml(lastY)}" r="3" fill="${curveColors[index]}"><title>${escapeHtml(label)}</title></circle>` : ''}`;
    })
    .join('');
  const invalid = runs.some(([, run]) =>
    run.equity.some(
      point => !Number.isFinite(point.t) || !Number.isFinite(point.value),
    ),
  );
  return `<figure><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 720 260" role="img" aria-label="${escapeHtml(title)}">
    <title>${escapeHtml(title)}</title><desc>Equity in currency units against UTC date. Lines use the measured report observations; each run retains its own funding.</desc>
    <path d="M72,24V214H688" fill="none" stroke="#64748b"/>
    <text x="68" y="28" text-anchor="end">${number(maxValue)}</text><text x="68" y="214" text-anchor="end">${number(minValue)}</text>
    <text x="72" y="242">${date(minT)}</text><text x="688" y="242" text-anchor="end">${date(maxT)}</text>${curves}
    </svg><figcaption>${runs.map(([label], index) => `<span class="legend"><i style="background:${curveColors[index]}"></i>${escapeHtml(label)}</span>`).join('')}</figcaption></figure>${invalid ? '<p>Invalid numeric observations were omitted; gaps are not connected.</p>' : ''}`;
}

export function trialReportFilename(report: TrialReport): string {
  const safe = (value: string): string =>
    value.replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 80) || 'report';
  return `openquant-trial-${safe(report.strategy.id)}-${safe(report.report_id)}.html`;
}

export function generateTrialReportHtml(report: TrialReport): string {
  const fullRuns: [string, RunSummary][] = [
    ['Baseline · frictionless', report.baseline],
    ['Strategy · chosen costs', report.realistic],
    ['Buy-and-hold benchmark · chosen costs', report.benchmark],
  ];
  const holdoutRuns: [string, RunSummary][] = [
    ['Holdout strategy · chosen costs', report.holdout.strategy],
    ['Holdout buy-and-hold · chosen costs', report.holdout.benchmark],
  ];
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'">
<title>${escapeHtml(report.strategy.name)} — Strategy on Trial snapshot</title>
<style>
  *{box-sizing:border-box}body{margin:0;background:#f4f1e9;color:#17212c;font:16px/1.6 system-ui,sans-serif}
  main{max-width:1060px;margin:2rem auto;padding:2rem;background:white;border:1px solid #d5d9dd;border-radius:12px}
  h1,h2,h3{line-height:1.2}h1{font-size:2.2rem}h2{margin-top:2rem;border-top:1px solid #d5d9dd;padding-top:1.4rem}
  .eyebrow{font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#075985}.notice{padding:1rem;background:#fff7e6;border-left:4px solid #a33b09}
  dt{font-weight:700}dd{margin:0 0 .7rem;overflow-wrap:anywhere}dl{display:grid;grid-template-columns:minmax(150px,1fr) 3fr;gap:.3rem 1rem}
  .table-wrap{overflow-x:auto}table{width:100%;border-collapse:collapse;margin:1rem 0}th,td{text-align:right;padding:.65rem;border-bottom:1px solid #d5d9dd;font-variant-numeric:tabular-nums}th:first-child{text-align:left}thead{background:#eef2f6}
  svg{display:block;width:100%;height:auto}svg text{font:11px system-ui,sans-serif;fill:#475569}figure{margin:1.3rem 0}figcaption{display:flex;flex-wrap:wrap;gap:.8rem;font-size:.85rem}.legend{display:inline-flex;align-items:center;gap:.4rem}.legend i{width:1rem;height:.2rem;display:inline-block}
  article{border-left:3px solid #d5d9dd;padding-left:1rem;margin:1.5rem 0}code{overflow-wrap:anywhere}p,li{overflow-wrap:anywhere}footer{border-top:1px solid #d5d9dd;margin-top:2rem;padding-top:1rem;color:#475569;font-size:.9rem}
  @media(max-width:650px){main{padding:1rem;margin:0;border-radius:0}dl{display:block}th,td{padding:.4rem;font-size:.85rem}}
  @media print{body{background:white;font-size:10pt}main{max-width:none;margin:0;padding:0;border:0}.table-wrap{overflow:visible}figure,article,tr{break-inside:avoid}h2,h3{break-after:avoid}.notice{border:1px solid #a33b09}}
</style></head><body><main>
<header><p class="eyebrow">OpenQuant · Strategy on Trial</p><h1>${escapeHtml(report.strategy.name)}</h1><p>The receipts, minus the victory lap.</p>
<p>${escapeHtml(report.strategy.description)}</p><p><strong>Lesson:</strong> ${escapeHtml(report.strategy.lesson)}</p></header>
<aside class="notice"><strong>Synthetic educational OHLCV scenario — not real market history.</strong>
<p>This developer-designed synthetic scenario is educational, not independent evidence of market alpha. Measured results are not certification or a promise of future performance.</p>
<p>This HTML is snapshot evidence of the supplied report. ${escapeHtml(TRIAL_SHARE_NOTICE)}</p></aside>
<section><h2>Configuration and provenance</h2><dl>
<dt>Report ID</dt><dd><code>${escapeHtml(report.report_id)}</code></dd>
<dt>Report schema</dt><dd>${number(report.schema_version)}</dd>
<dt>Strategy ID</dt><dd><code>${escapeHtml(report.config.strategy_id)}</code></dd>
<dt>Commission</dt><dd>${exactNumber(report.config.commission_bps)} bps</dd>
<dt>Slippage</dt><dd>${exactNumber(report.config.slippage_bps)} bps</dd>
<dt>Starting cash</dt><dd>10,000 currency units per independently funded run</dd>
<dt>Scenario</dt><dd>${escapeHtml(report.dataset.label)}</dd>
<dt>Dataset ID / version</dt><dd>${escapeHtml(report.dataset.id)} / ${escapeHtml(report.dataset.version)}</dd>
<dt>Period</dt><dd>${escapeHtml(report.dataset.start)} → ${escapeHtml(report.dataset.end)}</dd>
<dt>Chronological split</dt><dd>${escapeHtml(report.dataset.split_date)}</dd>
<dt>Training / holdout bars</dt><dd>${number(report.dataset.training_bars)} / ${number(report.dataset.holdout_bars)}</dd>
<dt>Selected parameter</dt><dd>${report.selected_parameter ? `${escapeHtml(report.selected_parameter.name)} = ${exactNumber(report.selected_parameter.value)} (selected using training only)` : 'None; no parameter selected.'}</dd>
</dl></section>
<section><h2>Full-period results</h2><p>All three runs use the same full scenario. Baseline is frictionless; strategy and buy-and-hold use the chosen commission and slippage.</p>
${metrics(fullRuns)}${equityChart('Full-period measured equity', fullRuns)}</section>
<section><h2>Untouched chronological holdout</h2><p>Strategy and benchmark use exactly the same holdout segment and chosen costs. Each starts with separate funding of 10,000 currency units. These curves are not stitched to the full-period curves.</p>
${metrics(holdoutRuns)}${equityChart('Separately funded holdout measured equity', holdoutRuns)}</section>
<section><h2>Parameter sensitivity on holdout</h2><p>Fixed neighboring parameters at the chosen costs. This is a holdout comparison, not a second parameter-selection step.</p>
${report.sensitivity.length ? `<div class="table-wrap"><table><thead><tr><th scope="col">Parameter value</th><th scope="col">Total return</th><th scope="col">Max drawdown</th></tr></thead><tbody>${report.sensitivity.map(row => `<tr><th scope="row">${exactNumber(row.parameter_value)}</th><td>${percent(row.total_return)}</td><td>${percent(row.max_drawdown)}</td></tr>`).join('')}</tbody></table></div>` : '<p>No parameter sensitivity reported.</p>'}</section>
<section><h2>Measured findings</h2>${report.findings.length ? report.findings.map(finding => `<article><p><strong>${escapeHtml(finding.severity)}</strong> · <code>${escapeHtml(finding.id)}</code></p><h3>${escapeHtml(finding.title)}</h3><p>${escapeHtml(finding.detail)}</p></article>`).join('') : '<p>No findings reported.</p>'}</section>
<section><h2>Assumptions</h2>${list(report.assumptions)}</section><section><h2>Limitations</h2>${list(report.limitations)}</section>
<footer>Metrics and equity are supplied by the existing backtest engine. Returns and drawdowns are displayed as percentages; costs and equity are in currency units. Displayed metrics are rounded to two decimals; configuration and parameter values retain their precision. Dates on charts are UTC. Non-finite numeric values are marked unavailable or omitted, never replaced with invented observations. This file requires no scripts or third-party resources.</footer>
</main></body></html>`;
}
