import { describe, it, expect } from 'vitest';
import { render } from 'svelte/server';
import Renderer from './Renderer.svelte';
import type { RendererProps } from '../../types';
import {
  DEFAULT_POSITION_STYLE,
  type PositionGeo,
  type PositionParams,
  type PositionStyle,
} from './compute';
import type { PositionMetricsResponse } from './types';
import DrawablesSvgScene from '../../../../../components/chart/DrawablesSvgScene.svelte';
import type { BundledDrawable } from '../../bundledDrawable';

type Props = RendererProps<
  PositionGeo,
  PositionParams,
  PositionStyle,
  PositionMetricsResponse
>;
function props(over: Partial<Props> = {}): Props {
  return {
    drawable: {
      id: 'position',
      type: 'position-long',
      symbol: 'X',
      createdAt: 0,
      geometry: {
        startTime: 10,
        endTime: 20,
        entryPrice: 100,
        stopPrice: 95,
        targetPrice: 110,
      },
      style: DEFAULT_POSITION_STYLE,
      params: {},
    },
    data: { riskRewardRatio: 2 },
    selected: true,
    coordMap: {
      version: 0,
      plotWidth: 800,
      plotHeight: 400,
      timeToX: t => t,
      xToTime: x => x,
      priceToY: p => 300 - p,
      yToPrice: y => 300 - y,
    },
    onGeometryChange: () => {},
    onRequestSelect: () => {},
    onAnchorPoint: () => {},
    ...over,
  };
}

describe('position renderer current geometry and status', () => {
  it.each([
    ['position-long', -1],
    ['position-short', 1],
  ] as const)(
    'keeps complete invalid-level labels unwrapped for %s',
    (type, direction) => {
      const p = props();
      p.drawable.type = type;
      p.drawable.geometry.targetPrice = 100 + direction * 5.394249;
      p.drawable.geometry.stopPrice = 100 - direction * 4.458576;
      const html = render(Renderer, { props: p }).body;
      expect(html).toContain('Invalid target: 5.394249 price (5.394%)');
      expect(html).toContain('Invalid stop: 4.458576 price (4.459%)');
      expect(html).toContain('Invalid levels');
      expect(html.match(/whitespace-nowrap/g)).toHaveLength(3);
      expect(html.match(/w-max/g)).toHaveLength(3);
    },
  );

  it.each([
    [10, 20, 0, 0],
    [790, 800, 660, 656],
  ])(
    'clamps labels for time range %s–%s to the plot',
    (startTime, endTime, levelX, ratioX) => {
      const p = props();
      p.drawable.geometry.startTime = startTime;
      p.drawable.geometry.endTime = endTime;
      const html = render(Renderer, { props: p }).body;
      const positions = [...html.matchAll(/<foreignObject x="([^"]+)"/g)].map(
        match => Number(match[1]),
      );
      expect(positions).toEqual([levelX, levelX, ratioX]);
    },
  );

  it('forwards the current compute state through the real SVG scene', () => {
    const p = props();
    const html = render(DrawablesSvgScene, {
      props: {
        items: [p.drawable as BundledDrawable],
        coordMap: p.coordMap,
        computedData: new Map([['position', p.data]]),
        computedStates: new Map([
          ['position', { status: 'pending' as const, workKey: 'new' }],
        ]),
        selectedId: null,
        placement: null,
        toChartPoint: () => null,
        onPatchGeometry: () => {},
        onSelectDrawable: () => {},
        onAnchorPoint: () => {},
      },
    }).body;
    expect(html).toContain('Calculating…');
    expect(html).not.toContain('Risk/reward: 2.00');
  });
  it.each(['position-long', 'position-short'])(
    'rejects obsolete success numbers when %s direction becomes invalid',
    type => {
      const p = props();
      p.drawable.type = type;
      p.drawable.geometry.targetPrice = type === 'position-long' ? 90 : 110;
      p.drawable.geometry.stopPrice = type === 'position-long' ? 95 : 105;
      const html = render(Renderer, { props: p }).body;
      expect(html).toContain('Invalid levels');
      expect(html).toContain('Invalid target');
      expect(html).not.toContain('Risk/reward: 2.00');
      expect(html).not.toContain('background-color: rgb(38, 166, 154)');
    },
  );

  it.each([
    ['pending', 'Calculating…'],
    ['error', 'Calculation failed'],
  ] as const)(
    'does not render retained success RR in %s state',
    (status, text) => {
      const html = render(Renderer, {
        props: props({ computeState: { status, workKey: 'new' } }),
      }).body;
      expect(html).toContain(text);
      expect(html).not.toContain('Risk/reward: 2.00');
    },
  );

  it('renders replacement success and preserves supported target/stop/time handles', () => {
    const p = props({
      computeState: { status: 'success', workKey: 'new' },
      data: { riskRewardRatio: 3 },
      toChartPoint: () => ({ time: 10, price: 100 }),
    });
    const html = render(Renderer, { props: p }).body;
    expect(html).toContain('Risk/reward: 3.00');
    for (const label of [
      'Drag target price',
      'Drag stop price',
      'Drag band start time',
      'Drag band end time',
    ])
      expect(html).toContain(label);
  });

  it('keeps small nonzero distances nonzero and states price units', () => {
    const p = props();
    p.drawable.geometry = {
      startTime: 10,
      endTime: 20,
      entryPrice: 0.001,
      targetPrice: 0.00101,
      stopPrice: 0.000995,
    };
    const html = render(Renderer, { props: p }).body;
    expect(html).toContain('Target: 0.00001 price (1.000%)');
    expect(html).toContain('Stop: 0.000005 price (0.500%)');
    expect(html).not.toContain('Target: 0.00 ');
  });

  it.each([
    { entry: 1e-8, distance: 6e-14, label: '6e-14' },
    { entry: 1e15, distance: 1e12, label: '1e+12' },
  ])(
    'bounds extreme price distance labels: $label',
    ({ entry, distance, label }) => {
      const p = props();
      p.drawable.geometry = {
        startTime: 10,
        endTime: 20,
        entryPrice: entry,
        targetPrice: entry + distance,
        stopPrice: entry - distance,
      };
      const html = render(Renderer, { props: p }).body;
      expect(html).toContain(`Target: ${label} price`);
      expect(html).not.toContain('Invalid levels');
    },
  );
});
