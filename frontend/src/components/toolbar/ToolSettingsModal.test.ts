import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { client, clientModule } from '$lib/features/chart/reactiveTestSupport';
import { deepCloneDrawableSnapshot } from '$lib/features/drawables/clone';

const url = new URL('./ToolSettingsModal.svelte', import.meta.url);
const source = readFileSync(url, 'utf8');
const condition = source.match(/\{#if (.+)\}/)![1];
const defaults = {
  ruler: { params: {}, style: { showStats: true } },
  avp: { params: { rowSize: 1, vaPercent: 0.7 }, style: { showProfile: true } },
};
type ToolType = keyof typeof defaults;
type Settings = {
  type: ToolType;
  params: { rowSize?: number };
  style: { showStats?: boolean; showProfile?: boolean };
};

function fixture() {
  const tools = deepCloneDrawableSnapshot({
    ruler: { type: 'ruler', defaults: defaults.ruler },
    avp: { type: 'avp', defaults: defaults.avp },
  });
  const saveToolDefaults = vi.fn();
  const component = clientModule<{
    default: (
      anchor: unknown,
      props: unknown,
    ) => {
      settings: () => Settings | null;
      applyAndClose: () => void;
      cancel: () => void;
    };
  }>(
    url,
    {
      '$lib/components/ui/dialog': {},
      '$lib/features/drawables/ui/ModalFooter.svelte': {},
      '$lib/features/drawables': {
        getTool: (type: ToolType) => tools[type],
        drawables: { items: [] },
        saveToolDefaults,
        deepCloneDrawableSnapshot,
      },
      '$lib/core/modalLifecycle': {
        createModalLifecycle: () => ({ close: vi.fn() }),
      },
    },
    `${source.split('</script>')[0]}
    export function settings() { return (${condition}) ? { type: tool.type, params: stagedParams, style: stagedStyle } : null; }
    export { applyAndClose, cancel };
  </script>`,
  ).default;
  const props = client.proxy({ toolType: 'ruler' as ToolType, open: true });
  let modal!: ReturnType<typeof component>;
  const stop = client.effect_root(() => {
    modal = component(null, props);
  });
  client.flush();
  return { props, modal, stop, tools, saveToolDefaults };
}

describe('tool settings staging', () => {
  it('never renders a new tool with the previous tool’s bindable fields', () => {
    const f = fixture();
    try {
      expect(f.modal.settings()!.style.showStats).toBe(true);
      f.props.toolType = 'avp';
      expect(f.modal.settings()).toBeNull();
      client.flush();
      expect(f.modal.settings()).toMatchObject({
        type: 'avp',
        params: { rowSize: 1 },
        style: { showProfile: true },
      });
      f.props.toolType = 'ruler';
      expect(f.modal.settings()).toBeNull();
      client.flush();
      expect(f.modal.settings()).toMatchObject({
        type: 'ruler',
        style: { showStats: true },
      });
    } finally {
      f.stop();
    }
  });

  it('applies only staged values and discards canceled edits on reopen', () => {
    const f = fixture();
    try {
      f.modal.settings()!.style.showStats = false;
      expect(f.tools.ruler.defaults.style.showStats).toBe(true);
      f.modal.applyAndClose();
      client.flush();
      expect(f.tools.ruler.defaults.style.showStats).toBe(false);
      expect(f.saveToolDefaults).toHaveBeenCalledOnce();
      f.props.open = true;
      client.flush();
      f.modal.settings()!.style.showStats = true;
      f.modal.cancel();
      client.flush();
      f.props.open = true;
      client.flush();
      expect(f.modal.settings()!.style.showStats).toBe(false);
      expect(f.saveToolDefaults).toHaveBeenCalledOnce();
    } finally {
      f.stop();
    }
  });
});
