import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { client, clientModule } from '$lib/features/chart/reactiveTestSupport';
import { deepCloneDrawableSnapshot } from '$lib/features/drawables/clone';

const url = new URL('./ToolSettingsModal.svelte', import.meta.url);
const source = readFileSync(url, 'utf8');
const condition = source.match(/\{#if (.+)\}/)![1];
const defaults = {
  ruler: { params: {}, style: { showStats: true } },
  avp: {
    params: { rowSize: 1, vaPercent: 0.7 },
    style: { showProfile: true, widthPct: 25 },
  },
};
type ToolType = keyof typeof defaults;
type Settings = {
  type: ToolType;
  params: { rowSize?: number; vaPercent?: number };
  style: { showStats?: boolean; showProfile?: boolean; widthPct?: number };
};

function fixture() {
  const tools = deepCloneDrawableSnapshot({
    ruler: { type: 'ruler', defaults: defaults.ruler },
    avp: { type: 'avp', defaults: defaults.avp },
  });
  const saveToolDefaults = vi.fn();
  const drawables = {
    items: [
      { id: 'avp-1', type: 'avp' },
      { id: 'ruler-1', type: 'ruler' },
    ],
    update: vi.fn(),
  };
  const inputs = Array.from({ length: 3 }, () => ({
    reportValidity: vi.fn(() => true),
  }));
  const component = clientModule<{
    default: (
      anchor: unknown,
      props: unknown,
    ) => {
      settings: () => Settings | null;
      applyAndClose: () => void;
      cancel: () => void;
      setPanel: (node: unknown) => void;
    };
  }>(
    url,
    {
      '$lib/components/ui/dialog': {},
      '$lib/features/drawables/ui/ModalFooter.svelte': {},
      '$lib/features/drawables': {
        getTool: (type: ToolType) => tools[type],
        drawables,
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
    export function setPanel(node) { panelEl = node; }
  </script>`,
  ).default;
  const props = client.proxy({ toolType: 'ruler' as ToolType, open: true });
  let modal!: ReturnType<typeof component>;
  const stop = client.effect_root(() => {
    modal = component(null, props);
  });
  client.flush();
  modal.setPanel({ querySelectorAll: () => inputs });
  return { props, modal, stop, tools, saveToolDefaults, drawables, inputs };
}

describe('tool settings staging', () => {
  it('can cancel invalid edits without validating or saving them', () => {
    const f = fixture();
    try {
      f.props.toolType = 'avp';
      client.flush();
      f.modal.settings()!.params.vaPercent = 1.01;
      f.inputs[1].reportValidity.mockReturnValue(false);
      f.modal.cancel();
      client.flush();
      f.props.open = true;
      client.flush();
      expect(f.modal.settings()!.params.vaPercent).toBe(0.7);
      expect(f.inputs[1].reportValidity).not.toHaveBeenCalled();
      expect(f.saveToolDefaults).not.toHaveBeenCalled();
      expect(f.drawables.update).not.toHaveBeenCalled();
    } finally {
      f.stop();
    }
  });

  it.each([0, 1, 2])(
    'rejects invalid numeric field %s without updating defaults or Elements',
    index => {
      const f = fixture();
      try {
        f.props.toolType = 'avp';
        client.flush();
        const settings = f.modal.settings()!;
        if (index === 0) settings.params.rowSize = 0;
        if (index === 1) settings.params.vaPercent = 1.01;
        if (index === 2) settings.style.widthPct = 101;
        f.inputs[index].reportValidity.mockReturnValue(false);
        f.modal.applyAndClose();
        expect(f.props.open).toBe(true);
        expect(f.inputs[index].reportValidity).toHaveBeenCalledOnce();
        expect(f.tools.avp.defaults).toEqual(defaults.avp);
        expect(f.saveToolDefaults).not.toHaveBeenCalled();
        expect(f.drawables.update).not.toHaveBeenCalled();

        settings.params.rowSize = 1;
        settings.params.vaPercent = 0.7;
        settings.style.widthPct = 25;
        f.inputs[index].reportValidity.mockReturnValue(true);
        f.modal.applyAndClose();
        expect(f.props.open).toBe(false);
        expect(f.saveToolDefaults).toHaveBeenCalledOnce();
        expect(f.drawables.update).toHaveBeenCalledExactlyOnceWith(
          'avp-1',
          defaults.avp,
        );
      } finally {
        f.stop();
      }
    },
  );

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
