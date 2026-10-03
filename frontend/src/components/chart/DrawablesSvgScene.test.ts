import { describe, expect, it } from 'vitest';
import { render } from 'svelte/server';
import type { ComponentProps } from 'svelte';
import DrawablesSvgScene from './DrawablesSvgScene.svelte';
import { getTool, type BundledDrawable } from '$lib/features/drawables';
import type { VolumeProfileResponse } from '$lib/features/drawables/tools/volume-profile/shared/types';

const types = ['ruler', 'avp', 'position-long', 'position-short'] as const;
function item(type: (typeof types)[number], id: string): BundledDrawable {
  const tool = getTool(type)!;
  const geometry =
    type === 'ruler'
      ? { startTime: 10, endTime: 20, startPrice: 100, endPrice: 110 }
      : type === 'avp'
        ? { time: 10 }
        : {
            startTime: 10,
            endTime: 20,
            entryPrice: 100,
            stopPrice: type === 'position-long' ? 95 : 105,
            targetPrice: type === 'position-long' ? 110 : 90,
          };
  return {
    id,
    type,
    symbol: 'AAA',
    createdAt: 0,
    geometry,
    params: tool.defaults.params,
    style: tool.defaults.style,
  } as BundledDrawable;
}
function props(
  items: BundledDrawable[],
): ComponentProps<typeof DrawablesSvgScene> {
  return {
    items,
    selectedId: null,
    placement: null,
    coordMap: {
      version: 0,
      plotWidth: 600,
      plotHeight: 400,
      timeToX: t => t,
      xToTime: x => x,
      priceToY: p => 400 - p,
      yToPrice: y => 400 - y,
    },
    computedData: new Map(),
    computedStates: new Map(),
    toChartPoint: () => null,
    onPatchGeometry: () => {},
    onSelectDrawable: () => {},
    onAnchorPoint: () => {},
  };
}
const hitOrder = (html: string) => [
  ...new Set(
    [...html.matchAll(/data-drawable-id="([^"]+)"/g)].map(match => match[1]),
  ),
];

describe('drawable scene integration', () => {
  it.each(types.flatMap(selected => types.map(other => ({ selected, other }))))(
    'keeps selected $selected above overlapping $other without changing stored order',
    ({ selected, other }) => {
      const items = [item(selected, 'selected'), item(other, 'other')];
      const p = props(items);
      p.selectedId = 'selected';
      expect(hitOrder(render(DrawablesSvgScene, { props: p }).body)).toEqual([
        'other',
        'selected',
      ]);
      expect(items.map(d => d.id)).toEqual(['selected', 'other']);
      p.selectedId = null;
      expect(hitOrder(render(DrawablesSvgScene, { props: p }).body)).toEqual([
        'selected',
        'other',
      ]);
    },
  );

  it.each(['pending', 'error', 'success'] as const)(
    'passes AVP %s status alongside its response metadata',
    status => {
      const profile: VolumeProfileResponse = {
        rowSize: 1,
        priceMin: 5,
        priceMax: 6,
        bins: [{ price: 5, upVol: 100, downVol: 0 }],
        poc: 5,
        vah: 6,
        val: 5,
        source: 'candle-distribution',
        provider: 'csv',
        symbol: 'AAA',
        interval: null,
        startTs: 10,
        endTs: null,
        firstCandleTs: 10,
        latestCandleTs: 20,
      };
      const p = props([item('avp', 'profile')]);
      p.computedData.set('profile', profile);
      p.computedStates.set('profile', { status, workKey: 'current' });
      const html = render(DrawablesSvgScene, { props: p }).body;
      expect(html).toContain(
        status === 'pending'
          ? 'Computing AVP'
          : status === 'error'
            ? 'AVP unavailable'
            : 'OHLCV estimate',
      );
      if (status !== 'success') {
        expect(html).not.toContain('1970-01-01');
        expect(html).not.toContain('stroke="#ffeb3b"');
      } else {
        expect(html).toContain('interval unknown');
        expect(html).toContain('1970-01-01T00:00:20.000Z');
      }
    },
  );
});
