<!-- frontend/src/components/backtest/compare/TradesDiff.svelte -->
<script lang="ts">
  import type { TradesDiff, TradeDiffEntry, TradeKey } from '$lib/features/runs/runTypes';
  import { recordedValue } from './presentation';
  let { trades }: { trades: TradesDiff } = $props();
  const keyStr = (k: TradeKey) => k.map(value => value ?? 'Unavailable').join(' · ');
  const entryId = (entry: { key: TradeKey; occurrence?: number }) => JSON.stringify([entry.key, entry.occurrence ?? 1]);
</script>

{#snippet entries(rows: TradeDiffEntry[])}
  <ul class="text-sm">
    {#each rows as c (entryId(c))}
      <li class="border-b border-border/50 py-1">
        <span class="font-mono">{keyStr(c.key)} · occurrence {c.occurrence ?? 1}</span>
        {#each Object.entries(c.fields) as [field, d] (field)}
          <div class="ml-2 break-words text-xs text-muted-foreground">{field}: A {recordedValue(d.a, d.available?.a)} → B {recordedValue(d.b, d.available?.b)}{d.status === 'unavailable' || d.a == null || d.b == null ? ' · Not comparable' : ''}</div>
        {/each}
      </li>
    {/each}
  </ul>
{/snippet}

<section>
  <h3 class="mb-1 text-sm font-semibold">Observed trade path</h3>
  <p class="text-xs text-muted-foreground">Recorded count — A: {recordedValue(trades.count?.a)} · B: {recordedValue(trades.count?.b)}. Matching uses symbol, entry time, direction and occurrence in recorded order; it is not execution identity or causal attribution.</p>
  {#if trades.available?.a === false || trades.available?.b === false}
    <p class="text-sm text-muted-foreground">Trade path unavailable for run {trades.available.a === false ? 'A' : ''}{trades.available.a === false && trades.available.b === false ? ' and ' : ''}{trades.available.b === false ? 'B' : ''}; missing paths are not treated as zero trades.</p>
  {/if}
  <h3 class="mb-1 text-sm font-semibold">
    Matched changes {trades.changed.length} · same recorded fields {trades.unchanged.length} · incomplete fields {trades.unavailable?.length ?? 0} · only A {trades.only_in_a.length} · only B {trades.only_in_b.length}
  </h3>
  {#if trades.changed.length}
    <h4 class="mt-2 text-xs font-semibold text-muted-foreground">Changed</h4>
    {@render entries(trades.changed)}
  {/if}
  {#if trades.unavailable?.length}
    <h4 class="mt-2 text-xs font-semibold text-muted-foreground">Incomplete recorded fields — not comparable</h4>
    {@render entries(trades.unavailable)}
  {/if}
  {#if trades.only_in_a.length}
    <h4 class="mt-2 text-xs font-semibold text-muted-foreground">Only in A</h4>
    <ul class="text-sm">{#each trades.only_in_a as t (entryId(t))}<li class="py-0.5 font-mono"><details><summary class="cursor-pointer">{keyStr(t.key)} · occurrence {t.occurrence ?? 1}</summary><pre class="max-h-48 overflow-auto whitespace-pre-wrap break-all text-xs">{JSON.stringify(t.trade, null, 2)}</pre></details></li>{/each}</ul>
  {/if}
  {#if trades.only_in_b.length}
    <h4 class="mt-2 text-xs font-semibold text-muted-foreground">Only in B</h4>
    <ul class="text-sm">{#each trades.only_in_b as t (entryId(t))}<li class="py-0.5 font-mono"><details><summary class="cursor-pointer">{keyStr(t.key)} · occurrence {t.occurrence ?? 1}</summary><pre class="max-h-48 overflow-auto whitespace-pre-wrap break-all text-xs">{JSON.stringify(t.trade, null, 2)}</pre></details></li>{/each}</ul>
  {/if}
</section>
