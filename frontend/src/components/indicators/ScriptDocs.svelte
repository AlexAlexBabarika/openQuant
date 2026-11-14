<script lang="ts">
  type Param = { name: string; type?: string; desc: string };
  type Helper = {
    name: string;
    sig: string;
    returns?: string;
    desc: string;
    params?: Param[];
  };

  const dataGlobals: Param[] = [
    { name: 'df', type: 'pl.DataFrame', desc: 'OHLCV frame; columns: timestamp (tz-aware UTC), open, high, low, close, volume.' },
    { name: 'time', type: 'pl.Series', desc: 'Bar timestamps (tz-aware UTC). Alias for df["timestamp"].' },
    { name: 'open', type: 'pl.Series', desc: 'Bar open prices.' },
    { name: 'high', type: 'pl.Series', desc: 'Bar high prices.' },
    { name: 'low', type: 'pl.Series', desc: 'Bar low prices.' },
    { name: 'close', type: 'pl.Series', desc: 'Bar close prices.' },
    { name: 'price', type: 'pl.Series', desc: 'Alias for close.' },
    { name: 'volume', type: 'pl.Series', desc: 'Bar volume.' },
    { name: 'pl', type: 'module', desc: 'polars — full API available.' },
    { name: 'np', type: 'module', desc: 'numpy — full API available.' },
  ];

  const helpers: Helper[] = [
    {
      name: 'crossover',
      sig: 'crossover(a: pl.Series, b: pl.Series) -> pl.Series[bool]',
      desc: 'True where a crosses above b (current >= b, previous < b).',
    },
    {
      name: 'crossunder',
      sig: 'crossunder(a: pl.Series, b: pl.Series) -> pl.Series[bool]',
      desc: 'True where a crosses below b.',
    },
    {
      name: 'compute_rsi',
      sig: 'compute_rsi(series: pl.Series, period=14) -> pl.Series',
      desc: 'Wilder-style RSI on a price series.',
    },
    {
      name: 'compute_macd',
      sig: 'compute_macd(series: pl.Series, fast=12, slow=26, signal=9) -> (line, signal, hist)',
      desc: 'MACD line, signal line, and histogram (line - signal).',
    },
    {
      name: 'compute_bbands',
      sig: 'compute_bbands(series: pl.Series, period=20, num_std=2.0) -> (upper, middle, lower)',
      desc: 'Bollinger Bands using SMA and population std.',
    },
    {
      name: 'compute_atr',
      sig: 'compute_atr(high: pl.Series, low: pl.Series, close: pl.Series, period=14) -> pl.Series',
      desc: 'Average True Range (Wilder smoothing).',
    },
  ];

  const displayApi: Helper[] = [
    {
      name: 'display.line',
      sig: 'display.line(data, *, title="series", color=None, line_width=None, line_style=None)',
      desc: 'Overlay a line on the price pane. data: pl.Series aligned with df, or list of (time, value).',
    },
    {
      name: 'display.pane',
      sig: 'display.pane(data, *, title="pane", color=None, height=None, pane_id=None)',
      desc: 'Render a series in its own pane below the price chart. Share pane_id to stack multiple series in the same pane.',
    },
    {
      name: 'display.histogram',
      sig: 'display.histogram(data, *, title="histogram", pane_id=None)',
      desc: 'Render a histogram (e.g. MACD histogram). Combine with display.pane via shared pane_id.',
    },
    {
      name: 'display.markers',
      sig: 'display.markers(data, *, shape=None, position=None, color=None, text=None)',
      desc: 'Mark events on the price pane. data: boolean pl.Series (markers where True), or list of timestamps.',
    },
    {
      name: 'display.table',
      sig: 'display.table(columns: list[str], rows: list[list])',
      desc: 'Render a small read-only table in the output console. Pass pl.DataFrame rows via .rows() / .iter_rows().',
    },
    {
      name: 'display.text',
      sig: 'display.text(text, *, level="info"|"warn"|"error")',
      desc: 'Print a line to the output console. Plain print() also works for stdout capture.',
    },
    {
      name: 'display(...)',
      sig: 'display(value, **kwargs)',
      desc: 'Default form: a string becomes display.text; anything else is treated as display.line.',
    },
  ];

  const allowedImports = [
    'math', 'statistics', 'dataclasses', 'itertools',
    'functools', 'collections', 'typing', 'datetime',
  ];

  const limits = [
    'Wallclock timeout: ~5s per run.',
    'Memory cap: ~256 MB per run.',
    'Max 50 outputs per run, max 50,000 rows per series.',
    'No filesystem writes, no network access, no subprocesses.',
    'No dunder access (__class__, __subclasses__, __globals__, …).',
  ];

  const examples: { title: string; code: string }[] = [
    {
      title: 'SMA overlay',
      code: `sma20 = price.rolling_mean(20)
sma50 = price.rolling_mean(50)
display.line(sma20, title="SMA 20", color="#7dd3fc")
display.line(sma50, title="SMA 50", color="#fbbf24")`,
    },
    {
      title: 'RSI in a separate pane',
      code: `rsi = compute_rsi(price, 14)
display.pane(rsi, title="RSI(14)", pane_id="rsi", color="#a78bfa")`,
    },
    {
      title: 'MACD: line + signal + histogram in one pane',
      code: `line, signal, hist = compute_macd(price)
display.pane(line,   title="MACD",   pane_id="macd", color="#7dd3fc")
display.pane(signal, title="signal", pane_id="macd", color="#fbbf24")
display.histogram(hist, title="hist", pane_id="macd")`,
    },
    {
      title: 'Crossover markers',
      code: `fast = price.ewm_mean(span=12, adjust=False)
slow = price.ewm_mean(span=26, adjust=False)
ups   = crossover(fast, slow)
downs = crossunder(fast, slow)
display.markers(ups,   shape="arrowUp",   position="belowBar", color="#34d399")
display.markers(downs, shape="arrowDown", position="aboveBar", color="#f87171")`,
    },
    {
      title: 'Diagnostic table',
      code: `last = df.tail(5)
display.table(["time", "close"], [[str(t), float(c)] for t, c in zip(last["timestamp"], last["close"])])`,
    },
  ];
</script>

<div class="docs">
  <article>
    <header class="hero">
      <span class="kicker">// reference</span>
      <h1>indicator scripting</h1>
      <p class="lede">
        Write Python that runs against the currently loaded OHLCV. Use
        <code>display.*</code> to project results onto the chart.
      </p>
    </header>

    <section>
      <h2><span class="hash">§</span> globals</h2>
      <p class="dim">Available in every script — no import required.</p>
      <ul class="defs">
        {#each dataGlobals as g (g.name)}
          <li>
            <code class="name">{g.name}</code>
            {#if g.type}<span class="type">{g.type}</span>{/if}
            <span class="desc">{g.desc}</span>
          </li>
        {/each}
      </ul>
    </section>

    <section>
      <h2><span class="hash">§</span> helpers</h2>
      <p class="dim">Built-in TA primitives. Compose with pd / np for the rest.</p>
      <ul class="defs">
        {#each helpers as h (h.name)}
          <li class="block">
            <code class="sig">{h.sig}</code>
            <span class="desc">{h.desc}</span>
          </li>
        {/each}
      </ul>
    </section>

    <section>
      <h2><span class="hash">§</span> display api</h2>
      <p class="dim">Push outputs to the chart and console. Each call queues one output (max 50 per run).</p>
      <ul class="defs">
        {#each displayApi as h (h.name)}
          <li class="block">
            <code class="sig">{h.sig}</code>
            <span class="desc">{h.desc}</span>
          </li>
        {/each}
      </ul>
    </section>

    <section>
      <h2><span class="hash">§</span> allowed imports</h2>
      <p class="dim">stdlib modules permitted by the AST guard.</p>
      <p class="tags">
        {#each allowedImports as m (m)}
          <span class="tag">{m}</span>
        {/each}
      </p>
    </section>

    <section>
      <h2><span class="hash">§</span> sandbox limits</h2>
      <ul class="bullets">
        {#each limits as l (l)}
          <li>{l}</li>
        {/each}
      </ul>
    </section>

    <section>
      <h2><span class="hash">§</span> examples</h2>
      {#each examples as ex (ex.title)}
        <div class="example">
          <div class="example-title">{ex.title}</div>
          <pre><code>{ex.code}</code></pre>
        </div>
      {/each}
    </section>
  </article>
</div>

<style>
  .docs {
    height: 100%;
    overflow-y: auto;
    background:
      linear-gradient(
        180deg,
        color-mix(in oklab, oklch(var(--popover)) 100%, black 4%),
        color-mix(in oklab, oklch(var(--popover)) 100%, black 10%)
      );
  }

  article {
    max-width: 880px;
    margin: 0 auto;
    padding: 28px 32px 64px;
    color: oklch(var(--foreground));
    font-family: var(--font-mono);
    font-size: 13px;
    line-height: 1.65;
  }

  .hero {
    margin-bottom: 28px;
    padding-bottom: 18px;
    border-bottom: 1px dashed
      color-mix(in oklab, oklch(var(--border)) 90%, transparent);
  }
  .kicker {
    font-size: 10px;
    letter-spacing: 0.18em;
    text-transform: uppercase;
    color: oklch(var(--muted-foreground));
  }
  h1 {
    margin: 4px 0 6px;
    font-size: 22px;
    font-weight: 600;
    letter-spacing: -0.01em;
  }
  .lede {
    color: color-mix(in oklab, oklch(var(--foreground)) 70%, transparent);
    margin: 0;
  }
  .lede code {
    font-family: inherit;
    color: oklch(var(--primary));
  }

  section {
    margin-top: 26px;
  }
  h2 {
    display: flex;
    align-items: baseline;
    gap: 8px;
    margin: 0 0 6px;
    font-size: 13px;
    letter-spacing: 0.06em;
    text-transform: lowercase;
  }
  .hash {
    color: oklch(var(--primary));
    font-weight: 600;
  }
  .dim {
    margin: 0 0 10px;
    color: oklch(var(--muted-foreground));
    font-size: 12px;
  }

  .defs {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .defs li {
    display: grid;
    grid-template-columns: minmax(140px, max-content) auto 1fr;
    gap: 12px;
    align-items: baseline;
    padding: 6px 10px;
    border-left: 2px solid
      color-mix(in oklab, oklch(var(--border)) 100%, transparent);
    background: color-mix(in oklab, oklch(var(--foreground)) 3%, transparent);
    border-radius: 0 4px 4px 0;
  }
  .defs li.block {
    grid-template-columns: 1fr;
    gap: 4px;
  }
  .defs .name {
    color: oklch(var(--primary));
    font-weight: 600;
  }
  .defs .sig {
    color: oklch(var(--foreground));
    font-weight: 600;
    word-break: break-word;
  }
  .defs .type {
    font-size: 11px;
    padding: 1px 6px;
    border: 1px solid
      color-mix(in oklab, oklch(var(--border)) 100%, transparent);
    border-radius: 999px;
    color: oklch(var(--muted-foreground));
  }
  .defs .desc {
    color: color-mix(in oklab, oklch(var(--foreground)) 78%, transparent);
  }

  .tags { margin: 0; }
  .tag {
    display: inline-block;
    margin: 2px 6px 2px 0;
    padding: 2px 8px;
    border: 1px solid
      color-mix(in oklab, oklch(var(--border)) 100%, transparent);
    border-radius: 3px;
    font-size: 11px;
    color: oklch(var(--foreground));
    background: color-mix(in oklab, oklch(var(--foreground)) 4%, transparent);
  }

  .bullets {
    margin: 0;
    padding-left: 18px;
    color: color-mix(in oklab, oklch(var(--foreground)) 78%, transparent);
  }
  .bullets li { margin: 2px 0; }

  .example {
    margin-top: 12px;
  }
  .example-title {
    margin: 0 0 4px;
    font-size: 11px;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: oklch(var(--muted-foreground));
  }
  pre {
    margin: 0;
    padding: 12px 14px;
    border: 1px solid
      color-mix(in oklab, oklch(var(--border)) 100%, transparent);
    border-radius: 4px;
    background: color-mix(in oklab, oklch(var(--background)) 70%, black 30%);
    overflow-x: auto;
    font-size: 12px;
    line-height: 1.55;
  }
  pre code { color: oklch(var(--foreground)); }

  /* Light theme: pure white surfaces, black hairlines, no greys. */
  :global(html:not(.dark)) .docs { background: oklch(var(--card)); }
  :global(html:not(.dark)) .hero { border-bottom: 1px dashed oklch(var(--foreground)); }
  :global(html:not(.dark)) .defs li {
    background: oklch(var(--card));
    border-left: 2px solid oklch(var(--foreground));
  }
  :global(html:not(.dark)) .defs .type {
    background: oklch(var(--card));
    border-color: oklch(var(--foreground));
    color: oklch(var(--foreground));
  }
  :global(html:not(.dark)) .tag {
    background: oklch(var(--card));
    border-color: oklch(var(--foreground));
    color: oklch(var(--foreground));
  }
  :global(html:not(.dark)) pre {
    background: oklch(var(--card));
    border-color: oklch(var(--foreground));
  }
</style>
