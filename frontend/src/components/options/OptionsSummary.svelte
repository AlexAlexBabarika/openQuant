<script lang="ts">
  import type { OptionsAnalysis } from '$lib/features/options/optionsTypes';

  let { result, stale = false, pending = false }: {
    result: Pick<OptionsAnalysis, 'request' | 'summary'>;
    stale?: boolean;
    pending?: boolean;
  } = $props();

  function money(value: number | null, signed = false): string {
    if (value === null || !Number.isFinite(value)) return 'Unavailable';
    return new Intl.NumberFormat('en-US', {
      maximumSignificantDigits: 6,
      notation: value !== 0 && Math.abs(value) < 0.0001 ? 'scientific' : 'standard',
      signDisplay: signed ? 'exceptZero' : 'auto',
    }).format(value);
  }
</script>

<section class="risk-summary" aria-label="Submitted options risk totals" class:stale>
  <header>
    <div><strong>{result.request.strategy.name}</strong><span>Submitted spot {money(result.request.spot)} USD · {money(result.request.strategy.days_to_expiry)} days · manual</span></div>
    <span class="status">{stale ? 'STALE INPUTS' : pending ? 'REFRESHING' : 'SUBMITTED EVIDENCE'}</span>
  </header>
  <dl>
    <div><dt>Entry debit · USD</dt><dd>{money(result.summary.entry_debit)}</dd></div>
    <div><dt>Entry credit · USD</dt><dd>{money(result.summary.entry_credit)}</dd></div>
    <div><dt>Expiry max profit · USD</dt><dd>{result.summary.profit_unbounded ? 'Unbounded' : money(result.summary.max_profit)}</dd></div>
    <div><dt>Expiry max loss · USD</dt><dd>{result.summary.loss_unbounded ? 'Unbounded' : money(result.summary.max_loss)}</dd></div>
    <div><dt>Today model P&amp;L · USD</dt><dd>{money(result.summary.pnl_today, true)}</dd></div>
    <div><dt>Entry fees · USD</dt><dd>{money(result.summary.entry_fees)}</dd></div>
  </dl>
</section>

<style>
  .risk-summary { position: sticky; top: 0; z-index: 2; min-width: 0; border: 1px solid oklch(var(--border)); border-radius: 4px; background: oklch(var(--card)); padding: 8px; margin-bottom: 12px; }
  .risk-summary.stale { border-style: dashed; }
  header { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 6px 12px; margin-bottom: 8px; }
  header > div { display: flex; flex-wrap: wrap; align-items: baseline; gap: 4px 10px; min-width: 0; }
  strong { font-size: 12px; overflow-wrap: anywhere; }
  header span { font-size: 11px; color: oklch(var(--muted-foreground)); overflow-wrap: anywhere; }
  .status { font-family: var(--font-mono); }
  dl { margin: 0; display: grid; grid-template-columns: repeat(6, minmax(0, 1fr)); gap: 8px; }
  dl > div { min-width: 0; padding-left: 8px; border-left: 1px solid oklch(var(--border)); }
  dt { font-size: 11px; color: oklch(var(--muted-foreground)); line-height: 1.4; }
  dd { margin: 4px 0 0; font: 13px var(--font-mono); font-variant-numeric: tabular-nums; overflow-wrap: anywhere; }
  @media (max-width: 1000px) { dl { grid-template-columns: repeat(3, minmax(0, 1fr)); } }
  @media (max-width: 420px) { dl { grid-template-columns: repeat(2, minmax(0, 1fr)); } .risk-summary { position: static; } }
  @media (max-height: 600px) { .risk-summary { position: static; } }
  @media (forced-colors: active) { .risk-summary, dl > div { border-color: CanvasText; } }
</style>
