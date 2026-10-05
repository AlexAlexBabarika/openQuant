import {
  createChart,
  CrosshairMode,
  ColorType,
  CandlestickSeries,
  HistogramSeries,
  AreaSeries,
  LineSeries,
} from 'lightweight-charts';
import type { IChartApi, ISeriesApi, LineData } from 'lightweight-charts';
import { isoToChartTime } from './chartAdapters';
import { formatRgb, parse } from 'culori';
import type { ChartColours, ChartColourKey } from './chartColours';
import {
  DEFAULT_BORDER,
  DEFAULT_CHART_COLOURS,
  computeGridLineColor,
} from './chartDefaults';

export { computeGridLineColor } from './chartDefaults';

const cssVarCache = new Map<string, string>();

/** Call when theme changes so memoised CSS-var lookups re-resolve. */
export function invalidateCssVarCache(): void {
  cssVarCache.clear();
}

export function observeChartTheme(update: () => void): () => void {
  const root = document.documentElement;
  let dark = root.classList.contains('dark');
  const observer = new MutationObserver(() => {
    const next = root.classList.contains('dark');
    if (next === dark) return;
    dark = next;
    invalidateCssVarCache();
    update();
  });
  observer.observe(root, { attributes: true, attributeFilter: ['class'] });
  return () => observer.disconnect();
}

export function getCssVarColor(
  variableName: string,
  fallback: string = '#000000',
): string {
  if (typeof window === 'undefined') return fallback;

  const cacheKey = `${variableName}|${fallback}`;
  const cached = cssVarCache.get(cacheKey);
  if (cached !== undefined) return cached;

  const result = resolveCssVarColor(variableName, fallback);
  cssVarCache.set(cacheKey, result);
  return result;
}

function resolveCssVarColor(variableName: string, fallback: string): string {
  const root = document.documentElement;
  const style = getComputedStyle(root);

  // Try standard variable name first (e.g. --background)
  let value = style.getPropertyValue(variableName).trim();

  // If not found, try with Tailwind --color- prefix (e.g. --color-background)
  if (!value) {
    const prefixedName = '--color-' + variableName.replace(/^--/, '');
    value = style.getPropertyValue(prefixedName).trim();
  }

  // Handle cases where the input might be missing the leading dashes
  if (!value && !variableName.startsWith('--')) {
    value = style.getPropertyValue('--' + variableName).trim();
  }

  if (!value) {
    console.warn(
      `[Chart] Variable ${variableName} not found. Using fallback ${fallback}`,
    );
    return fallback;
  }

  // Robust OKLCH parsing via RegEx to handle raw values and space/comma separation
  const oklchMatch = value.match(
    /(?:oklch\()?([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:\s*[/\s,]\s*([\d.%]+))?\)?/,
  );

  if (oklchMatch) {
    const [_, l, c, h, a] = oklchMatch;
    try {
      const alpha = a
        ? a.includes('%')
          ? parseFloat(a) / 100
          : parseFloat(a)
        : 1;
      const color = formatRgb({
        mode: 'oklch',
        l: parseFloat(l),
        c: parseFloat(c),
        h: parseFloat(h),
        alpha,
      });
      if (color) return color;
    } catch (e) {
      console.error(`[Chart] Error converting OKLCH ${value}:`, e);
    }
  }

  // Try standard culori parse
  try {
    const parsed = parse(value);
    if (parsed) {
      const color = formatRgb(parsed);
      if (color) return color;
    }
  } catch (e) {
    // Ignore
  }

  console.warn(
    `[Chart] Could not parse color "${value}" for ${variableName}. Using fallback ${fallback}`,
  );
  return fallback;
}

const COLOUR_CSS_VARS: Partial<Record<ChartColourKey, string>> = {
  chartBackground: '--chart-background',
  textColour: '--foreground',
  lineColour: '--chart-1',
  candleUpBody: '--up-color',
  candleUpWick: '--up-color',
  candleDownBody: '--down-color',
  candleDownWick: '--down-color',
  areaTop: '--area-top-color',
  areaBottom: '--area-bottom-color',
  candleUpBorder: '--up-color',
  candleDownBorder: '--down-color',
  volumeUp: '--volume-up-color',
  volumeDown: '--volume-down-color',
  smaLine: '--ring',
  emaLine: '--risk',
  bbandsUpper: '--chart-2',
  bbandsMiddle: '--chart-3',
  bbandsLower: '--chart-2',
};

/** Precedence: user-supplied colour → CSS var (if mapped) → hardcoded default. */
export function resolveColour(
  colours: ChartColours | undefined,
  key: ChartColourKey,
): string {
  const user = colours?.[key];
  if (user) return user;
  const cssVar = COLOUR_CSS_VARS[key];
  if (cssVar) return getCssVarColor(cssVar, DEFAULT_CHART_COLOURS[key]);
  return DEFAULT_CHART_COLOURS[key];
}

export function resolveGridLineColour(colours?: ChartColours): string {
  if (colours?.gridLines) return colours.gridLines;
  return getCssVarColor('--chart-grid', computeGridLineColor(DEFAULT_BORDER));
}

const DEFAULT_MONO_FONT =
  "'Space Mono', ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace";

function getMonoFontFamily(): string {
  if (typeof window === 'undefined') return DEFAULT_MONO_FONT;
  const value = getComputedStyle(document.documentElement)
    .getPropertyValue('--font-mono')
    .trim();
  return value || DEFAULT_MONO_FONT;
}

/** Bars of empty logical space after the last point (drawables / placement past the final bar). */
export const CHART_TIME_SCALE_RIGHT_OFFSET = 8;

export function createChartContainer(
  parent: HTMLElement,
  colours?: ChartColours,
): IChartApi {
  const borderColor = getCssVarColor('--border', DEFAULT_BORDER);
  const gridLineColor = resolveGridLineColour(colours);
  const chart = createChart(parent, {
    width: parent.clientWidth,
    height: parent.clientHeight,
    layout: {
      background: {
        type: ColorType.Solid,
        color: resolveColour(colours, 'chartBackground'),
      },
      textColor: resolveColour(colours, 'textColour'),
      fontFamily: getMonoFontFamily(),
      fontSize: 12,
    },
    grid: {
      vertLines: { color: gridLineColor },
      horzLines: { color: gridLineColor },
    },
    rightPriceScale: {
      borderColor,
      scaleMargins: { top: 0.1, bottom: 0.2 },
    },
    timeScale: {
      borderColor,
      timeVisible: true,
      secondsVisible: false,
      rightOffset: CHART_TIME_SCALE_RIGHT_OFFSET,
    },
    crosshair: { mode: CrosshairMode.Magnet },
  });
  chart.timeScale().fitContent();
  return chart;
}

export function addVolumeSeries(chart: IChartApi): ISeriesApi<'Histogram'> {
  const series = chart.addSeries(HistogramSeries, {
    priceFormat: {
      type: 'volume',
    },
    priceScaleId: '',
  });
  series.priceScale().applyOptions({
    scaleMargins: {
      top: 0.77,
      bottom: 0,
    },
  });
  return series;
}

/**
 * A translucent histogram pinned to the bottom of the chart, used by the
 * backtest dashboard to shade the bars where the strategy held a position.
 * Lives on its own price scale so it never affects price autoscaling.
 */
export function addInMarketSeries(
  chart: IChartApi,
  color: string,
): ISeriesApi<'Histogram'> {
  const series = chart.addSeries(HistogramSeries, {
    priceScaleId: 'in-market',
    priceLineVisible: false,
    lastValueVisible: false,
    color,
  });
  series.priceScale().applyOptions({
    scaleMargins: { top: 0.88, bottom: 0 },
  });
  return series;
}

export function addCandlestickSeries(
  chart: IChartApi,
  colours?: ChartColours,
): ISeriesApi<'Candlestick'> {
  const upColor = resolveColour(colours, 'candleUpBody');
  const downColor = resolveColour(colours, 'candleDownBody');
  return chart.addSeries(CandlestickSeries, {
    upColor,
    downColor,
    borderUpColor: colours?.candleUpBorder ?? upColor,
    borderDownColor: colours?.candleDownBorder ?? downColor,
    wickUpColor: colours?.candleUpWick ?? upColor,
    wickDownColor: colours?.candleDownWick ?? downColor,
  });
}

export function addAreaSeries(
  chart: IChartApi,
  colours?: ChartColours,
): ISeriesApi<'Area'> {
  return chart.addSeries(AreaSeries, {
    lastValueVisible: false,
    crosshairMarkerVisible: false,
    lineColor: 'transparent',
    topColor: resolveColour(colours, 'areaTop'),
    bottomColor: resolveColour(colours, 'areaBottom'),
  });
}

export interface SyncChartThemeArgs {
  chart: IChartApi;
  candleSeries?: ISeriesApi<'Candlestick'> | null;
  areaSeries?: ISeriesApi<'Area'> | null;
  lineSeries?: ISeriesApi<'Line'> | null;
  smaSeries?: ISeriesApi<'Line'> | null;
  emaSeries?: ISeriesApi<'Line'> | null;
  bbandsUpperSeries?: ISeriesApi<'Line'> | null;
  bbandsMiddleSeries?: ISeriesApi<'Line'> | null;
  bbandsLowerSeries?: ISeriesApi<'Line'> | null;
  colours?: ChartColours;
}

export function syncChartTheme({
  chart,
  candleSeries,
  areaSeries,
  lineSeries,
  smaSeries,
  emaSeries,
  bbandsUpperSeries,
  bbandsMiddleSeries,
  bbandsLowerSeries,
  colours,
}: SyncChartThemeArgs): void {
  const borderColor = getCssVarColor('--border', DEFAULT_BORDER);
  const gridLineColor = resolveGridLineColour(colours);
  chart.applyOptions({
    layout: {
      background: {
        type: ColorType.Solid,
        color: resolveColour(colours, 'chartBackground'),
      },
      textColor: resolveColour(colours, 'textColour'),
    },
    grid: {
      vertLines: { color: gridLineColor },
      horzLines: { color: gridLineColor },
    },
    rightPriceScale: { borderColor },
    timeScale: { borderColor },
  });

  if (candleSeries) {
    const upColor = resolveColour(colours, 'candleUpBody');
    const downColor = resolveColour(colours, 'candleDownBody');
    candleSeries.applyOptions({
      upColor,
      downColor,
      borderUpColor: colours?.candleUpBorder ?? upColor,
      borderDownColor: colours?.candleDownBorder ?? downColor,
      wickUpColor: colours?.candleUpWick ?? upColor,
      wickDownColor: colours?.candleDownWick ?? downColor,
    });
  }
  if (areaSeries) {
    areaSeries.applyOptions({
      topColor: resolveColour(colours, 'areaTop'),
      bottomColor: resolveColour(colours, 'areaBottom'),
    });
  }
  if (lineSeries) {
    lineSeries.applyOptions({ color: resolveColour(colours, 'lineColour') });
  }
  if (smaSeries) {
    smaSeries.applyOptions({ color: resolveColour(colours, 'smaLine') });
  }
  if (emaSeries) {
    emaSeries.applyOptions({ color: resolveColour(colours, 'emaLine') });
  }
  if (bbandsUpperSeries) {
    bbandsUpperSeries.applyOptions({
      color: resolveColour(colours, 'bbandsUpper'),
    });
  }
  if (bbandsMiddleSeries) {
    bbandsMiddleSeries.applyOptions({
      color: resolveColour(colours, 'bbandsMiddle'),
    });
  }
  if (bbandsLowerSeries) {
    bbandsLowerSeries.applyOptions({
      color: resolveColour(colours, 'bbandsLower'),
    });
  }
}

export function addLineSeries(
  chart: IChartApi,
  color: string,
): ISeriesApi<'Line'> {
  return chart.addSeries(LineSeries, { color });
}

export function linePoint(time: string, value: number): LineData {
  return { time: isoToChartTime(time), value };
}
