<script lang="ts">
  import type { RunResult, ScriptOutput } from '$lib/features/indicators/scripts';

  let {
    result,
    runError,
    isRunning,
    projected = false,
  }: {
    result: RunResult | null;
    runError: string | null;
    isRunning: boolean;
    projected?: boolean;
  } = $props();

  function fmtCell(v: unknown): string {
    if (v === null || v === undefined) return '·';
    if (typeof v === 'number') {
      if (Number.isInteger(v)) return v.toString();
      return v.toFixed(4).replace(/0+$/, '').replace(/\.$/, '');
    }
    return String(v);
  }

  // Group outputs by visual section so we can render them in a stable order
  // regardless of script-emit order: text/error first, then tables, then a
  // structural summary of overlays/panes/markers/histograms.
  type Bucket = {
    text: Extract<ScriptOutput, { type: 'text' }>[];
    tables: Extract<ScriptOutput, { type: 'table' }>[];
    deferred: ScriptOutput[];
  };
  let bucket = $derived.by<Bucket>(() => {
    const b: Bucket = { text: [], tables: [], deferred: [] };
    for (const o of result?.outputs ?? []) {
      if (o.type === 'text') b.text.push(o);
      else if (o.type === 'table') b.tables.push(o);
      else b.deferred.push(o);
    }
    return b;
  });

  function deferredLabel(o: ScriptOutput): string {
    switch (o.type) {
      case 'overlay':
        return `overlay · ${o.title} · ${o.data.length} pts`;
      case 'pane':
        return `pane · ${o.title} · ${o.data.length} pts`;
      case 'markers':
        return `markers · ${o.data.length} pts`;
      case 'histogram':
        return `histogram · ${o.title} · ${o.data.length} pts`;
      default:
        return o.type;
    }
  }
</script>

<section class="console" aria-label="Script output console">
  <header class="status">
    {#if isRunning}
      <span class="dot dot-running" aria-hidden="true"></span>
      <span class="label">RUNNING</span>
      <span class="meta"><span class="ellipsis">working</span></span>
    {:else if runError}
      <span class="dot dot-err" aria-hidden="true"></span>
      <span class="label tone-err">REQUEST FAILED</span>
      <span class="meta">{runError}</span>
    {:else if result}
      <span
        class="dot"
        class:dot-ok={result.status === 'ok'}
        class:dot-warn={result.status === 'timeout'}
        class:dot-err={result.status === 'error' || result.status === 'killed'}
        aria-hidden="true"
      ></span>
      <span
        class="label"
        class:tone-ok={result.status === 'ok'}
        class:tone-err={result.status === 'error' || result.status === 'killed'}
        class:tone-warn={result.status === 'timeout'}
      >
        {result.status.toUpperCase()}
      </span>
      <span class="meta">
        ran in <span class="num">{result.elapsed_ms}</span>ms ·
        <span class="num">{result.outputs.length}</span> output{result.outputs.length === 1
          ? ''
          : 's'}
      </span>
    {:else}
      <span class="dot dot-idle" aria-hidden="true"></span>
      <span class="label tone-muted">IDLE</span>
      <span class="meta">press <kbd>⌘</kbd><kbd>↵</kbd> to run</span>
    {/if}
  </header>

  <div class="scroll">
    {#if !result && !runError && !isRunning}
      <div class="empty">
        <p class="empty-line">// no output yet</p>
        <p class="empty-line muted">
          // emit text via <span class="ink">display.text("…")</span>
        </p>
        <p class="empty-line muted">
          // emit a table via <span class="ink">display.table(cols, rows)</span>
        </p>
        <p class="empty-line muted">
          // save and start to project overlays onto the chart
        </p>
      </div>
    {/if}

    {#if result?.stderr && result.status !== 'ok'}
      <div class="block traceback">
        <div class="block-head">
          <span class="prefix">✕</span>
          <span class="block-title">traceback</span>
        </div>
        <pre class="trace">{result.stderr}</pre>
      </div>
    {/if}

    {#each bucket.text as line, i (i)}
      <div class="block text-line tone-{line.level}">
        <span class="prefix">
          {#if line.level === 'error'}✕{:else if line.level === 'warn'}!{:else}›{/if}
        </span>
        <span class="text">{line.text}</span>
      </div>
    {/each}

    {#if result?.stdout}
      <div class="block stdout">
        <div class="block-head">
          <span class="prefix">›</span>
          <span class="block-title">stdout</span>
        </div>
        <pre class="trace">{result.stdout}</pre>
      </div>
    {/if}

    {#each bucket.tables as table, i (i)}
      <div class="block table-block">
        <div class="block-head">
          <span class="prefix">▤</span>
          <span class="block-title">table · {table.rows.length} row{table.rows.length === 1 ? '' : 's'}</span>
        </div>
        <div class="table-scroll">
          <table>
            <thead>
              <tr>
                {#each table.columns as col}
                  <th>{col}</th>
                {/each}
              </tr>
            </thead>
            <tbody>
              {#each table.rows as row}
                <tr>
                  {#each row as cell}
                    <td>{fmtCell(cell)}</td>
                  {/each}
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
      </div>
    {/each}

    {#if bucket.deferred.length > 0}
      <div class="block deferred">
        <div class="block-head">
          <span class="prefix">◌</span>
          <span class="block-title">chart outputs · {projected ? 'projected onto chart' : 'save and start to project'}</span>
        </div>
        <ul class="deferred-list">
          {#each bucket.deferred as o, i (i)}
            <li>{deferredLabel(o)}</li>
          {/each}
        </ul>
      </div>
    {/if}
  </div>
</section>

<style>
  .console {
    display: flex;
    flex-direction: column;
    height: 100%;
    min-height: 0;
    background: oklch(var(--surface-sunken));
    border-top: 1px solid oklch(var(--border-subtle));
    font-family: var(--font-mono);
    color: oklch(var(--foreground));
  }
  :global(html:not(.dark)) .console {
    background: oklch(var(--card));
    border-top: 1px solid oklch(var(--foreground));
  }

  .status {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 10px 16px;
    font-size: var(--font-size-label);
    letter-spacing: var(--tracking-label);
    border-bottom: 1px dashed
      color-mix(in oklab, oklch(var(--border)) 80%, transparent);
    background: oklch(var(--surface-sunken));
  }
  :global(html:not(.dark)) .status {
    background: oklch(var(--card));
    border-bottom: 1px dashed oklch(var(--foreground));
  }
  :global(html:not(.dark)) .meta { color: oklch(var(--foreground)); opacity: 0.7; }
  :global(html:not(.dark)) .tone-ok { color: oklch(var(--primary)); }
  :global(html:not(.dark)) .tone-err,
  :global(html:not(.dark)) .text-line.tone-error,
  :global(html:not(.dark)) .text-line.tone-error .prefix {
    color: oklch(var(--destructive));
  }
  :global(html:not(.dark)) .meta kbd {
    background: oklch(var(--card));
    border-color: oklch(var(--foreground));
    color: oklch(var(--foreground));
  }
  :global(html:not(.dark)) .empty-line .ink {
    background: oklch(var(--card));
    color: oklch(var(--foreground));
    border: 1px solid oklch(var(--foreground));
  }
  :global(html:not(.dark)) .block-title { color: oklch(var(--foreground)); opacity: 1; }
  :global(html:not(.dark)) .trace {
    background: oklch(var(--card));
    border-left: 2px solid oklch(var(--foreground));
    color: oklch(var(--foreground));
  }
  :global(html:not(.dark)) .table-block .table-scroll {
    background: oklch(var(--card));
    border-color: oklch(var(--foreground));
  }
  :global(html:not(.dark)) th {
    background: oklch(var(--card));
    color: oklch(var(--foreground));
    border-bottom: 1px solid oklch(var(--foreground));
  }
  :global(html:not(.dark)) tbody tr:nth-child(odd) td { background: oklch(var(--card)); }
  :global(html:not(.dark)) tbody tr:hover td {
    background: color-mix(in oklab, oklch(var(--primary)) 12%, oklch(var(--card)));
  }
  :global(html:not(.dark)) .deferred .deferred-list {
    border-color: oklch(var(--foreground));
    color: oklch(var(--foreground));
  }
  .dot {
    width: 8px;
    height: 8px;
    border-radius: 999px;
    background: oklch(var(--muted-foreground));
    box-shadow: 0 0 0 0 transparent;
  }
  .dot-running {
    background: oklch(var(--status-warn));
    animation: pulse 1.1s ease-in-out infinite;
  }
  .dot-ok {
    background: oklch(var(--status-ok));
    box-shadow: 0 0 8px color-mix(in oklab, oklch(var(--status-ok)) 60%, transparent);
  }
  .dot-warn { background: oklch(var(--status-warn)); }
  .dot-err  { background: oklch(var(--status-error)); }
  .dot-idle {
    background: transparent;
    border: 1px dashed oklch(var(--border-strong));
  }

  .label { font-weight: 600; }
  .tone-ok { color: oklch(var(--status-ok)); }
  .tone-err { color: oklch(var(--status-error)); }
  .tone-warn { color: oklch(var(--status-warn)); }
  .tone-muted { color: oklch(var(--muted-foreground)); }

  .meta {
    color: oklch(var(--muted-foreground));
    font-size: var(--font-size-label);
    text-transform: lowercase;
    letter-spacing: var(--tracking-label);
  }
  .meta .num {
    color: oklch(var(--foreground));
    font-variant-numeric: tabular-nums;
  }
  .meta kbd {
    display: inline-block;
    padding: 0 5px;
    margin: 0 1px;
    border: 1px solid oklch(var(--border));
    border-radius: var(--radius-sm);
    font-family: inherit;
    font-size: var(--font-size-annotation);
    color: oklch(var(--foreground));
    background: oklch(var(--surface-hover));
  }
  @keyframes pulse {
    0%, 100% { opacity: 1; transform: scale(1); }
    50% { opacity: 0.5; transform: scale(0.85); }
  }
  .ellipsis::after {
    content: '...';
    display: inline-block;
    width: 1em;
    overflow: hidden;
    animation: dots 1.2s steps(4, end) infinite;
    vertical-align: bottom;
  }
  @keyframes dots {
    0%   { width: 0; }
    100% { width: 1em; }
  }

  .scroll {
    flex: 1 1 auto;
    min-height: 0;
    overflow-y: auto;
    padding: 12px 16px 32px;
    font-size: var(--font-size-control);
    line-height: 1.55;
  }

  .empty {
    color: oklch(var(--muted-foreground));
    font-style: italic;
  }
  .empty-line { margin: 0; }
  .empty-line.muted {
    color: oklch(var(--muted-foreground));
  }
  .empty-line .ink {
    font-style: normal;
    color: oklch(var(--foreground));
    background: oklch(var(--surface-hover));
    padding: 1px 5px;
    border-radius: var(--radius-sm);
  }

  .block {
    margin: 0 0 14px;
  }
  .block-head {
    display: flex;
    align-items: baseline;
    gap: 8px;
    margin-bottom: 4px;
    color: oklch(var(--muted-foreground));
    font-size: var(--font-size-label);
    letter-spacing: var(--tracking-label);
    text-transform: uppercase;
  }
  .prefix {
    display: inline-block;
    width: 14px;
    text-align: center;
    color: oklch(var(--muted-foreground));
  }
  .block-title { color: oklch(var(--foreground)); font-weight: 600; }

  .text-line {
    display: flex;
    gap: 8px;
    align-items: baseline;
    margin: 0 0 6px;
  }
  .text-line .text { white-space: pre-wrap; word-break: break-word; }
  .text-line.tone-info { color: oklch(var(--foreground)); }
  .text-line.tone-info .prefix { color: oklch(var(--status-info)); }
  .text-line.tone-warn { color: oklch(var(--status-warn)); }
  .text-line.tone-warn .prefix { color: oklch(var(--status-warn)); }
  .text-line.tone-error { color: oklch(var(--status-error)); }
  .text-line.tone-error .prefix { color: oklch(var(--status-error)); }

  .trace {
    margin: 0;
    padding: 10px 12px;
    background: oklch(var(--surface-hover));
    border-left: 2px solid oklch(var(--status-error-border));
    border-radius: 0 4px 4px 0;
    font-family: inherit;
    font-size: var(--font-size-chrome);
    line-height: 1.55;
    white-space: pre-wrap;
    word-break: break-word;
    color: color-mix(in oklab, oklch(var(--foreground)) 92%, transparent);
  }
  .stdout .trace {
    border-left-color: oklch(var(--border-strong));
  }

  .table-block .table-scroll {
    max-height: 360px;
    overflow: auto;
    border: 1px solid oklch(var(--border));
    border-radius: var(--radius-md);
    background: oklch(var(--surface-sunken));
  }
  table {
    width: 100%;
    border-collapse: separate;
    border-spacing: 0;
    font-variant-numeric: tabular-nums;
    font-size: var(--font-size-chrome);
  }
  th, td {
    padding: 6px 12px;
    text-align: left;
    white-space: nowrap;
  }
  th {
    position: sticky;
    top: 0;
    background: oklch(var(--surface-sunken));
    color: oklch(var(--muted-foreground));
    font-weight: 600;
    font-size: var(--font-size-label);
    letter-spacing: var(--tracking-label);
    text-transform: uppercase;
    border-bottom: 1px solid oklch(var(--border-subtle));
  }
  tbody tr:nth-child(odd) td {
    background: color-mix(in oklab, oklch(var(--foreground)) 2.5%, transparent);
  }
  tbody tr:hover td {
    background: oklch(var(--surface-selected));
  }

  .deferred .deferred-list {
    margin: 0;
    padding: 8px 14px;
    list-style: none;
    border: 1px dashed oklch(var(--border));
    border-radius: var(--radius-md);
    color: oklch(var(--muted-foreground));
  }
  .deferred .deferred-list li {
    padding: 2px 0;
    font-size: var(--font-size-chrome);
  }
  .deferred .deferred-list li::before {
    content: '· ';
    color: color-mix(in oklab, oklch(var(--foreground)) 30%, transparent);
  }
</style>
