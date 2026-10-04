import { describe, expect, it } from 'vitest';
import { render } from 'svelte/server';
import Renderer from './Renderer.svelte';
import type { RendererProps } from '../../types';
import type { RulerGeo, RulerParams, RulerStyle } from './tool';
import type { RulerStats } from './compute';

const props: RendererProps<RulerGeo, RulerParams, RulerStyle, RulerStats> = {
  drawable: {
    id: 'ruler',
    type: 'ruler',
    symbol: 'X',
    createdAt: 0,
    params: {},
    geometry: { startTime: 10, endTime: 20, startPrice: 100, endPrice: 110 },
    style: { upColor: 'green', downColor: 'red', showStats: true },
  },
  data: {
    priceDelta: 10,
    pctDelta: 10,
    isUp: true,
    barCount: 10,
    spanLabel: '1d',
    volumeSum: 1000,
  },
  selected: false,
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
};

describe('ruler compute presentation', () => {
  it.each(['pending', 'error'] as const)(
    'hides obsolete success stats while %s',
    status => {
      const html = render(Renderer, {
        props: { ...props, computeState: { status, workKey: 'new' } },
      }).body;
      expect(html).not.toContain('10 bars');
      expect(html).not.toContain('Vol 1.00K');
      expect(html).not.toContain('+10.00');
      expect(html).toContain('Ruler drawable');
    },
  );

  it('renders current replacement stats after success', () => {
    const html = render(Renderer, {
      props: {
        ...props,
        data: { ...props.data!, barCount: 20 },
        computeState: { status: 'success', workKey: 'new' },
      },
    }).body;
    expect(html).toContain('20 bars');
    expect(html).toContain('Vol 1.00K');
    expect(html).not.toContain('10 bars');
  });

  it('renders the complete adaptive distance and percentage label', () => {
    const html = render(Renderer, {
      props: {
        ...props,
        data: {
          ...props.data!,
          priceDelta: -2.7782258064516157e-8,
          pctDelta: -2.27,
        },
      },
    }).body;
    expect(html).toContain('−2.77823e-8 (−2.27%)');
    expect(html).toContain('w-max');
  });
});
