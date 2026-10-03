import { describe, expect, it, vi } from 'vitest';
import { render } from 'svelte/server';
import type { ComponentProps } from 'svelte';
import Renderer from './Renderer.svelte';
import { avpTool } from './tool';
import type { VolumeProfileResponse } from '../shared/types';

const profile: VolumeProfileResponse = {
  rowSize: 1,
  priceMin: 5,
  priceMax: 6,
  bins: [{ price: 5, upVol: 100, downVol: 0 }],
  poc: 5,
  val: 5,
  vah: 6,
  source: 'candle-distribution',
  provider: 'yahoo',
  symbol: 'TEST',
  interval: '1d',
  startTs: 1735689600,
  endTs: null,
  firstCandleTs: 1735689600,
  latestCandleTs: 1735776000,
};

function props(): ComponentProps<typeof Renderer> {
  return {
    drawable: {
      id: 'avp',
      type: 'avp',
      symbol: 'TEST',
      createdAt: 0,
      geometry: { time: 1735689600 },
      params: { ...avpTool.defaults.params },
      style: { ...avpTool.defaults.style },
    },
    data: profile,
    selected: false,
    coordMap: {
      version: 0,
      plotWidth: 600,
      plotHeight: 400,
      timeToX: () => 100,
      xToTime: () => 1735689600,
      priceToY: vi.fn((price: number) => 400 - price * 10),
      yToPrice: y => (400 - y) / 10,
    },
    onRequestSelect: vi.fn(),
    onGeometryChange: vi.fn(),
    onAnchorPoint: vi.fn(),
  };
}

function levelLines(html: string) {
  return html.match(/<line\b[^>]*stroke="(?:#ffeb3b|#2196f3)"[^>]*>/g) ?? [];
}

describe('AVP renderer states and semantics', () => {
  it('renders the entire one-row value area and identifies the estimate/source/window', () => {
    const html = render(Renderer, { props: props() }).body;
    expect(levelLines(html)).toHaveLength(3);
    expect(levelLines(html)[1]).toContain('y1="340"');
    expect(levelLines(html)[2]).toContain('y1="350"');
    expect(html).toContain('OHLCV estimate');
    expect(html).toContain('yahoo');
    expect(html).toContain('1d');
    expect(html).toContain('2025-01-01T00:00:00.000Z');
    expect(html).toContain('2025-01-02T00:00:00.000Z');
    expect(html).toContain('not order-flow delta');
  });

  it.each(['pending', 'error'] as const)(
    'suppresses old bars/levels while %s',
    status => {
      const p = props();
      p.computeState = {
        status,
        workKey: 'new-source',
        error: 'request failed',
      };
      const html = render(Renderer, { props: p }).body;
      expect(levelLines(html)).toHaveLength(0);
      expect(html).not.toContain('fill="#26a69a"');
      expect(html).not.toContain('2025-01-02');
      expect(html).toContain(
        status === 'pending' ? 'Computing' : 'unavailable',
      );
    },
  );

  it('shows pending without output and then displays a successful retry', () => {
    const p = props();
    p.data = undefined;
    expect(render(Renderer, { props: p }).body).toContain('Computing');
    p.computeState = { status: 'success', workKey: 'retry' };
    p.data = profile;
    expect(levelLines(render(Renderer, { props: p }).body)).toHaveLength(3);
  });

  it.each([false, true])(
    'no-volume state suppresses even legacy non-null levels (%s)',
    legacy => {
      const p = props();
      p.data = {
        ...profile,
        bins: [{ price: 5, upVol: 0, downVol: 0 }],
        poc: legacy ? 5 : null,
        vah: legacy ? 5 : null,
        val: legacy ? 5 : null,
      };
      const html = render(Renderer, { props: p }).body;
      expect(html).toContain('No volume');
      expect(levelLines(html)).toHaveLength(0);
      expect(html).not.toContain('fill="#26a69a"');
    },
  );

  it('never passes nullable unsupported levels to the price mapper', () => {
    const p = props();
    p.data = { ...profile, poc: null, vah: null, val: null };
    const html = render(Renderer, { props: p }).body;
    expect(levelLines(html)).toHaveLength(0);
    expect(p.coordMap.priceToY).not.toHaveBeenCalledWith(null);
  });

  it('does not label interval-less CSV with a chart interval', () => {
    const p = props();
    p.data = { ...profile, provider: 'csv', interval: null };
    const html = render(Renderer, { props: p }).body;
    expect(html).toContain('csv');
    expect(html).toContain('interval unknown');
    expect(html).not.toContain('1d');
  });
});
