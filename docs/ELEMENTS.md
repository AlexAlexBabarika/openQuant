# Chart Elements

Elements are research annotations on the existing OHLCV chart, not orders or
brokerage positions. Choose a tool in the chart toolbar, place it in the plot,
then return to the cursor to select it. Tool settings control the existing
appearance and displayed measurements. Delete removes a selected annotation.

## Anchored Volume Profile (AVP)

AVP estimates volume at price from **cached OHLCV candles**, from the chosen time
anchor through the latest included cached candle. It is not a trade/tick-level
profile and cannot recover where actual trades occurred within a candle.
Changing candle interval or row size can materially change the estimate.

The compact profile caption identifies the OHLCV estimate and source interval.
Hover the caption for provider/symbol, the inclusive request anchor, first and
latest included candle timestamps (UTC), and calculation conventions. The
anchor guide retains the placed chart coordinate; request normalization does
not snap or move that guide.

### Allocation and levels

- Rows are half-open price intervals `[lower edge, lower edge + row size)`.
  The grid starts at `floor(minimum candle low / row size) × row size`.
- A non-flat candle's volume is spread uniformly across `[low, high)`. A row
  receives `volume × overlap length / (high − low)`, not an equal share merely
  because the candle touches it. An exact high endpoint does not allocate
  volume to the row above it. Zero-volume candles may extend the grid but do not
  redistribute other candles' volume.
- A flat positive-volume candle (`high = low`) goes into the one row containing
  that price, including its lower edge. The grid includes that row even at its
  highest boundary.
- **Up/down colours mean candle direction**: `close ≥ open` is up (including a
  doji), `close < open` is down. They are not aggressor buys/sells, bid/ask volume
  or order-flow delta.
- **POC** identifies the lower edge of the row with greatest total volume. Exact
  ties choose the lowest-price row; this is a row convention, not a precise
  execution price.
- The value area starts with POC and expands to the heavier adjacent row until
  it captures at least the configured fraction of total volume. Equal adjacent
  volumes choose the higher row. **VAL** is the lowest included row's lower
  boundary; **VAH** is the highest included row's upper boundary. A one-row area
  therefore has a full row of height, not zero height.
- With no positive volume, POC/VAH/VAL are `null`, no level lines or histogram
  are drawn, and the caption says **No volume**. Missing candles in the window
  are a request failure, not a zero-volume success.

### Source and window contract

The `/data/volume-profile` route reads the selected provider/symbol's published
cache; it does not fetch a separate finer-grained data feed. A known source
interval must match the requested chart interval, after whitespace/case
normalization, **before accepting a derived cache hit**. A mismatch, or an
unknown interval for a non-CSV source, returns `409`; reload the corresponding
market data before retrying. An absent source/window returns `404`.

CSV uploads without interval metadata remain usable, but the response interval
is `null` and the caption explicitly says **interval unknown**. Selecting a
chart interval does not resample or certify those uploaded candles.

Window inclusion compares integer Unix candle seconds: timestamp ≥ start and,
if supplied, timestamp ≤ end. Fractional anchors are **ceiled** to seconds at
the AVP request boundary; an optional fractional inclusive end is **floored**.
Thus an anchor just after a candle excludes it, while an exact or just-before
anchor includes it. Omitted end means the latest candle available in the
published cache, not future bars or a promise of tick-by-tick freshness. The
response's `firstCandleTs` and `latestCandleTs` identify the actual included
window; `startTs`/`endTs` describe the request.

Publishing replacement source candles (including CSV re-upload or a closed-bar
append) invalidates that provider/symbol's derived profiles, for both fixed-end
and to-latest requests. Other symbols/providers retain their derived entries.
This remains a process-local cache, not a cross-worker data-version service.

**Computing AVP** and **AVP unavailable** are explicit states. Old histogram and
level output is suppressed while the current request is pending or failed;
successful computation replaces it. The anchor itself remains selectable.
Row size is in price units; value area is configured as a fraction (`0.7` means
70%). Profile width controls only the existing histogram display width, not
trade size or volume units. The histogram normalizes widths to its largest row.

## Long and Short Position

These bands annotate entry, stop and target geometry. Long requires
`stop < entry < target`; Short requires `target < entry < stop`. The measurement
is price risk/reward: `abs(target − entry) / abs(entry − stop)`, with percentages
relative to entry. They do **not** model quantity, account equity, margin,
leverage, fees, slippage, fills, cash P&L or returns on an actual position.
Band width is annotation geometry, not a simulated holding period or trade
execution. Existing price-level/edge handles and zone/metric settings are the
supported controls; this document does not add whole-object dragging, locking,
visibility flags or position sizing.

## Ruler

Ruler measures the selected endpoints' price difference and percentage relative
to its starting price, elapsed time, and loaded bars/volume within the inclusive
time span. It uses the chart's loaded candles, not inferred missing bars or
exchange sessions. It is not a backtest or a forecast.
