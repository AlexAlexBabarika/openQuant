import { formatRgb, parse } from 'culori';
import type { ChartColours } from './chartColours';

export const DEFAULT_BORDER = '#33404D';

export function computeGridLineColor(borderColor: string): string {
  const parsed = parse(borderColor);
  if (parsed) {
    const formatted = formatRgb({ ...parsed, alpha: 0.125 });
    if (formatted) return formatted;
  }
  return borderColor;
}

export const DEFAULT_CHART_COLOURS: ChartColours = {
  candleUpBody: '#50C5AE',
  candleDownBody: '#F08B82',
  candleUpWick: '#50C5AE',
  candleDownWick: '#F08B82',
  candleUpBorder: '#50C5AE',
  candleDownBorder: '#F08B82',
  lineColour: '#50C5AE',
  areaTop: 'rgba(80, 197, 174, 0.16)',
  areaBottom: 'rgba(80, 197, 174, 0.02)',
  volumeUp: 'rgba(80, 197, 174, 0.24)',
  volumeDown: 'rgba(240, 139, 130, 0.24)',
  smaLine: '#91BBFF',
  emaLine: '#EFC48D',
  bbandsUpper: '#CFABEB',
  bbandsMiddle: '#AFBAC8',
  bbandsLower: '#CFABEB',
  chartBackground: '#18212B',
  gridLines: '#263342',
  textColour: '#E6EDF5',
};
