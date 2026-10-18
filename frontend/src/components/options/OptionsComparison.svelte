<script lang="ts">
  import { comparisonContext, comparisonCurve, type OptionsComparisonSnapshot } from '$lib/features/options/optionsComparison';
  import { exactTerminalAvailable, exactValue, GREEK_KEYS, priceDomain, sampledYDomain, svgPath } from '$lib/features/options/optionsChart';
  let { items, onRemove }: { items: OptionsComparisonSnapshot[]; onRemove?: (id: string) => void } = $props();
  const curves = $derived(items.map(comparisonCurve));
  const x = $derived(priceDomain(curves.flatMap(c => c?.map(p => p.spot) ?? [])));
  const y = $derived(x ? sampledYDomain(curves.map(c => c?.map(p => ({ spot: p.spot, value: p.pnl })) ?? []), x) : null);
</script>

<section class="comparison" aria-label="Options submitted comparisons">
  <header><strong>Submitted comparisons</strong><span>Session only · up to 3 pins</span></header>
  <p>Immutable submitted evidence, not current working edits. Different underlying, spot, IV, fees, expiry, rate or model assumptions are not apples-to-apples. Expiry curves join canonical Python vertices only; no repricing or financial calculations occur here.</p>
  {#if !items.length}<p>No pins. Analyze explicitly, then pin submitted evidence from the library.</p>{/if}
  <div class="cards">
    {#each items as item, i (item.id)}
      <article>
        <header><strong>{item.label}</strong>{#if onRemove}<button type="button" class="ot-workbench-ghost" onclick={() => onRemove?.(item.id)} aria-label={`Unpin ${item.label}`}>Unpin</button>{/if}</header>
        <small>Pinned {item.capturedAt} · {item.source === null ? 'editor request' : 'Python request'}</small>
        <ul>{#each comparisonContext(item) as line}<li>{line}</li>{/each}</ul>
        <dl>
          <dt>Today P&amp;L at submitted spot (USD)</dt><dd>{exactValue(item.result.summary.pnl_today, true)}</dd>
          <dt>Entry cost incl. fees (signed USD)</dt><dd>{exactValue(item.result.summary.net_entry_cost, true)}</dd>
          <dt>Maximum expiry profit (USD)</dt><dd>{item.result.summary.profit_unbounded ? 'Unbounded' : exactValue(item.result.summary.max_profit)}</dd>
          <dt>Maximum expiry loss magnitude (USD)</dt><dd>{item.result.summary.loss_unbounded ? 'Unbounded' : exactValue(item.result.summary.max_loss)}</dd>
          <dt>Expiry breakeven spots (USD)</dt><dd>{!exactTerminalAvailable(item.result) ? 'Unavailable · mixed expiry' : item.result.summary.breakevens.map(v => exactValue(v)).join(', ') || 'None isolated'}</dd>
        </dl>
        <table><caption>Today Greeks at submitted spot · signed total exposure</caption><thead><tr><th scope="col">Greek / unit</th><th scope="col">Exact value</th></tr></thead><tbody>
          {#each GREEK_KEYS as greek}<tr><th scope="row">{greek} · {item.result.greek_units[greek]}</th><td>{exactValue(item.result.greeks[greek], true)}</td></tr>{/each}
        </tbody></table>
        {#if curves[i] && x && y}
          <svg viewBox="0 0 360 150" role="img" aria-label={`Canonical expiry P&L for ${item.label}. Spot ${x.min} to ${x.max} USD; signed P&L ${y.min} to ${y.max} USD. Exact vertices follow in the table.`}>
            <path d={svgPath(curves[i]!.map(p => ({ spot: p.spot, value: p.pnl })), x, y, 360, 8, 142)} />
          </svg>
          <p>Shared plot domain: spot {exactValue(x.min)}–{exactValue(x.max)} USD; signed P&amp;L {exactValue(y.min)}–{exactValue(y.max)} USD. Only each pin's submitted domain is drawn.</p>
          <!-- svelte-ignore a11y_no_noninteractive_tabindex (keyboard-scrollable data region) -->
          <div class="vertices" tabindex="0" role="region" aria-label={`Exact expiry vertices for ${item.label}`}>
            <table><caption>Canonical expiry vertices · exact signed USD (no rounding)</caption><thead><tr><th scope="col">Spot USD</th><th scope="col">P&amp;L USD</th></tr></thead><tbody>
              {#each curves[i]! as point}<tr><td>{exactValue(point.spot)}</td><td>{exactValue(point.pnl, true)}</td></tr>{/each}
            </tbody></table>
          </div>
        {:else}<p>Canonical expiry curve unavailable in this response; sampled arrays are not substituted.</p>{/if}
        {#each item.result.warnings as warning}<p>{warning}</p>{/each}
      </article>
    {/each}
  </div>
</section>

<style>
  .comparison { display: grid; gap: 8px; min-width: 0; }
  header { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
  .cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 260px), 1fr)); gap: 8px; }
  article { min-width: 0; display: flex; flex-direction: column; gap: 8px; padding: 8px; border: 1px solid oklch(var(--border)); border-radius: 4px; }
  p, small, li, caption { font-size: 12px; overflow-wrap: anywhere; color: oklch(var(--muted-foreground)); }
  p, ul, dl { margin: 0; }
  ul { padding-left: 16px; }
  dl { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 4px 8px; font-size: 12px; }
  dt, th { overflow-wrap: anywhere; }
  dd, td { margin: 0; font-family: var(--font-mono); font-variant-numeric: tabular-nums; text-align: right; overflow-wrap: anywhere; }
  dd { max-width: 140px; }
  table { width: 100%; border-collapse: collapse; font-size: 12px; }
  th, td { padding: 4px; border-bottom: 1px solid oklch(var(--border)); }
  th { text-align: left; font-weight: normal; }
  caption { text-align: left; }
  .vertices { max-height: 220px; overflow: auto; min-width: 0; }
  .vertices:focus-visible, button:focus-visible { outline: 2px solid oklch(var(--ring)); outline-offset: 2px; }
  svg { width: 100%; min-height: 100px; border: 1px solid oklch(var(--border)); }
  path { stroke: oklch(var(--foreground)); fill: none; stroke-width: 2px; }
  @media (forced-colors: active) { path { stroke: CanvasText; } button { border: 1px solid ButtonText; } }
</style>
