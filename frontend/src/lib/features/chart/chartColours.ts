import { resolveColour, resolveGridLineColour } from './chart';
import { DEFAULT_CHART_COLOURS } from './chartDefaults';
import { safeLocalStorageGet, safeLocalStorageSet } from '$lib/core/storage';

export type ChartType = 'candlestick' | 'line';

export interface ChartTemplate {
  name: string;
  colours: ChartColours;
  smaLineWidth: number;
  emaLineWidth: number;
  bbandsLineWidth?: number;
  chartType?: ChartType;
  showArea?: boolean;
  showVolume?: boolean;
  smaEnabled?: boolean;
  emaEnabled?: boolean;
  bbandsEnabled?: boolean;
}

export interface ChartSettings {
  chartType: ChartType;
  showArea: boolean;
  showVolume: boolean;
  smaEnabled: boolean;
  emaEnabled: boolean;
  bbandsEnabled: boolean;
}

export interface ChartColours {
  candleUpBody: string;
  candleDownBody: string;
  candleUpWick: string;
  candleDownWick: string;
  candleUpBorder: string;
  candleDownBorder: string;
  lineColour: string;
  areaTop: string;
  areaBottom: string;
  volumeUp: string;
  volumeDown: string;
  smaLine: string;
  emaLine: string;
  bbandsUpper: string;
  bbandsMiddle: string;
  bbandsLower: string;
  chartBackground: string;
  gridLines: string;
  textColour: string;
  /** Only new/reset defaults follow the theme; legacy colours stay explicit. */
  themeDefaultKeys?: ChartColourKey[];
}

export type ChartColourKey = Exclude<keyof ChartColours, 'themeDefaultKeys'>;

const STORAGE_KEY = 'openquant:chartColours';

const CHART_COLOUR_KEYS = Object.keys(
  DEFAULT_CHART_COLOURS,
) as ChartColourKey[];

export function loadChartColoursFromStorage(): ChartColours | null {
  const data = safeLocalStorageGet<Record<string, unknown>>(STORAGE_KEY);
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
  const partial: Partial<ChartColours> = {};
  for (const key of CHART_COLOUR_KEYS) {
    const v = data[key as string];
    if (typeof v === 'string' && v.trim()) partial[key] = v.trim();
  }
  if (Object.keys(partial).length === 0) return null;
  const defaults = defaultChartColours();
  const storedDefaultKeys = data.themeDefaultKeys;
  const themeDefaultKeys = Array.isArray(storedDefaultKeys)
    ? CHART_COLOUR_KEYS.filter(key => storedDefaultKeys.includes(key))
    : CHART_COLOUR_KEYS.filter(key => !partial[key]);
  return refreshThemeColours({ ...defaults, ...partial, themeDefaultKeys });
}

export function persistChartColours(colours: ChartColours): void {
  safeLocalStorageSet(STORAGE_KEY, colours);
}

const SETTINGS_KEY = 'openquant:chartSettings';

function boolOr(v: unknown, fallback: boolean): boolean {
  return typeof v === 'boolean' ? v : fallback;
}

export function loadChartSettingsFromStorage(): ChartSettings | null {
  const data = safeLocalStorageGet<Record<string, unknown>>(SETTINGS_KEY);
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
  return {
    chartType: data.chartType === 'line' ? 'line' : 'candlestick',
    showArea: boolOr(data.showArea, true),
    showVolume: boolOr(data.showVolume, true),
    smaEnabled: boolOr(data.smaEnabled, false),
    emaEnabled: boolOr(data.emaEnabled, false),
    bbandsEnabled: boolOr(data.bbandsEnabled, false),
  };
}

export function persistChartSettings(settings: ChartSettings): void {
  safeLocalStorageSet(SETTINGS_KEY, settings);
}

const TEMPLATES_KEY = 'openquant:chartTemplates';

export function loadTemplates(): ChartTemplate[] {
  const data = safeLocalStorageGet<unknown>(TEMPLATES_KEY);
  if (!Array.isArray(data)) return [];
  return data.filter(
    (t: unknown): t is ChartTemplate =>
      !!t &&
      typeof t === 'object' &&
      typeof (t as ChartTemplate).name === 'string' &&
      typeof (t as ChartTemplate).colours === 'object',
  );
}

export function saveTemplate(template: ChartTemplate): void {
  template = {
    ...template,
    colours: { ...template.colours, themeDefaultKeys: [] },
  };
  const templates = loadTemplates();
  const idx = templates.findIndex(t => t.name === template.name);
  if (idx >= 0) templates[idx] = template;
  else templates.push(template);
  safeLocalStorageSet(TEMPLATES_KEY, templates);
}

export function deleteTemplate(name: string): void {
  const templates = loadTemplates().filter(t => t.name !== name);
  safeLocalStorageSet(TEMPLATES_KEY, templates);
}

export function defaultChartColours(): ChartColours {
  const colours = { ...DEFAULT_CHART_COLOURS };
  for (const key of CHART_COLOUR_KEYS) {
    colours[key] =
      key === 'gridLines'
        ? resolveGridLineColour()
        : resolveColour(undefined, key);
  }
  return { ...colours, themeDefaultKeys: [...CHART_COLOUR_KEYS] };
}

export function refreshThemeColours(colours: ChartColours): ChartColours {
  if (!colours.themeDefaultKeys?.length) return colours;
  const defaults = defaultChartColours();
  const next = { ...colours };
  for (const key of colours.themeDefaultKeys) next[key] = defaults[key];
  return next;
}

export function setChartColour(
  colours: ChartColours,
  key: ChartColourKey,
  value: string,
): ChartColours {
  return {
    ...colours,
    [key]: value,
    themeDefaultKeys: colours.themeDefaultKeys?.filter(k => k !== key),
  };
}
