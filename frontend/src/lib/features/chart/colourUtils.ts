import {
  parse,
  hsv as toHsv,
  rgb as toRgb,
  formatHex,
  formatHex8,
  wcagContrast,
} from 'culori';

export interface HSVA {
  h: number; // 0–360
  s: number; // 0–1
  v: number; // 0–1
  a: number; // 0–1
}

const INVALID: HSVA = { h: 0, s: 0, v: 0, a: 1 };

/** Opaque labels use stronger contrast; translucent custom styles keep legacy text. */
export function contrastTextColour(background: string): string {
  const colour = parse(background);
  if (!colour || (colour.alpha ?? 1) < 1) return '#ffffff';
  return wcagContrast(colour, '#000000') >= wcagContrast(colour, '#ffffff')
    ? '#000000'
    : '#ffffff';
}

/** Parse any CSS colour string (#RRGGBB, #RRGGBBAA, rgba(...), named, etc.) into HSVA. */
export function cssColourToHsva(colour: string): HSVA {
  const parsed = parse(colour);
  if (!parsed) return INVALID;
  const c = toHsv(parsed);
  if (!c) return INVALID;
  return {
    h: c.h ?? 0,
    s: c.s ?? 0,
    v: c.v ?? 0,
    a: c.alpha ?? 1,
  };
}

/** Convert HSVA to hex string. #RRGGBB when alpha=1, #RRGGBBAA otherwise. */
export function hsvaToHex(hsva: HSVA): string {
  const c = {
    mode: 'hsv' as const,
    h: hsva.h,
    s: hsva.s,
    v: hsva.v,
    alpha: hsva.a,
  };
  return hsva.a >= 1 ? formatHex(c) : formatHex8(c);
}

/** Convert HSVA to CSS rgba() string (for use in style attributes). */
export function hsvaToRgba(hsva: HSVA): string {
  const c = toRgb({ mode: 'hsv', h: hsva.h, s: hsva.s, v: hsva.v });
  const r = Math.round((c?.r ?? 0) * 255);
  const g = Math.round((c?.g ?? 0) * 255);
  const b = Math.round((c?.b ?? 0) * 255);
  return `rgba(${r}, ${g}, ${b}, ${+hsva.a.toFixed(2)})`;
}
