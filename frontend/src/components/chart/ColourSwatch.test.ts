import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import colourSwatchSource from './ColourSwatch.svelte?raw';
import colourPickerSource from './ColourPicker.svelte?raw';
import dialogContentSource from '$lib/components/ui/dialog/dialog-content.svelte?raw';

const styles = readFileSync(
  new URL('../../styles.css', import.meta.url),
  'utf8',
);

function zIndex(source: string): number {
  const layer = source.match(/z-\((--z-[\w-]+)\)/)?.[1];
  const value = layer && styles.match(new RegExp(`${layer}: (\\d+);`))?.[1];
  if (!value) throw new Error('Expected a z-index layer token');
  return Number(value);
}

describe('ColourSwatch', () => {
  it('bounds nested picker height to collision space and scrolls offscreen controls', () => {
    expect(colourSwatchSource).toContain('collisionPadding={8}');
    expect(colourSwatchSource).toContain(
      'min(var(--bits-popover-content-available-height, 100dvh), calc(100dvh - 1rem))',
    );
    expect(colourSwatchSource).toContain('overflow-y-auto overscroll-contain');
  });

  it('shrinks picker geometry and input below its normal width', () => {
    expect(colourSwatchSource).toContain('max-w-[calc(100dvw-1rem)]');
    expect(
      colourPickerSource.match(/width: 100%; max-width: \{GRAD_W\}px/g),
    ).toHaveLength(3);
    expect(colourPickerSource).toContain('class="min-w-0 flex-1');
  });

  it('layers its picker above dialogs that contain the swatch', () => {
    expect(zIndex(colourSwatchSource)).toBeGreaterThan(
      zIndex(dialogContentSource),
    );
  });
});
