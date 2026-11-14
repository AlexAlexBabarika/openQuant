<script lang="ts">
  import ReferencePage from '../layout/ReferencePage.svelte';
  type Param = { name: string; type?: string; desc: string };
  type Helper = {
    name: string;
    sig: string;
    returns?: string;
    desc: string;
    params?: Param[];
  };

  const contract: Helper[] = [
    {
      name: 'on_bar',
      sig: 'def on_bar(ctx) -> None',
      desc: 'Required. Called once per closed bar, oldest to newest. All trading logic lives here; read the market through ctx and place orders with ctx.buy / ctx.sell.',
    },
    {
      name: 'params',
      sig: 'params = { "name": Int(...) | Float(...) | Choice(...) }',
      desc: 'Optional module-level dict declaring the parameter space. Drives the sweep form, and ctx.params at runtime. A single backtest uses the first value of each entry unless overridden.',
    },
  ];

  const space: Helper[] = [
    {
      name: 'Int',
      sig: 'Int(low: int, high: int, step=1)',
      desc: 'Inclusive integer grid: low, low+step, … up to high.',
    },
    {
      name: 'Float',
      sig: 'Float(low: float, high: float, step=1.0)',
      desc: "Inclusive float grid; values are rounded to the step's decimals to avoid float drift.",
    },
    {
      name: 'Choice',
      sig: 'Choice(options: list)',
      desc: 'An explicit set of values, e.g. Choice(["sma", "ema"]).',
    },
  ];

  const ctxApi: Helper[] = [
    {
      name: 'ctx.params',
      sig: 'ctx.params -> dict',
      desc: 'Concrete parameter values for this run, e.g. ctx.params["fast"]. Empty if the strategy declares no params.',
    },
    {
      name: 'ctx.bars',
      sig: 'ctx.bars -> BarsView',
      desc: 'Look-ahead-guarded bar history. ctx.bars[-1] is the current bar, ctx.bars[0] the first; len(ctx.bars) is the count revealed so far. Reading a future index raises. Integer indices only (no slices); iterable.',
    },
    {
      name: 'ctx.time',
      sig: 'ctx.time -> datetime',
      desc: "The current bar's close timestamp (UTC).",
    },
    {
      name: 'ctx.position',
      sig: 'ctx.position -> Position',
      desc: 'Signed position: .quantity (> 0 long, < 0 short, 0 flat) and .avg_price (average entry price of the open quantity).',
    },
    {
      name: 'ctx.cash',
      sig: 'ctx.cash -> float',
      desc: 'Cash after all fills so far.',
    },
    {
      name: 'ctx.equity',
      sig: 'ctx.equity -> float',
      desc: "Cash plus the position marked at the current bar's close.",
    },
    {
      name: 'ctx.state',
      sig: 'ctx.state -> dict',
      desc: 'Free-form scratch space that persists across bars within a run. Use it for rolling sums, flags, entry levels, etc.',
    },
    {
      name: 'ctx.random',
      sig: 'ctx.random -> random.Random',
      desc: "The run's seeded RNG. Use this — never the global random module — so runs stay deterministic and sweeps reproducible.",
    },
    {
      name: 'ctx.buy / ctx.sell',
      sig: 'ctx.buy(quantity: float) -> Order   ·   ctx.sell(quantity: float) -> Order',
      desc: "Submit a market order. An order placed on bar t fills at bar t+1's open (plus costs) — there is no same-bar fill, by design, so fills are free of look-ahead.",
    },
  ];

  const portfolioCtx: Helper[] = [
    {
      name: 'ctx.universe',
      sig: 'ctx.universe -> tuple[str, ...]',
      desc: 'Symbols in the universe at the current bar, sorted. A symbol outside its membership window is invisible — reading or trading it raises.',
    },
    {
      name: 'ctx.bars[symbol]',
      sig: 'ctx.bars["AAPL"] -> BarsView',
      desc: 'Per-symbol bar history with the same look-ahead guard as single runs. "AAPL" in ctx.bars tests membership; iterating ctx.bars yields the active symbols.',
    },
    {
      name: 'ctx.position(symbol)',
      sig: 'ctx.position("AAPL") -> Position',
      desc: 'That symbol’s signed position (.quantity, .avg_price). Note the call: a portfolio holds one position per symbol, so ctx.position.quantity does not exist here.',
    },
    {
      name: 'ctx.positions',
      sig: 'ctx.positions -> dict[str, Position]',
      desc: 'Non-flat positions keyed by symbol, in sorted order.',
    },
    {
      name: 'ctx.weights',
      sig: 'ctx.weights -> dict[str, float]',
      desc: 'Current signed weight of each open position as a fraction of equity.',
    },
    {
      name: 'ctx.target_weight',
      sig: 'ctx.target_weight(symbol: str, weight: float) -> None',
      desc: 'Declare the intended signed weight of a symbol as a fraction of equity. Persists across bars until overwritten — or cleared when the symbol leaves the universe. Takes effect on rebalance().',
    },
    {
      name: 'ctx.targets',
      sig: 'ctx.targets -> dict[str, float]',
      desc: 'The declared target weights (a copy).',
    },
    {
      name: 'ctx.rebalance',
      sig: 'ctx.rebalance(min_trade_value=0.0) -> list[Order]',
      desc: 'Diff the targets against the current book and submit only the delta as market orders (filled next bar, with costs). Drifts smaller than min_trade_value are skipped to avoid fee bleed. Returns the submitted orders.',
    },
    {
      name: 'ctx.buy / ctx.sell',
      sig: 'ctx.buy(symbol, quantity) -> Order   ·   ctx.sell(symbol, quantity) -> Order',
      desc: 'Per-symbol market orders with the same t+1 fill rule. The symbol must be in the universe at the current bar.',
    },
    {
      name: 'ctx.constraint_log',
      sig: 'ctx.constraint_log -> list[ConstraintEvent]',
      desc: 'Every constraint binding so far, when the run declares hard constraints. Each entry carries the constraint name, symbol, requested/applied values, and a readable detail line.',
    },
  ];

  const portfolioHelpers: Helper[] = [
    {
      name: 'equal_weight',
      sig: 'equal_weight(signals, gross=1.0) -> dict[str, float]',
      desc: '1/N across the active signals, sign-preserving. Pass a list of symbols (all long) or a {symbol: strength} dict — only the sign is used; zero drops the name.',
    },
    {
      name: 'inverse_volatility',
      sig: 'inverse_volatility(vols, signals=None, gross=1.0) -> dict[str, float]',
      desc: 'Equal-risk sizing: |w| proportional to 1/vol, normalized to gross. Names with a non-positive vol are dropped rather than guessed at.',
    },
    {
      name: 'kelly_weight / kelly_weights',
      sig: 'kelly_weight(edge=…, variance=…, fraction=1.0) -> float',
      desc: 'Fractional Kelly from expected period return and its variance; flat when variance is undefined. kelly_weights(edges=…, variances=…) maps it per symbol.',
    },
    {
      name: 'trailing_volatility',
      sig: 'trailing_volatility(bars, lookback) -> float | None',
      desc: 'Sample std of the last lookback close-to-close returns, or None with fewer than two returns. Works directly on ctx.bars[symbol].',
    },
    {
      name: 'PeriodicRebalance',
      sig: 'PeriodicRebalance("daily" | "weekly" | "monthly")',
      desc: '.should_rebalance(ctx) fires on the first bar of each new calendar period (and on the very first bar, establishing the initial allocation). Create once at module level.',
    },
    {
      name: 'ThresholdRebalance',
      sig: 'ThresholdRebalance(max_drift: float)',
      desc: '.should_rebalance(ctx) fires when any targeted symbol drifts more than max_drift from its target; .drift(ctx) exposes the current max drift.',
    },
    {
      name: 'SignalRebalance',
      sig: 'SignalRebalance()',
      desc: '.should_rebalance(ctx) fires whenever the declared targets change from the previous bar.',
    },
  ];

  const barFields: Param[] = [
    { name: 'bar.time', type: 'datetime', desc: "The bar's close timestamp (UTC)." },
    { name: 'bar.open', type: 'float', desc: 'Open price.' },
    { name: 'bar.high', type: 'float', desc: 'High price.' },
    { name: 'bar.low', type: 'float', desc: 'Low price.' },
    { name: 'bar.close', type: 'float', desc: 'Close price.' },
    { name: 'bar.volume', type: 'float', desc: 'Volume.' },
  ];

  const allowedImports = [
    'math', 'statistics', 'dataclasses', 'itertools',
    'functools', 'collections', 'typing', 'datetime',
  ];

  const limits = [
    'Runs AST-guarded in a spawned subprocess, one bar at a time.',
    'Wallclock timeout: ~30s per run.',
    'Memory cap: ~512 MB per run.',
    'No filesystem writes, no network access, no subprocesses.',
    'No dunder access (__class__, __subclasses__, __globals__, …).',
    'No df / np / pl and no whole-series reads — unlike indicator scripts, state is built bar by bar.',
    'print() output is captured into the run result (stdout/stderr).',
  ];

  const examples: { title: string; code: string }[] = [
    {
      title: 'Buy & hold (the simplest strategy)',
      code: `def on_bar(ctx):
    if ctx.position.quantity == 0:
        ctx.buy(1)`,
    },
    {
      title: 'SMA crossover (the seed strategy)',
      code: `params = {
    "fast": Int(5, 50, step=5),
    "slow": Int(20, 200, step=10),
}

def sma(ctx, n):
    m = len(ctx.bars)
    if m < n:
        return None
    return sum(ctx.bars[i].close for i in range(m - n, m)) / n

def on_bar(ctx):
    fast = sma(ctx, ctx.params["fast"])
    slow = sma(ctx, ctx.params["slow"])
    if fast is None or slow is None:
        return
    if fast > slow and ctx.position.quantity == 0:
        ctx.buy(10)
    elif fast < slow and ctx.position.quantity > 0:
        ctx.sell(ctx.position.quantity)`,
    },
    {
      title: 'Trailing-drop exit with ctx.state',
      code: `params = {
    "warmup": Int(10, 60, step=10),
    "drop": Float(0.02, 0.10, step=0.02),
}

def on_bar(ctx):
    bar = ctx.bars[-1]
    hi = ctx.state.get("hi", 0.0)
    if bar.close > hi:
        ctx.state["hi"] = hi = bar.close

    if ctx.position.quantity == 0:
        if len(ctx.bars) >= ctx.params["warmup"]:
            ctx.buy(10)
    elif bar.close < hi * (1 - ctx.params["drop"]):
        ctx.sell(ctx.position.quantity)
        ctx.state["hi"] = 0.0`,
    },
    {
      title: 'Donchian channel breakout',
      code: `params = {
    "window": Int(20, 100, step=20),
}

def on_bar(ctx):
    n = ctx.params["window"]
    m = len(ctx.bars)
    if m <= n:
        return
    # Channel over the n bars before the current one.
    high = max(ctx.bars[i].high for i in range(m - 1 - n, m - 1))
    low = min(ctx.bars[i].low for i in range(m - 1 - n, m - 1))
    bar = ctx.bars[-1]
    if ctx.position.quantity == 0 and bar.close > high:
        ctx.buy(10)
    elif ctx.position.quantity > 0 and bar.close < low:
        ctx.sell(ctx.position.quantity)`,
    },
  ];

  const portfolioExamples: { title: string; code: string }[] = [
    {
      title: 'Equal-weight universe, rebalanced monthly',
      code: `policy = PeriodicRebalance("monthly")

def on_bar(ctx):
    for symbol, weight in equal_weight(ctx.universe).items():
        ctx.target_weight(symbol, weight)
    if policy.should_rebalance(ctx):
        ctx.rebalance(min_trade_value=50.0)`,
    },
    {
      title: 'Volatility-targeted weights with a drift threshold',
      code: `params = {
    "lookback": Int(10, 60, step=10),
}

policy = ThresholdRebalance(max_drift=0.05)

def on_bar(ctx):
    vols = {}
    for symbol in ctx.universe:
        vol = trailing_volatility(ctx.bars[symbol], ctx.params["lookback"])
        if vol is not None:
            vols[symbol] = vol
    for symbol, weight in inverse_volatility(vols).items():
        ctx.target_weight(symbol, weight)
    # Trade only when actual weights drift > 5% from target.
    if policy.should_rebalance(ctx):
        ctx.rebalance()`,
    },
    {
      title: 'Momentum rotation: hold the top N names',
      code: `params = {
    "lookback": Int(20, 120, step=20),
    "top_n": Int(1, 5),
}

policy = PeriodicRebalance("monthly")

def momentum(bars, n):
    m = len(bars)
    if m <= n or bars[m - 1 - n].close == 0:
        return None
    return bars[-1].close / bars[m - 1 - n].close - 1

def on_bar(ctx):
    if not policy.should_rebalance(ctx):
        return
    scores = {}
    for symbol in ctx.universe:
        s = momentum(ctx.bars[symbol], ctx.params["lookback"])
        if s is not None:
            scores[symbol] = s
    ranked = sorted(scores, key=lambda s: scores[s], reverse=True)
    winners = ranked[: ctx.params["top_n"]]
    # Zero out everything, then weight the winners equally.
    for symbol in ctx.universe:
        ctx.target_weight(symbol, 0.0)
    for symbol, weight in equal_weight(winners).items():
        ctx.target_weight(symbol, weight)
    ctx.rebalance(min_trade_value=25.0)`,
    },
    {
      title: 'Long-short pair (negative weights short)',
      code: `policy = SignalRebalance()

def on_bar(ctx):
    if "AAPL" not in ctx.bars or "MSFT" not in ctx.bars:
        return
    ctx.target_weight("AAPL", 0.5)
    ctx.target_weight("MSFT", -0.5)
    # SignalRebalance fires once here, then stays quiet
    # until the targets change.
    if policy.should_rebalance(ctx):
        ctx.rebalance()`,
    },
  ];
</script>

<ReferencePage title="strategy scripting">
  {#snippet lede()}
        Write Python that defines <code>on_bar(ctx)</code> (and optionally a
        <code>params</code> space). The engine replays the loaded OHLCV bar by
        bar; the same contract drives single backtests, parameter sweeps, and
        — with the per-symbol ctx described below — multi-asset portfolio
        runs.
  {/snippet}

    <section>
      <h2><span class="hash">§</span> contract</h2>
      <p class="dim">What the engine looks for at module level.</p>
      <ul class="defs">
        {#each contract as h (h.name)}
          <li class="block">
            <code class="sig">{h.sig}</code>
            <span class="desc">{h.desc}</span>
          </li>
        {/each}
      </ul>
    </section>

    <section>
      <h2><span class="hash">§</span> parameter space</h2>
      <p class="dim">Available globally — no import required. Each declares the values a sweep may try.</p>
      <ul class="defs">
        {#each space as h (h.name)}
          <li class="block">
            <code class="sig">{h.sig}</code>
            <span class="desc">{h.desc}</span>
          </li>
        {/each}
      </ul>
    </section>

    <section>
      <h2><span class="hash">§</span> ctx api</h2>
      <p class="dim">Everything a strategy can see and do, one bar at a time.</p>
      <ul class="defs">
        {#each ctxApi as h (h.name)}
          <li class="block">
            <code class="sig">{h.sig}</code>
            <span class="desc">{h.desc}</span>
          </li>
        {/each}
      </ul>
    </section>

    <section>
      <h2><span class="hash">§</span> portfolio ctx api</h2>
      <p class="dim">
        The portfolio tab runs on_bar(ctx) against a whole universe, so the
        ctx is per-symbol: data reads, positions, and orders all take a
        symbol. ctx.params / ctx.time / ctx.cash / ctx.equity / ctx.state /
        ctx.random work exactly as above. Single-symbol code (e.g.
        ctx.position.quantity or ctx.buy(1)) will not run here — the engine
        raises a guided error instead.
      </p>
      <ul class="defs">
        {#each portfolioCtx as h (h.name)}
          <li class="block">
            <code class="sig">{h.sig}</code>
            <span class="desc">{h.desc}</span>
          </li>
        {/each}
      </ul>
    </section>

    <section>
      <h2><span class="hash">§</span> portfolio sizers &amp; policies</h2>
      <p class="dim">
        Available globally in portfolio runs only (no import required).
        Sizers turn signals into target weights; policies decide when to
        trade toward them — keep sizing out of signal logic so strategies
        stay comparable.
      </p>
      <ul class="defs">
        {#each portfolioHelpers as h (h.name)}
          <li class="block">
            <code class="sig">{h.sig}</code>
            <span class="desc">{h.desc}</span>
          </li>
        {/each}
      </ul>
    </section>

    <section>
      <h2><span class="hash">§</span> bar fields</h2>
      <p class="dim">Each element of ctx.bars is a closed OHLCV bar.</p>
      <ul class="defs">
        {#each barFields as g (g.name)}
          <li>
            <code class="name">{g.name}</code>
            {#if g.type}<span class="type">{g.type}</span>{/if}
            <span class="desc">{g.desc}</span>
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

    <section>
      <h2><span class="hash">§</span> portfolio examples</h2>
      <p class="dim">
        Run these from the portfolio tab against a universe of symbols.
      </p>
      {#each portfolioExamples as ex (ex.title)}
        <div class="example">
          <div class="example-title">{ex.title}</div>
          <pre><code>{ex.code}</code></pre>
        </div>
      {/each}
    </section>
</ReferencePage>
