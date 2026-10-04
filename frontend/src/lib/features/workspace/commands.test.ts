import { describe, it, expect, vi } from 'vitest';
import { render } from 'svelte/server';
import { readFileSync } from 'node:fs';
import {
  client,
  clientModule,
  componentDeclarations,
} from '../chart/reactiveTestSupport';
import CommandPalette from '../../../components/dialogs/CommandPalette.svelte';
import {
  filterCommands,
  isCommandShortcut,
  type ResearchCommand,
} from './commands';

const commands: ResearchCommand[] = [
  {
    id: 'strategy:1',
    title: 'Momentum test',
    group: 'Strategy',
    detail: 'saved script',
    action: vi.fn(),
  },
  {
    id: 'run:1',
    title: 'Momentum baseline',
    group: 'Run',
    detail: 'baseline SPY',
    action: vi.fn(),
  },
  { id: 'drawing:ruler', title: 'Ruler', group: 'Drawing', action: vi.fn() },
];
describe('research commands', () => {
  it('focuses the persistent Tools launcher before opening a selected toolbox destination', async () => {
    const toolbox = new URL(
      '../../../components/toolbar/ToolboxPanel.svelte',
      import.meta.url,
    );
    const order: string[] = [];
    const module = clientModule<{
      default: (
        anchor: unknown,
        props: unknown,
      ) => { choose: (title: string) => Promise<void> };
    }>(
      toolbox,
      {
        'test:focus': {
          focus: () => order.push('focus'),
          select: (title: string) => order.push(title),
        },
      },
      `<script lang="ts">
      import { focus, select } from 'test:focus';
      import { tick } from 'svelte';
      let open = $state(true), progress = 1;
      const animateTo = () => {}, dialogEl = null;
      const triggerEl = { ownerDocument: { querySelectorAll: () => [] }, focus };
      const onTileSelect = select;
      ${componentDeclarations(toolbox, ['close', 'focusTrigger', 'selectTile'])}
      export function choose(title) { return selectTile(title); }
    </script>`,
    );
    let harness!: ReturnType<typeof module.default>;
    const stop = client.effect_root(() => {
      harness = module.default(null, {});
    });
    try {
      await harness.choose('Commands');
      expect(order).toEqual(['focus', 'Commands']);
    } finally {
      stop();
    }
  });

  it('allows native focus restoration and executes the command only after palette close completes', () => {
    const palette = new URL(
      '../../../components/dialogs/CommandPalette.svelte',
      import.meta.url,
    );
    const source = readFileSync(palette, 'utf8');
    expect(source.match(/<Dialog.Content[\s\S]*?>/)?.[0]).not.toContain(
      'onCloseAutoFocus',
    );
    const module = clientModule<{
      default: (
        anchor: unknown,
        props: unknown,
      ) => {
        choose: (action: () => void) => void;
        complete: (open: boolean) => void;
      };
    }>(
      palette,
      {},
      `<script lang="ts">
      let open = $state(true);
      ${componentDeclarations(palette, ['pendingAction', 'select', 'closed'])}
      export function choose(action) { select(action); }
      export function complete(isOpen) { closed(isOpen); }
    </script>`,
    );
    let harness!: ReturnType<typeof module.default>;
    const stop = client.effect_root(() => {
      harness = module.default(null, {});
    });
    try {
      const action = vi.fn();
      harness.choose(action);
      expect(action).not.toHaveBeenCalled();
      harness.complete(true);
      expect(action).not.toHaveBeenCalled();
      harness.complete(false);
      harness.complete(false);
      expect(action).toHaveBeenCalledTimes(1);
    } finally {
      stop();
    }
  });

  it('searches names, categories, and metadata with multiple case-insensitive terms', () => {
    expect(filterCommands(commands, 'BASELINE spy').map(c => c.id)).toEqual([
      'run:1',
    ]);
    expect(
      filterCommands(commands, 'strategy momentum').map(c => c.id),
    ).toEqual(['strategy:1']);
    expect(filterCommands(commands, '')).toHaveLength(3);
    expect(filterCommands(commands, 'unmatched')).toEqual([]);
    expect(commands[0].action).not.toHaveBeenCalled();
  });
  it('recognizes platform keyboard shortcuts without stealing typing or composition', () => {
    const event = {
      key: 'k',
      ctrlKey: true,
      metaKey: false,
      shiftKey: false,
      altKey: false,
      isComposing: false,
      repeat: false,
    };
    expect(isCommandShortcut(event)).toBe(true);
    expect(
      isCommandShortcut({ ...event, key: 'K', ctrlKey: false, metaKey: true }),
    ).toBe(true);
    for (const change of [
      { ctrlKey: false },
      { altKey: true },
      { shiftKey: true },
      { isComposing: true },
      { repeat: true },
      { key: 'a' },
    ])
      expect(isCommandShortcut({ ...event, ...change })).toBe(false);
  });
  it('renders accessible search without loading scripts or executing an action during server rendering', () => {
    const onLoadScripts = vi.fn();
    const { body } = render(CommandPalette, {
      props: { open: true, commands, onSymbol: vi.fn(), onLoadScripts },
    });
    expect(body).toContain('Research commands');
    expect(body).toContain('Search research commands');
    expect(body).toContain('role="combobox"');
    expect(body).toContain('role="listbox"');
    expect(body).toContain('Momentum test');
    expect(body).toContain('Escape to close');
    expect(onLoadScripts).not.toHaveBeenCalled();
    expect(commands[0].action).not.toHaveBeenCalled();
  });
});
