<script lang="ts" module>
  import type { ParamSchemaEntry } from '$lib/features/sweep/types';
  export function describe(p: ParamSchemaEntry): string {
    if (p.kind === 'choice') return p.options.join(' | ');
    return `${p.low}…${p.high} step ${p.step}`;
  }
</script>

<script lang="ts">
  import { untrack } from 'svelte';
  import Play from '@lucide/svelte/icons/play';
  import { reconcileVariedParams } from '$lib/features/sweep/derive';
  import type { ParamSchema, SweepFormValues } from '$lib/features/sweep/types';

  let {
    schema,
    code,
    symbol = 'SPY',
    provider = 'yfinance',
    onsubmit,
    disabled = false,
    vary = $bindable<string[]>([]),
    search = $bindable<'grid' | 'random'>('grid'),
    metric = $bindable('sharpe'),
    nRandom = $bindable(200),
    seed = $bindable(0),
  }: {
    schema: ParamSchema;
    code: string;
    symbol?: string;
    provider?: string;
    onsubmit: (form: SweepFormValues) => void;
    disabled?: boolean;
    vary?: string[];
    search?: 'grid' | 'random';
    metric?: string;
    nRandom?: number;
    seed?: number;
  } = $props();

  const paramNames = $derived(Object.keys(schema));
  // Reconcile selections only when the declared parameters change.
  $effect(() => {
    vary = reconcileVariedParams(untrack(() => vary), paramNames);
  });

  function toggle(name: string) {
    vary = vary.includes(name) ? vary.filter(n => n !== name) : [...vary, name];
  }

  function submit() {
    if (disabled || vary.length === 0) return;
    onsubmit({
      code,
      symbol,
      provider,
      search,
      metric,
      vary,
      n_random: nRandom,
      seed,
    });
  }
</script>

<form class="form" onsubmit={e => (e.preventDefault(), submit())}>
  <fieldset class="params">
    <legend>Vary parameters</legend>
    {#each paramNames as name (name)}
      <label class="param">
        <input type="checkbox" checked={vary.includes(name)} onchange={() => toggle(name)} />
        <span class="pname">{name}</span>
        <span class="prange">{describe(schema[name])}</span>
      </label>
    {:else}
      <p class="hint">No parameters declared. Add a <code>params = {'{'}…{'}'}</code> block.</p>
    {/each}
  </fieldset>

  <fieldset class="search">
    <legend>Search</legend>
    <div class="row">
      <label>Search
        <select bind:value={search}>
          <option value="grid">Grid</option>
          <option value="random">Random</option>
        </select>
      </label>
      <label>Metric
        <select bind:value={metric}>
          <option value="sharpe">Sharpe</option>
          <option value="calmar">Calmar</option>
          <option value="sortino">Sortino</option>
          <option value="total_return">Total return</option>
        </select>
      </label>
      {#if search === 'random'}
        <label>Trials <input type="number" min="1" bind:value={nRandom} /></label>
      {/if}
      <label>Seed <input type="number" bind:value={seed} /></label>
      <button type="submit" class="btn primary run" disabled={disabled || vary.length === 0}>
        <Play class="h-3.5 w-3.5" />
        <span>run sweep</span>
      </button>
    </div>
  </fieldset>
</form>

<style>
  .form { display: flex; flex-direction: column; gap: 12px; padding: 12px 16px; }
  fieldset {
    display: flex;
    flex-direction: column;
    gap: 6px;
    margin: 0;
    min-width: 0;
    border: 1px dashed oklch(var(--border));
    border-radius: 8px;
    padding: 10px 12px;
  }
  legend {
    padding: 0 6px;
    font-size: 10px;
    letter-spacing: 0.16em;
    text-transform: uppercase;
    color: oklch(var(--muted-foreground));
  }
  .param { display: grid; grid-template-columns: auto 1fr auto; align-items: center; gap: 8px; font-size: 12px; }
  .pname { font-weight: 600; }
  .prange { color: oklch(var(--muted-foreground)); }
  .row { display: flex; flex-wrap: wrap; gap: 12px; align-items: end; }
  .row label { display: flex; flex-direction: column; gap: 4px; font-size: 11px; color: oklch(var(--muted-foreground)); }
  /* Match the portfolio tab's "run portfolio backtest" button (.btn.primary). */
  .btn {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 6px 12px;
    border-radius: 4px;
    border: 1px solid color-mix(in oklab, oklch(var(--border)) 100%, transparent);
    background: transparent;
    color: oklch(var(--foreground));
    font-family: inherit;
    font-size: 11.5px;
    letter-spacing: 0.04em;
    text-transform: lowercase;
    cursor: pointer;
    transition: all 120ms ease;
  }
  .btn:disabled {
    opacity: 0.45;
    cursor: not-allowed;
  }
  .btn.primary {
    background: oklch(var(--primary));
    border-color: oklch(var(--primary));
    color: oklch(var(--primary-foreground));
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.1em;
  }
  .btn.primary:hover:not(:disabled) {
    box-shadow: 0 6px 18px -6px
      color-mix(in oklab, oklch(var(--primary)) 60%, transparent);
    transform: translateY(-1px);
  }
  :global(html:not(.dark)) .btn {
    background: #ffffff;
    border-color: #000;
    color: #000;
  }
  :global(html:not(.dark)) .btn.primary {
    background: oklch(var(--primary));
    color: oklch(var(--primary-foreground));
  }
  .run {
    margin-left: auto;
  }
  .hint { font-size: 12px; color: oklch(var(--muted-foreground)); }
</style>
