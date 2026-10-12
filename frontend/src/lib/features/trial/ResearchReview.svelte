<script lang="ts">
  import type { ResearchReview } from '../trial-report/types';
  import { isWorkspaceReport, type EvidenceReport } from './workspace';
  import RunMetrics from './RunMetrics.svelte';
  import { formatPercent } from './evidence';

  let { report, review, disabled = false, onreview }: {
    report: EvidenceReport;
    review: ResearchReview;
    disabled?: boolean;
    onreview: (review: ResearchReview) => void;
  } = $props();
  const id = $props.id();
  let stress = $derived(isWorkspaceReport(report) ? report.cost_stress : null);
</script>

<section aria-labelledby={`${id}-heading`}>
  <h3 id={`${id}-heading`}>Staged research review · not a confidence score</h3>
  <ol>
    <li><strong>Context and assumptions.</strong> Review the original receipt, data dates, source/engine/data identities and assumptions below. A content identity does not establish data quality.</li>
    <li><strong>Baseline and configured costs.</strong> Frictionless return {formatPercent(report.baseline.total_return, true)}; configured-cost return {formatPercent(report.realistic.total_return, true)}. Costs may change decisions and fills.</li>
    <li><strong>Cost stress.</strong> Only the workspace suite supplies bounded full-period 1×/2×/3× cost checks; inspect measured outcomes, not a pass score.</li>
    <li><strong>Chronology and sensitivity.</strong> Holdout return {formatPercent(report.holdout.strategy.total_return, true)} versus benchmark {formatPercent(report.holdout.benchmark.total_return, true)}. Neighbor comparisons reuse holdout; repeatedly inspected dates are not independent out-of-sample evidence.</li>
    <li><strong>Findings and decision.</strong> Review measured failures and limitations before recording a research-only conclusion. This does not authorize trading or recommend buying/selling.</li>
  </ol>
  <h4>Full-period cost stress</h4>
  {#if stress}
    <p>{stress.limitation}</p>
    <RunMetrics currencyUnits={true} caption="Same snapshotted bars, source, seed, parameters and funding; 1× reuses configured result" runs={stress.points.map(point => ({
      label: `${point.multiplier}× · ${point.commission_bps} bps commission / ${point.slippage_bps} bps slippage`,
      summary: point.summary,
    }))} />
  {:else}
    <p>Cost-stress evidence unavailable in this older report or synthetic example. No resilience conclusion can be inferred from missing checks.</p>
  {/if}
  <label for={`${id}-decision`}>Research decision</label>
  <select id={`${id}-decision`} value={review.decision} {disabled} onchange={event => onreview({ ...review, decision: event.currentTarget.value as ResearchReview['decision'] })}>
    <option value="unreviewed">Not reviewed</option>
    <option value="revise">Revise assumptions / strategy</option>
    <option value="reject">Reject this research setup</option>
    <option value="continue-research">Continue research · not approval to trade</option>
  </select>
  <label for={`${id}-reason`}>Reason / next research step (up to 2,000 characters)</label>
  <textarea id={`${id}-reason`} rows="3" maxlength="2000" value={review.reason} {disabled} oninput={event => onreview({ ...review, reason: event.currentTarget.value })}></textarea>
</section>

<style>
  section { border: 1px solid oklch(var(--border)); padding: 12px; margin-bottom: 16px; }
  h3, h4 { font: 700 14px/20px var(--font-family-lato); margin: 0 0 10px; }
  ol { padding-left: 20px; }
  li + li { margin-top: 8px; }
  p, li { color: oklch(var(--muted-foreground)); }
  label { display: block; font-size: 11px; margin: 12px 0 6px; }
  select, textarea { width: 100%; font: inherit; color: oklch(var(--foreground)); background: oklch(var(--background)); border: 1px solid oklch(var(--input)); border-radius: 4px; padding: 6px 8px; }
  textarea { resize: vertical; }
  select:focus-visible, textarea:focus-visible { outline: 2px solid oklch(var(--primary)); outline-offset: 2px; }
</style>
