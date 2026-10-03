import { describe, expect, it } from 'vitest';
import {
  client,
  clientModule,
  componentDeclarations,
} from '$lib/features/chart/reactiveTestSupport';
import { listToolbarDrawableTools } from '$lib/features/drawables';

type Ref = HTMLButtonElement | null;
type Refs = { position: Ref; tools: Record<string, Ref> };

const toolbarURL = new URL('./LeftToolbar.svelte', import.meta.url);
const toolbar = clientModule<{
  default: (anchor: unknown, props: unknown) => { refs: () => Refs };
}>(
  toolbarURL,
  { './tools': { listToolbarDrawableTools } },
  `<script lang="ts">
  import { listToolbarDrawableTools } from './tools';
  ${componentDeclarations(toolbarURL, ['tools', 'positionTrigger', 'toolTriggers'])}
  export function refs() { return { position: positionTrigger, tools: toolTriggers }; }
</script>`,
).default;

// Exercise the same Svelte bindable fallback used by Bits UI's Trigger.
const trigger = clientModule<{
  default: (anchor: unknown, props: unknown) => { read: () => Ref };
}>(
  toolbarURL,
  {},
  `<script lang="ts">
  let { ref = $bindable<HTMLButtonElement | null>(null) } = $props();
  export function read() { return ref; }
</script>`,
).default;

describe('toolbar trigger binding lifecycle', () => {
  it('initializes every registered tool ref before binding a component fallback', () => {
    const stop = client.effect_root(() => {
      const refs = toolbar(null, {}).refs();
      const types = listToolbarDrawableTools().map(tool => tool.type);
      expect(Object.keys(refs.tools)).toEqual(types);
      const bindings = [
        { ref: refs.position },
        ...types.map(type => ({
          get ref() {
            return refs.tools[type];
          },
          set ref(value: Ref) {
            refs.tools[type] = value;
          },
        })),
      ];
      for (const binding of bindings) {
        const component = trigger(null, binding);
        expect(component.read()).toBeNull();
        const mounted = {} as HTMLButtonElement;
        binding.ref = mounted;
        expect(component.read()).toBe(mounted);
        binding.ref = null;
        expect(component.read()).toBeNull();
      }
    });
    stop();
  });

  it('rejects an undefined ref bound to a fallback (negative control)', () => {
    const stop = client.effect_root(() => {
      expect(() =>
        trigger(null, {
          get ref() {
            return undefined;
          },
          set ref(_value: Ref | undefined) {},
        }),
      ).toThrow('props_invalid_value');
    });
    stop();
  });
});
