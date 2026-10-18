<script lang="ts">
  import type { OptionsAnalysis } from '$lib/features/options/optionsTypes';
  import { exactTerminalAvailable, exactValue } from '$lib/features/options/optionsChart';
  import { formatNumber, formatPrice, formatUsd } from '$lib/features/options/optionsFormat';

  let { result, stale = false, pending = false }: {
    result: Pick<OptionsAnalysis, 'request' | 'summary' | 'horizon'>;
    stale?: boolean;
    pending?: boolean;
  } = $props();
  const terminal = $derived(exactTerminalAvailable(result));
</script>

<section class="risk-summary" aria-label="Submitted options risk totals" class:stale>
  <header>
    <div><strong>{result.request.strategy.name}</strong><span>Submitted spot {formatPrice(result.request.spot)} USD · {terminal ? `${formatNumber(result.request.strategy.days_to_expiry)} default days` : `mixed expiry ${formatNumber(result.horizon?.first_expiry_days)}–${formatNumber(result.horizon?.last_expiry_days)} days`} · theoretical</span></div>
    <span class="status">{stale ? 'STALE INPUTS' : pending ? 'REFRESHING' : 'SUBMITTED EVIDENCE'}</span>
  </header>
  <dl>
    <div><dt>Entry debit · USD</dt><dd title={exactValue(result.summary.entry_debit)}>{formatUsd(result.summary.entry_debit)}</dd></div>
    <div><dt>Entry credit · USD</dt><dd title={exactValue(result.summary.entry_credit)}>{formatUsd(result.summary.entry_credit)}</dd></div>
    <div><dt>Expiry max profit · USD</dt><dd title={exactValue(result.summary.max_profit)}>{!terminal ? 'Unavailable · mixed expiry' : result.summary.profit_unbounded ? 'Unbounded' : formatUsd(result.summary.max_profit)}</dd></div>
    <div><dt>Expiry max loss · USD</dt><dd title={exactValue(result.summary.max_loss)}>{!terminal ? 'Unavailable · mixed expiry' : result.summary.loss_unbounded ? 'Unbounded' : formatUsd(result.summary.max_loss)}</dd></div>
    <div><dt>Today model P&amp;L · USD</dt><dd title={exactValue(result.summary.pnl_today)}>{formatUsd(result.summary.pnl_today, { signed: true })}</dd></div>
    <div><dt>Entry fees · USD</dt><dd title={exactValue(result.summary.entry_fees)}>{formatUsd(result.summary.entry_fees)}</dd></div>
  </dl>
</section>

<style>
  .risk-summary { position: sticky; top: 0; z-index: 2; min-width: 0; border: 1px solid oklch(var(--border)); border-radius: 4px; background: oklch(var(--card)); padding: 8px; margin-bottom: 12px; }
  .risk-summary.stale { border-style: dashed; }
  header { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 6px 12px; margin-bottom: 8px; }
  header > div { display: flex; flex-wrap: wrap; align-items: baseline; gap: 4px 10px; min-width: 0; }
  strong { font-size: 12px; overflow-wrap: anywhere; }
  header span { font-size: 11px; color: oklch(var(--muted-foreground)); overflow-wrap: anywhere; }
  dl { margin: 0; display: grid; grid-template-columns: repeat(6, minmax(0, 1fr)); gap: 8px; }
  dl > div { min-width: 0; padding-left: 8px; border-left: 1px solid oklch(var(--border)); }
  dt { font-size: 11px; color: oklch(var(--muted-foreground)); line-height: 1.4; }
  dd { margin: 4px 0 0; font: 13px var(--font-family-lato); font-variant-numeric: tabular-nums; overflow-wrap: anywhere; }
  @media (max-width: 1000px) { dl { grid-template-columns: repeat(3, minmax(0, 1fr)); } }
  @media (max-width: 420px) { dl { grid-template-columns: repeat(2, minmax(0, 1fr)); } .risk-summary { position: static; } }
  @media (max-height: 600px) { .risk-summary { position: static; } }
  @media (forced-colors: active) { .risk-summary, dl > div { border-color: CanvasText; } }
</style>
