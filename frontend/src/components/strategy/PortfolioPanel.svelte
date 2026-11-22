<script lang="ts" module>
  import type {
    PortfolioState,
    PortfolioRunContext,
  } from '$lib/features/portfolio/portfolioState.svelte';
  import { runsHistory, type RunsHistory } from '$lib/features/runs/runsHistory.svelte';

  export async function runAndRecord(
    portfolio: PortfolioState,
    code: string,
    context: PortfolioRunContext,
    history: Pick<RunsHistory, 'record'> & Partial<Pick<RunsHistory, 'accountVersion'>> = runsHistory,
  ): Promise<void> {
    if (portfolio.isRunning) return;
    const accountVersion = history.accountVersion;
    const result = await portfolio.run(code, context);
    const runId = result?.meta?.run_id;
    if (result && runId && accountVersion === history.accountVersion) {
      const label =
        result.symbols.length <= 3
          ? result.symbols.join(', ')
          : `${result.symbols.slice(0, 3).join(', ')}... (${result.symbols.length})`;
      history.record({
        run_id: runId,
        kind: 'portfolio',
        label,
        created_at: new Date().toISOString(),
      });
    }
  }
</script>

<script lang="ts">
  import Play from '@lucide/svelte/icons/play';
  import Database from '@lucide/svelte/icons/database';
  import X from '@lucide/svelte/icons/x';
  import PortfolioHoldings from './PortfolioHoldings.svelte';
  import WeightsHeatmap from './WeightsHeatmap.svelte';
  import RunIdChip from '../backtest/RunIdChip.svelte';
  import ErrorBanner from '../ErrorBanner.svelte';
  import { MAX_UNIVERSE_SYMBOLS } from '$lib/features/portfolio/universe';
  import type { MarketDataProviderValue } from '$lib/features/market/marketDataProviders';

  let {
    code,
    provider,
    period,
    interval,
    portfolio,
    onOpenRuns,
  }: {
    code: string;
    provider: MarketDataProviderValue;
    period: string;
    interval: string;
    portfolio: PortfolioState;
    onOpenRuns?: () => void;
  } = $props();

  let tickerInput = $state('');

  const result = $derived(portfolio.response);
  const metrics = $derived(result?.metrics ?? null);

  function addTickers() {
    if (!tickerInput.trim()) return;
    portfolio.add(tickerInput);
    tickerInput = '';
  }

  function onInputKey(e: KeyboardEvent) {
    if (e.key === 'Enter') {
      e.preventDefault();
      addTickers();
    }
  }

  async function runNow() {
    await runAndRecord(portfolio, code, { provider, period, interval });
  }

  async function ingestNow() {
    if (portfolio.isIngesting) return;
    await portfolio.ingest(interval);
  }

  const ingestSummary = $derived.by(() => {
    const r = portfolio.ingestReport;
    if (!r) return null;
    const names = Object.keys(r.rows_written);
    const rows = Object.values(r.rows_written).reduce((a, b) => a + b, 0);
    const dropped = Object.values(r.quarantined).reduce((a, b) => a + b, 0);
    return `ingested ${names.length} symbol${names.length === 1 ? '' : 's'} · ${rows} rows${dropped ? ` · ${dropped} dropped` : ''}`;
  });

  const pct = (x: number) => `${(x * 100).toFixed(2)}%`;
  const num = (x: number) => x.toFixed(2);
</script>

<div class="portfolio">
  <section class="card" aria-label="Universe builder">
    <header class="card-head">
      <span class="card-title">universe</span>
      <span class="count">{portfolio.symbols.length}/{MAX_UNIVERSE_SYMBOLS}</span>
      {#if portfolio.symbols.length > 0}
        <button type="button" class="linkbtn" onclick={() => portfolio.clear()}>
          clear
        </button>
      {/if}
    </header>

    <div class="universe-input">
      <input
        type="text"
        spellcheck="false"
        autocomplete="off"
        placeholder="paste tickers — AAPL, MSFT GOOG…"
        aria-label="Add tickers"
        bind:value={tickerInput}
        onkeydown={onInputKey}
      />
      <button
        type="button"
        class="btn ghost"
        onclick={addTickers}
        disabled={!tickerInput.trim()}
      >Add</button>
    </div>

    {#if portfolio.symbols.length === 0}
      <p class="hint">
        List or paste tickers above — the strategy's <code>ctx.universe</code>
        will contain exactly these symbols.
      </p>
    {:else}
      <p class="hint">
        Portfolio strategies are per-symbol:
        <code>ctx.position(symbol)</code>, <code>ctx.buy(symbol, qty)</code>,
        <code>ctx.target_weight(symbol, w)</code> + <code>ctx.rebalance()</code>
        — single-symbol code like <code>ctx.position.quantity</code> won't run
        here.
      </p>
    {/if}
    {#if portfolio.symbols.length > 0}
      <div class="chips" role="list" aria-label="Universe symbols">
        {#each portfolio.symbols as symbol (symbol)}
          <span class="chip" role="listitem">
            {symbol}
            <button
              type="button"
              class="chip-x"
              aria-label={`Remove ${symbol}`}
              onclick={() => portfolio.remove(symbol)}
            >
              <X class="h-2.5 w-2.5" />
            </button>
          </span>
        {/each}
      </div>
    {/if}

    <footer class="card-foot">
      {#if portfolio.ingestError}
        <ErrorBanner message={portfolio.ingestError} />
      {:else if ingestSummary}
        <span class="banner ok" role="status">{ingestSummary}</span>
      {/if}
      {#if portfolio.runError}
        <ErrorBanner message={portfolio.runError} />
      {/if}
      <button
        type="button"
        class="btn ghost"
        onclick={ingestNow}
        disabled={portfolio.isIngesting ||
          portfolio.isRunning ||
          portfolio.symbols.length === 0}
        title="Fetch & store market data for the universe so backtests find bars"
      >
        <Database class="h-3.5 w-3.5" />
        <span>{portfolio.isIngesting ? 'Ingesting…' : 'Ingest data'}</span>
      </button>
      <button
        type="button"
        class="btn primary"
        onclick={runNow}
        disabled={portfolio.isRunning || portfolio.symbols.length === 0}
      >
        <Play class="h-3.5 w-3.5" />
        <span>{portfolio.isRunning ? 'Running…' : 'Run portfolio backtest'}</span>
      </button>
    </footer>

    {#if portfolio.ingestReport && portfolio.ingestReport.gap_warnings.length > 0}
      <p class="hint">
        Data gaps detected — {portfolio.ingestReport.gap_warnings[0]}
        {#if portfolio.ingestReport.gap_warnings.length > 1}
          (+{portfolio.ingestReport.gap_warnings.length - 1} more)
        {/if}
      </p>
    {/if}
  </section>

  {#if result && metrics}
    <section class="card" aria-label="Portfolio run summary">
      <header class="card-head">
        <span class="card-title">last run</span>
        <span class="count">{result.symbols.length} symbols</span>
        {#if result.meta?.run_id}
          <RunIdChip runId={result.meta.run_id} onCompare={onOpenRuns} />
        {/if}
      </header>

      <div class="stats">
        <div class="stat">
          <span class="stat-label">total return</span>
          <span class="stat-value">{pct(metrics.portfolio.total_return)}</span>
        </div>
        <div class="stat">
          <span class="stat-label">portfolio sharpe</span>
          <span class="stat-value">{num(metrics.portfolio.sharpe)}</span>
        </div>
        <div class="stat">
          <span class="stat-label">max drawdown</span>
          <span class="stat-value">{pct(metrics.portfolio.max_drawdown)}</span>
        </div>
        <div class="stat">
          <span class="stat-label">turnover / yr</span>
          <span class="stat-value">{pct(metrics.turnover_annualized)}</span>
        </div>
        <div class="stat">
          <span class="stat-label">max single name</span>
          <span class="stat-value">{pct(metrics.max_single_name_weight)}</span>
        </div>
        <div class="stat">
          <span class="stat-label">trades</span>
          <span class="stat-value">{result.trades.length}</span>
        </div>
      </div>

      <div class="section" aria-label="Holdings and attribution">
        <span class="sharpes-title">holdings &amp; attribution</span>
        <PortfolioHoldings {result} />
      </div>

      <div class="section" aria-label="Weights over time">
        <span class="sharpes-title">weights over time</span>
        <WeightsHeatmap equity={result.equity} />
      </div>

      {#if result.constraint_events.length > 0}
        <div class="bindings" aria-label="Constraint bindings">
          <span class="sharpes-title">
            constraint bindings ({result.constraint_events.length})
          </span>
          <ul class="bindings-list">
            {#each result.constraint_events.slice(0, 20) as event, i (i)}
              <li>{event.detail}</li>
            {/each}
            {#if result.constraint_events.length > 20}
              <li class="dim">… and {result.constraint_events.length - 20} more</li>
            {/if}
          </ul>
        </div>
      {/if}
    </section>
  {/if}
</div>

<style>
  .portfolio {
    display: flex;
    flex-direction: column;
    gap: 14px;
    height: 100%;
    min-height: 0;
    overflow-y: auto;
    font-family: var(--font-mono);
  }

  .card {
    border: 1px solid oklch(var(--border));
    border-radius: 8px;
    background: color-mix(in oklab, oklch(var(--card)) 100%, black 3%);
    padding: 14px 16px;
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .card-head {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: var(--font-size-label);
    letter-spacing: var(--tracking-wide);
    text-transform: uppercase;
    color: oklch(var(--muted-foreground));
  }
  .card-title { font-weight: 600; color: oklch(var(--foreground)); }
  .count {
    padding: 1px 6px;
    border: 1px solid oklch(var(--border));
    border-radius: 999px;
    font-size: var(--font-size-annotation);
  }
  .linkbtn {
    margin-left: auto;
    border: 0;
    background: transparent;
    color: oklch(var(--muted-foreground));
    font-family: inherit;
    font-size: var(--font-size-annotation);
    letter-spacing: var(--tracking-label);
    cursor: pointer;
  }
  .linkbtn:hover { color: oklch(var(--foreground)); text-decoration: underline; }

  .universe-input {
    display: flex;
    gap: 8px;
  }
  .universe-input input {
    flex: 1 1 auto;
    min-width: 0;
    padding: 7px 10px;
    border: 1px solid oklch(var(--border));
    border-radius: var(--radius-md);
    background: oklch(var(--surface-sunken));
    color: oklch(var(--foreground));
    font-family: inherit;
    font-size: var(--font-size-chrome);
    letter-spacing: var(--tracking-label);
    outline: none;
    transition: border-color var(--motion-fast);
  }
  .universe-input input:focus {
    border-color: oklch(var(--primary-border));
  }

  .hint {
    margin: 0;
    font-size: var(--font-size-chrome);
    line-height: 1.5;
    color: oklch(var(--muted-foreground));
  }
  .hint code {
    font-size: var(--font-size-label);
    padding: 1px 4px;
    border: 1px solid oklch(var(--border));
    border-radius: var(--radius-sm);
  }

  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }
  .chip {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    padding: 3px 6px 3px 9px;
    border: 1px solid oklch(var(--border));
    border-radius: 999px;
    font-size: var(--font-size-label);
    font-weight: 600;
    letter-spacing: var(--tracking-label);
    color: oklch(var(--foreground));
    background: oklch(var(--surface-selected));
  }
  .chip-x {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 16px;
    height: 16px;
    border: 0;
    border-radius: 999px;
    background: transparent;
    color: oklch(var(--foreground-tertiary));
    cursor: pointer;
  }
  .chip-x:hover {
    color: oklch(var(--status-error));
    background: oklch(var(--status-error-wash));
  }

  .card-foot {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: 10px;
  }

  .banner {
    max-width: 480px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    padding: 4px 10px;
    border-radius: var(--radius-sm);
    font-size: var(--font-size-label);
  }
  .banner.ok {
    border: 1px solid oklch(var(--primary-border));
    background: oklch(var(--surface-selected));
    color: oklch(var(--foreground));
  }

  .btn {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 6px 12px;
    border-radius: var(--radius-md);
    border: 1px solid oklch(var(--border));
    background: transparent;
    color: oklch(var(--foreground));
    font-family: inherit;
    font-size: var(--font-size-chrome);
    letter-spacing: var(--tracking-label);
    cursor: pointer;
    transition: all var(--motion-fast);
  }
  .btn:disabled { opacity: var(--opacity-disabled); cursor: not-allowed; }
  .btn.ghost:hover:not(:disabled) {
    border-color: oklch(var(--border-strong));
    background: oklch(var(--surface-hover));
  }
  .btn.primary {
    background: oklch(var(--primary));
    border-color: oklch(var(--primary));
    color: oklch(var(--primary-foreground));
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: var(--tracking-label);
  }
  .btn.primary:hover:not(:disabled) {
    transform: translateY(-1px);
  }

  .stats {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
    gap: 10px;
  }
  .stat {
    display: flex;
    flex-direction: column;
    gap: 4px;
    padding: 10px 12px;
    border: 1px dashed oklch(var(--border));
    border-radius: var(--radius-lg);
  }
  .stat-label {
    font-size: var(--font-size-annotation);
    letter-spacing: var(--tracking-wide);
    text-transform: uppercase;
    color: oklch(var(--muted-foreground));
  }
  .stat-value {
    font-size: var(--font-size-title);
    font-weight: 600;
    color: oklch(var(--foreground));
  }

  .section {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .sharpes-title {
    font-size: var(--font-size-annotation);
    letter-spacing: var(--tracking-wide);
    text-transform: uppercase;
    color: oklch(var(--muted-foreground));
  }

  .bindings {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .bindings-list {
    margin: 0;
    padding-left: 18px;
    font-size: var(--font-size-label);
    line-height: 1.6;
    color: oklch(var(--muted-foreground));
  }
  .dim { color: oklch(var(--foreground-tertiary)); }

  /* Light theme, mirroring StrategyPanel chrome. */
  :global(html:not(.dark)) .card {
    background: oklch(var(--card));
    border-color: oklch(var(--foreground));
  }
  :global(html:not(.dark)) .universe-input input {
    background: oklch(var(--card));
    border-color: oklch(var(--foreground));
    color: oklch(var(--foreground));
  }
  :global(html:not(.dark)) .btn {
    background: oklch(var(--card));
    border-color: oklch(var(--foreground));
    color: oklch(var(--foreground));
  }
  :global(html:not(.dark)) .btn.ghost:hover:not(:disabled) {
    background: oklch(var(--foreground));
    color: oklch(var(--card));
  }
  :global(html:not(.dark)) .btn.primary {
    background: oklch(var(--primary));
    color: oklch(var(--primary-foreground));
  }
  :global(html:not(.dark)) .chip { border-color: oklch(var(--foreground)); color: oklch(var(--foreground)); }
  :global(html:not(.dark)) .count { border-color: oklch(var(--foreground)); color: oklch(var(--foreground)); }
  :global(html:not(.dark)) .stat { border-color: oklch(var(--foreground)); }
</style>
