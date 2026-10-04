import { render } from 'svelte/server';
import { describe, expect, it } from 'vitest';
import ColorField from './ColorField.svelte';
import ColourSwatch from '../../../../components/chart/ColourSwatch.svelte';

describe('Element settings color labels', () => {
  it.each(['Up candle colour', 'POC colour', 'Target', 'Stop'])(
    'names the %s color trigger without repeating its visible field label',
    label => {
      const { body } = render(ColorField, {
        props: { label, value: '#123456' },
      });
      expect(body).toContain(`aria-label="Pick colour for ${label}"`);
      expect(body.match(new RegExp(`>${label}<`, 'g'))).toHaveLength(1);
    },
  );

  it('retains the visible-label default for other chart swatches', () => {
    const { body } = render(ColourSwatch, {
      props: { label: 'Background', colour: '#123456' },
    });
    expect(body).toContain('aria-label="Pick colour for Background"');
  });
});
