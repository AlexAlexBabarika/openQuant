<script lang="ts">
  import type { ResearchReview } from '../trial-report/types';
  import { isWorkspaceReport, type EvidenceReport } from './workspace';
  import RunMetrics from './RunMetrics.svelte';
  import DataQualityEvidence from '../../../components/backtest/DataQualityEvidence.svelte';
  import { formatDate, formatPercent } from './evidence';

  let { report, review, disabled = false, onreview }: {
    report: EvidenceReport;
    review: ResearchReview;
    disabled?: boolean;
    onreview: (review: ResearchReview) => void;
  } = $props();
  const id = $props.id();
  let stress = $derived(isWorkspaceReport(report) ? report.cost_stress : null);
  let walkForward = $derived(isWorkspaceReport(report) ? report.walk_forward : null);
  let regimes = $derived(isWorkspaceReport(report) ? report.regimes : null);
</script>

<section aria-labelledby={`${id}-heading`}>
  <h3 id={`${id}-heading`}>Staged research review · not a confidence score</h3>
  {#if isWorkspaceReport(report)}<DataQualityEvidence report={report.data_quality} />{/if}
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
  <h4>Walk-forward chronology · fixed parameters</h4>
  {#if walkForward}
    <p>{walkForward.assumption}</p>
    <p>{walkForward.limitation}</p>
    {#if walkForward.status === 'inadequate-sample'}
      <p>Inadequate sample: every validation window needs at least 20 bars. No fold was executed.</p>
    {/if}
    {#each walkForward.folds as fold (fold.id)}
      <details>
        <summary>Fold {fold.id} · {fold.status === 'measured' ? 'measured' : 'inadequate sample'}</summary>
        <p>Training context: <time datetime={fold.train_start}>{formatDate(fold.train_start)}</time> – <time datetime={fold.train_end}>{formatDate(fold.train_end)}</time> · {fold.training_bars} bars. No fitting or parameter selection.</p>
        <p>Validation: <time datetime={fold.validation_start}>{formatDate(fold.validation_start)}</time> – <time datetime={fold.validation_end}>{formatDate(fold.validation_end)}</time> · {fold.validation_bars} bars.</p>
        {#if fold.status === 'measured' && fold.strategy && fold.benchmark}
          <RunMetrics currencyUnits={true} caption={`Fold ${fold.id} validation · independently funded, configured costs, fixed parameters`} runs={[
            { label: 'Strategy', summary: fold.strategy },
            { label: 'Buy-and-hold', summary: fold.benchmark },
          ]} />
        {:else}
          <p>No measured strategy or benchmark summary for this fold.</p>
        {/if}
      </details>
    {/each}
  {:else}
    <p>Walk-forward evidence unavailable in this older report or synthetic example. A single holdout is not multiple-fold evidence.</p>
  {/if}
  <h4>Market regimes · retrospective daily trend</h4>
  {#if regimes}
    <p>{regimes.assumption}</p>
    <p>{regimes.limitation}</p>
    {#if regimes.status === 'measured'}
      <ul>
        {#each regimes.observations as observation (observation.fold_id)}
          {@const fold = walkForward?.folds.find(item => item.id === observation.fold_id)}
          <li>Fold {observation.fold_id} · {observation.label}: close-to-close market return {formatPercent(observation.market_return, true)}.
            {#if fold?.status === 'measured' && fold.strategy && fold.benchmark}
              Strategy {formatPercent(fold.strategy.total_return, true)} versus buy-and-hold {formatPercent(fold.benchmark.total_return, true)} on that same window. Full summaries above.
            {:else}
              Matching fold summary unavailable.
            {/if}
          </li>
        {/each}
      </ul>
    {:else if regimes.status === 'unsupported-data'}
      <p>Unsupported data: daily regime labels require 1d bars with supported daily cadence. No intraday sessions or regime outcomes were inferred.</p>
    {:else}
      <p>Inadequate sample: no daily regime outcomes were measured.</p>
    {/if}
  {:else}
    <p>Regime evidence unavailable in this older report or synthetic example. Missing checks are not resilience evidence.</p>
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
  details { margin: 8px 0; border: 1px solid oklch(var(--border)); padding: 8px; }
  summary { cursor: pointer; font-size: 12px; }
  summary:focus-visible { outline: 2px solid oklch(var(--primary)); outline-offset: 2px; }
  label { display: block; font-size: 11px; margin: 12px 0 6px; }
  select, textarea { width: 100%; font: inherit; color: oklch(var(--foreground)); background: oklch(var(--background)); border: 1px solid oklch(var(--input)); border-radius: 4px; padding: 6px 8px; }
  textarea { resize: vertical; }
  select:focus-visible, textarea:focus-visible { outline: 2px solid oklch(var(--primary)); outline-offset: 2px; }
</style>
