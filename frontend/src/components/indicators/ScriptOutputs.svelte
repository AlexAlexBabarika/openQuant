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
    background: color-mix(in oklab, oklch(var(--background)) 86%, black 14%);
    border-top: 1px solid oklch(var(--border));
    font-family: 'Space Mono', ui-monospace, SFMono-Regular, monospace;
    color: oklch(var(--foreground));
  }
  :global(html:not(.dark)) .console {
    background: #ffffff;
    border-top: 1px solid #000;
  }

  .status {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 10px 16px;
    font-size: 11px;
    letter-spacing: 0.08em;
    border-bottom: 1px dashed
      color-mix(in oklab, oklch(var(--border)) 80%, transparent);
    background: color-mix(in oklab, oklch(var(--background)) 70%, black 30%);
  }
  :global(html:not(.dark)) .status {
    background: #ffffff;
    border-bottom: 1px dashed #000;
  }
  :global(html:not(.dark)) .meta { color: #000; opacity: 0.7; }
  :global(html:not(.dark)) .tone-muted { color: #000; opacity: 0.5; }
  :global(html:not(.dark)) .meta kbd {
    background: #ffffff;
    border-color: #000;
    color: #000;
  }
  :global(html:not(.dark)) .empty,
  :global(html:not(.dark)) .empty-line.muted {
    color: #000;
    opacity: 0.55;
  }
  :global(html:not(.dark)) .empty-line .ink {
    background: #ffffff;
    color: #000;
    border: 1px solid #000;
  }
  :global(html:not(.dark)) .block-head,
  :global(html:not(.dark)) .prefix {
    color: #000;
    opacity: 0.7;
  }
  :global(html:not(.dark)) .block-title { color: #000; opacity: 1; }
  :global(html:not(.dark)) .trace {
    background: #ffffff;
    border-left: 2px solid #000;
    color: #000;
  }
  :global(html:not(.dark)) .table-block .table-scroll {
    background: #ffffff;
    border-color: #000;
  }
  :global(html:not(.dark)) th {
    background: #ffffff;
    color: #000;
    border-bottom: 1px solid #000;
  }
  :global(html:not(.dark)) tbody tr:nth-child(odd) td { background: #ffffff; }
  :global(html:not(.dark)) tbody tr:hover td {
    background: color-mix(in oklab, oklch(var(--primary)) 12%, #ffffff);
  }
  :global(html:not(.dark)) .deferred .deferred-list {
    border-color: #000;
    color: #000;
  }
  .dot {
    width: 8px;
    height: 8px;
    border-radius: 999px;
    background: oklch(var(--muted-foreground));
    box-shadow: 0 0 0 0 transparent;
  }
  .dot-running {
    background: #ffcb6b;
    animation: pulse 1.1s ease-in-out infinite;
  }
  .dot-ok {
    background: #7ee2a8;
    box-shadow: 0 0 8px color-mix(in oklab, #7ee2a8 60%, transparent);
  }
  .dot-warn { background: #ffcb6b; }
  .dot-err  { background: #ff7373; }
  .dot-idle {
    background: transparent;
    border: 1px dashed color-mix(in oklab, oklch(var(--foreground)) 35%, transparent);
  }

  .label { font-weight: 700; }
  .tone-ok { color: #7ee2a8; }
  .tone-err { color: #ff7373; }
  .tone-warn { color: #ffcb6b; }
  .tone-muted { color: oklch(var(--muted-foreground)); }

  .meta {
    color: oklch(var(--muted-foreground));
    font-size: 11px;
    text-transform: lowercase;
    letter-spacing: 0.04em;
  }
  .meta .num {
    color: oklch(var(--foreground));
    font-variant-numeric: tabular-nums;
  }
  .meta kbd {
    display: inline-block;
    padding: 0 5px;
    margin: 0 1px;
    border: 1px solid color-mix(in oklab, oklch(var(--border)) 100%, transparent);
    border-radius: 3px;
    font-family: inherit;
    font-size: 10px;
    color: oklch(var(--foreground));
    background: color-mix(in oklab, oklch(var(--foreground)) 4%, transparent);
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
    font-size: 12.5px;
    line-height: 1.55;
  }

  .empty {
    color: color-mix(in oklab, oklch(var(--foreground)) 40%, transparent);
    font-style: italic;
  }
  .empty-line { margin: 0; }
  .empty-line.muted {
    color: color-mix(in oklab, oklch(var(--foreground)) 25%, transparent);
  }
  .empty-line .ink {
    font-style: normal;
    color: oklch(var(--foreground));
    background: color-mix(in oklab, oklch(var(--foreground)) 6%, transparent);
    padding: 1px 5px;
    border-radius: 3px;
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
    font-size: 10.5px;
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }
  .prefix {
    display: inline-block;
    width: 14px;
    text-align: center;
    color: oklch(var(--muted-foreground));
  }
  .block-title { color: oklch(var(--foreground)); font-weight: 700; }

  .text-line {
    display: flex;
    gap: 8px;
    align-items: baseline;
    margin: 0 0 6px;
  }
  .text-line .text { white-space: pre-wrap; word-break: break-word; }
  .text-line.tone-info { color: oklch(var(--foreground)); }
  .text-line.tone-info .prefix { color: #82aaff; }
  .text-line.tone-warn { color: #ffcb6b; }
  .text-line.tone-warn .prefix { color: #ffcb6b; }
  .text-line.tone-error { color: #ff7373; }
  .text-line.tone-error .prefix { color: #ff7373; }

  .trace {
    margin: 0;
    padding: 10px 12px;
    background: color-mix(in oklab, oklch(var(--foreground)) 4%, transparent);
    border-left: 2px solid color-mix(in oklab, #ff7373 60%, transparent);
    border-radius: 0 4px 4px 0;
    font-family: inherit;
    font-size: 12px;
    line-height: 1.55;
    white-space: pre-wrap;
    word-break: break-word;
    color: color-mix(in oklab, oklch(var(--foreground)) 92%, transparent);
  }
  .stdout .trace {
    border-left-color: color-mix(in oklab, oklch(var(--primary)) 50%, transparent);
  }

  .table-block .table-scroll {
    max-height: 360px;
    overflow: auto;
    border: 1px solid color-mix(in oklab, oklch(var(--border)) 100%, transparent);
    border-radius: 4px;
    background: color-mix(in oklab, oklch(var(--background)) 80%, black 20%);
  }
  table {
    width: 100%;
    border-collapse: separate;
    border-spacing: 0;
    font-variant-numeric: tabular-nums;
    font-size: 12px;
  }
  th, td {
    padding: 6px 12px;
    text-align: left;
    white-space: nowrap;
  }
  th {
    position: sticky;
    top: 0;
    background: color-mix(in oklab, oklch(var(--background)) 70%, black 30%);
    color: oklch(var(--muted-foreground));
    font-weight: 700;
    font-size: 10.5px;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    border-bottom: 1px solid oklch(var(--border));
  }
  tbody tr:nth-child(odd) td {
    background: color-mix(in oklab, oklch(var(--foreground)) 2.5%, transparent);
  }
  tbody tr:hover td {
    background: color-mix(in oklab, oklch(var(--primary)) 10%, transparent);
  }

  .deferred .deferred-list {
    margin: 0;
    padding: 8px 14px;
    list-style: none;
    border: 1px dashed color-mix(in oklab, oklch(var(--border)) 90%, transparent);
    border-radius: 4px;
    color: oklch(var(--muted-foreground));
  }
  .deferred .deferred-list li {
    padding: 2px 0;
    font-size: 12px;
  }
  .deferred .deferred-list li::before {
    content: '· ';
    color: color-mix(in oklab, oklch(var(--foreground)) 30%, transparent);
  }
</style>
