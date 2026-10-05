<script lang="ts">
  import { formatDate, formatMoney } from './evidence';
  import { isWorkspaceReport, type EvidenceReport } from './workspace';

  let { report, receivedAt }: { report: EvidenceReport; receivedAt: string } = $props();
</script>

<section class="report-context" aria-label="Completed report context">
  <p><strong>Completed report</strong> · {report.dataset.label}</p>
  <p>{formatDate(report.dataset.start)} — {formatDate(report.dataset.end)} UTC · {report.dataset.training_bars.toLocaleString('en-US')} earlier / {report.dataset.holdout_bars.toLocaleString('en-US')} holdout bars</p>
  <p>{report.config.commission_bps} bps commission / {report.config.slippage_bps} bps slippage per fill · {isWorkspaceReport(report) ? `${formatMoney(report.config.starting_cash, true)} currency units` : '$10,000'} starting cash</p>
  <details>
    <summary>Run provenance · {isWorkspaceReport(report) ? 'provider snapshot and source' : 'synthetic example'}</summary>
    <dl>
      <div><dt>Strategy used</dt><dd>{report.strategy.name}</dd></div>
      <div><dt>{isWorkspaceReport(report) ? 'Dataset SHA-256' : 'Dataset version'}</dt><dd>{report.dataset.version}</dd></div>
      {#if isWorkspaceReport(report)}
        <div><dt>Source SHA-256</dt><dd>{report.code_hash}</dd></div>
        <div><dt>Engine / seed</dt><dd>{report.engine_version} / {report.config.seed}</dd></div>
        <div><dt>Resolved parameters</dt><dd>{JSON.stringify(report.config.params)}</dd></div>
      {/if}
      <div><dt>Report ID</dt><dd>{report.report_id}</dd></div>
      <div><dt>Report received (UTC)</dt><dd>{receivedAt}</dd></div>
    </dl>
  </details>
</section>

<style>
  .report-context { border-left: 2px solid oklch(var(--border)); padding: 8px 12px; margin-bottom: 16px; font-size: 12px; line-height: 16px; color: oklch(var(--muted-foreground)); overflow-wrap: anywhere; }
  p + p, details { margin-top: 6px; }
  strong, summary { color: oklch(var(--foreground)); }
  summary { cursor: pointer; }
  summary:focus-visible { outline: 2px solid oklch(var(--ring)); outline-offset: 3px; }
  dl { display: grid; gap: 8px; margin-top: 12px; }
  dl > div { display: grid; grid-template-columns: minmax(100px, 1fr) minmax(0, 3fr); gap: 12px; }
  dd { color: oklch(var(--foreground)); font-family: var(--font-mono); }
  @media (max-width: 600px) { dl > div { grid-template-columns: minmax(0, 1fr); gap: 2px; } }
</style>
