import { readFileSync } from 'node:fs';
import { render } from 'svelte/server';
import { describe, expect, it } from 'vitest';
import { client, clientModule } from '$lib/features/chart/reactiveTestSupport';
import NumberField from './NumberField.svelte';

const url = new URL('./NumberField.svelte', import.meta.url);

describe('Element numeric fields', () => {
  it('requires a value and preserves native range and step constraints', () => {
    const { body } = render(NumberField, {
      props: {
        label: 'Value area %',
        value: 0.7,
        min: 0.01,
        max: 1,
        step: 0.01,
      },
    });
    expect(body).toContain('required');
    expect(body).toContain('min="0.01"');
    expect(body).toContain('max="1"');
    expect(body).toContain('step="0.01"');
    expect(body).toContain('value="0.7"');
  });

  it.each([NaN, Infinity, -Infinity, 0, 0.01, 1, 1.01])(
    'only stages finite input %s, leaving bounds to native validity',
    number => {
      const component = clientModule<{
        default: (
          anchor: unknown,
          props: unknown,
        ) => {
          updateValue: (event: Event) => void;
          readValue: () => number;
        };
      }>(
        url,
        { './Field.svelte': {} },
        `${readFileSync(url, 'utf8').split('</script>')[0]}
        export { updateValue };
        export function readValue() { return value; }
      </script>`,
      ).default;
      let field!: ReturnType<typeof component>;
      const stop = client.effect_root(() => {
        field = component(
          null,
          client.proxy({ label: 'Value area %', value: 0.7 }),
        );
      });
      try {
        field.updateValue({
          currentTarget: { valueAsNumber: number },
        } as unknown as Event);
        expect(field.readValue()).toBe(Number.isFinite(number) ? number : 0.7);
      } finally {
        stop();
      }
    },
  );
});
