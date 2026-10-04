import { describe, expect, it } from 'vitest';
import colourSwatchSource from './ColourSwatch.svelte?raw';
import colourPickerSource from './ColourPicker.svelte?raw';
import dialogContentSource from '$lib/components/ui/dialog/dialog-content.svelte?raw';

function zIndex(source: string): number {
  const match = source.match(/z-\[(\d+)\]/);
  if (!match) throw new Error('Expected an explicit z-index class');
  return Number(match[1]);
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
