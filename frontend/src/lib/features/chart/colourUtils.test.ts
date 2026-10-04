import { describe, it, expect } from 'vitest';
import {
  cssColourToHsva,
  hsvaToHex,
  hsvaToRgba,
  contrastTextColour,
} from './colourUtils';
import { wcagContrast } from 'culori';
import rulerRendererSource from '$lib/features/drawables/tools/ruler/Renderer.svelte?raw';
import positionRendererSource from '$lib/features/drawables/tools/position/Renderer.svelte?raw';

describe('opaque Element label contrast', () => {
  it.each([
    ['rgb(38, 166, 154)', '#000000'],
    ['rgb(239, 83, 80)', '#000000'],
    ['#26a69a', '#000000'],
    ['#ef5350', '#000000'],
    ['#777777', '#000000'],
    ['#737373', '#ffffff'],
    ['black', '#ffffff'],
    ['white', '#000000'],
    ['hsl(240, 100%, 20%)', '#ffffff'],
  ])('chooses readable text on %s', (background, expected) => {
    const foreground = contrastTextColour(background);
    expect(foreground).toBe(expected);
    expect(wcagContrast(background, foreground)).toBeGreaterThanOrEqual(4.5);
  });

  it('falls back safely for an unsupported colour', () => {
    expect(contrastTextColour('not-a-colour')).toBe('#ffffff');
  });

  it.each(['#26a69a80', 'rgba(38, 166, 154, 0)', 'rgba(38, 166, 154, 0.9)'])(
    'retains legacy text for translucent custom style %s',
    background => {
      expect(contrastTextColour(background)).toBe('#ffffff');
    },
  );

  it('applies contrast text to every numeric chip without dimming Ruler details', () => {
    expect(
      rulerRendererSource.match(/style:color=\{contrastTextColour/g),
    ).toHaveLength(1);
    expect(
      positionRendererSource.match(/style:color=\{contrastTextColour/g),
    ).toHaveLength(3);
    expect(rulerRendererSource).not.toContain('style:opacity="0.9"');
    expect(rulerRendererSource).not.toContain('text-white');
    expect(positionRendererSource).not.toContain('text-white');
  });
});

describe('cssColourToHsva', () => {
  it('parses #RRGGBB', () => {
    const result = cssColourToHsva('#ff0000');
    expect(result.h).toBeCloseTo(0, 0);
    expect(result.s).toBeCloseTo(1, 1);
    expect(result.v).toBeCloseTo(1, 1);
    expect(result.a).toBe(1);
  });

  it('parses #RRGGBBAA', () => {
    const result = cssColourToHsva('#26a63130');
    expect(result.a).toBeCloseTo(0.19, 1);
  });

  it('parses rgba() strings', () => {
    const result = cssColourToHsva('rgba(56, 33, 110, 0.5)');
    expect(result.a).toBeCloseTo(0.5, 1);
    expect(result.h).toBeGreaterThan(250);
    expect(result.h).toBeLessThan(270);
  });

  it('returns black for invalid input', () => {
    const result = cssColourToHsva('not-a-colour');
    expect(result).toEqual({ h: 0, s: 0, v: 0, a: 1 });
  });

  it('preserves pure white', () => {
    const result = cssColourToHsva('#ffffff');
    expect(result.s).toBe(0);
    expect(result.v).toBe(1);
  });

  it('preserves pure green hue', () => {
    const result = cssColourToHsva('#00ff00');
    expect(result.h).toBeCloseTo(120, 0);
    expect(result.s).toBeCloseTo(1, 1);
    expect(result.v).toBeCloseTo(1, 1);
  });
});

describe('hsvaToHex', () => {
  it('converts red with full alpha to #RRGGBB', () => {
    expect(hsvaToHex({ h: 0, s: 1, v: 1, a: 1 })).toBe('#ff0000');
  });

  it('converts with alpha < 1 to #RRGGBBAA', () => {
    const hex = hsvaToHex({ h: 0, s: 1, v: 1, a: 0.5 });
    expect(hex).toBe('#ff000080');
  });

  it('converts black', () => {
    expect(hsvaToHex({ h: 0, s: 0, v: 0, a: 1 })).toBe('#000000');
  });

  it('converts white', () => {
    expect(hsvaToHex({ h: 0, s: 0, v: 1, a: 1 })).toBe('#ffffff');
  });
});

describe('hsvaToRgba', () => {
  it('converts red to rgba string', () => {
    expect(hsvaToRgba({ h: 0, s: 1, v: 1, a: 0.5 })).toBe(
      'rgba(255, 0, 0, 0.5)',
    );
  });
});

describe('round-trip: hex → HSVA → hex', () => {
  const cases = [
    '#ff0000',
    '#00ff00',
    '#0000ff',
    '#ffffff',
    '#000000',
    '#2962FF',
    '#FF6D00',
  ];
  for (const hex of cases) {
    it(`round-trips ${hex}`, () => {
      const hsva = cssColourToHsva(hex);
      const result = hsvaToHex(hsva);
      expect(result.toLowerCase()).toBe(hex.toLowerCase());
    });
  }
});
