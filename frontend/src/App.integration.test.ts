import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { writable } from 'svelte/store';
import {
  client,
  clientModule,
  componentDeclarations,
  deferred,
} from '$lib/features/chart/reactiveTestSupport';
import {
  filterCommands,
  isCommandShortcut,
  type ResearchCommand,
} from '$lib/features/workspace/commands';
import { RunsHistory } from '$lib/features/runs/runsHistory.svelte';
import { CompareState } from '$lib/features/runs/compareState.svelte';
import type { RunDiff } from '$lib/features/runs/runTypes';
import { BacktestState } from '$lib/features/backtest/backtestState.svelte';

const app = new URL('./App.svelte', import.meta.url);
const cleanups: (() => void)[] = [];
afterEach(() => {
  cleanups
    .splice(0)
    .reverse()
    .forEach(stop => stop());
  vi.unstubAllGlobals();
});

function mountActions() {
  class Element {}
  const trigger = new Element();
  let modal = false;
  const document = {
    activeElement: trigger,
    querySelector: vi.fn(() => (modal ? {} : null)),
  };
  vi.stubGlobal('HTMLElement', Element);
  vi.stubGlobal('document', document);
  const module = clientModule<{
    default: (
      anchor: null,
      props: unknown,
    ) => {
      key: (event: KeyboardEvent) => void;
      header: () => void;
      completeCommand: () => void;
      commands: () => ResearchCommand[];
      read: () => {
        commandsOpen: boolean;
        guidedExampleOpen: boolean;
        guidedExampleReturnFocus: unknown;
      };
    };
  }>(
    app,
    {
      'test:commands': { isCommandShortcut },
      'test:auth': { authState: writable({ user: null }) },
    },
    `<script lang="ts">
    import { isCommandShortcut } from 'test:commands';
    import { authState } from 'test:auth';
    const groups = [], runsHistory = { entries: [] }, listTools = () => [];
    const openResearchWorkspaces = () => {};
    ${componentDeclarations(app, ['commandsOpen', 'guidedExampleOpen', 'guidedExampleReturnFocus', 'commandsReturnFocus', 'focusedElement', 'openGuidedExample', 'openResearchCommands', 'handleCommandKey', 'researchCommands'])}
    export function key(event) { handleCommandKey(event); }
    export function header() { openGuidedExample(); }
    export function completeCommand() {
      commandsOpen = false;
      researchCommands.find(command => command.id === 'guided-example').action();
    }
    export function commands() { return researchCommands; }
    export function read() { return { commandsOpen, guidedExampleOpen, guidedExampleReturnFocus }; }
  </script>`,
  );
  let harness!: ReturnType<typeof module.default>;
  cleanups.push(
    client.effect_root(() => {
      harness = module.default(null, {});
    }),
  );
  return {
    harness,
    trigger,
    document,
    setModal: (value: boolean) => {
      modal = value;
    },
  };
}

function shortcut(changes: Partial<KeyboardEvent> = {}): KeyboardEvent {
  return {
    key: 'k',
    ctrlKey: true,
    metaKey: false,
    altKey: false,
    shiftKey: false,
    isComposing: false,
    repeat: false,
    defaultPrevented: false,
    preventDefault: vi.fn(),
    ...changes,
  } as unknown as KeyboardEvent;
}

describe('release-foundation workbench integration', () => {
  it('opens the guide from the header without invoking workspace mutation actions', () => {
    const { harness, trigger } = mountActions();
    harness.header();
    expect(harness.read()).toEqual({
      commandsOpen: false,
      guidedExampleOpen: true,
      guidedExampleReturnFocus: trigger,
    });
    const source = readFileSync(app, 'utf8');
    expect(source).toContain('onguidedexample={() => openGuidedExample()}');
    expect(source).toContain(
      '<GuidedExampleDialog bind:open={guidedExampleOpen} returnFocus={guidedExampleReturnFocus} />',
    );
    expect(componentDeclarations(app, ['openGuidedExample'])).not.toMatch(
      /activateCommand|closeResearchPanels|workspace|draft|chart/,
    );
  });

  it('searches the actual guided command and retains the pre-palette return target', () => {
    const { harness, trigger, document } = mountActions();
    expect(
      filterCommands(harness.commands(), 'synthetic first ten'),
    ).toMatchObject([{ id: 'guided-example' }]);
    harness.key(shortcut());
    expect(harness.read().commandsOpen).toBe(true);
    document.activeElement = {};
    harness.completeCommand();
    expect(harness.read()).toEqual({
      commandsOpen: false,
      guidedExampleOpen: true,
      guidedExampleReturnFocus: trigger,
    });
  });

  it('toggles the palette but leaves other modals and already-handled shortcuts alone', () => {
    const { harness, setModal } = mountActions();
    setModal(true);
    const blocked = shortcut();
    harness.key(blocked);
    expect(blocked.preventDefault).not.toHaveBeenCalled();
    expect(harness.read().commandsOpen).toBe(false);
    setModal(false);
    const handled = shortcut({ defaultPrevented: true });
    harness.key(handled);
    expect(handled.preventDefault).not.toHaveBeenCalled();
    const mac = shortcut({ ctrlKey: false, metaKey: true });
    harness.key(mac);
    expect(mac.preventDefault).toHaveBeenCalledOnce();
    setModal(true);
    harness.key(shortcut());
    expect(harness.read().commandsOpen).toBe(false);
    harness.header();
    setModal(false);
    const guide = shortcut();
    harness.key(guide);
    expect(guide.preventDefault).not.toHaveBeenCalled();
  });

  it.each(['success', 'failure'])(
    'invalidates notebook import and comparison across same-turn A→B→A (%s)',
    async completion => {
      const storage = new Map<string, string>();
      const history = new RunsHistory({
        getItem: (key: string) => storage.get(key) ?? null,
        setItem: (key: string, value: string) => {
          storage.set(key, value);
        },
      } as Storage);
      history.record({
        run_id: 'guest',
        kind: 'single',
        label: 'Guest',
        created_at: '2026-01-01T00:00:00Z',
      });
      const response = deferred<RunDiff>();
      const comparison = new CompareState({
        compareRuns: () => response.promise,
        getRun: vi.fn(),
        rerunRun: vi.fn(),
      });
      const authState = writable<{ user: { id: string } | null }>({
        user: { id: 'a' },
      });
      expect(readFileSync(app, 'utf8')).toContain(
        'onMount(subscribeNotebookAccount);',
      );
      const module = clientModule<{
        default: (
          anchor: null,
          props: unknown,
        ) => {
          read: () => boolean;
          open: () => void;
          resultState: () => BacktestState;
          resultOpen: () => boolean;
        };
      }>(
        app,
        {
          'test:owners': {
            authState,
            runsHistory: history,
            compareState: comparison,
            BacktestState,
          },
        },
        `<script lang="ts">
      import { authState, runsHistory, compareState, BacktestState } from 'test:owners';
      import { untrack } from 'svelte';
      let compareOpen = $state(false);
      let backtest = $state(new BacktestState());
      let backtestOpen = $state(true);
      let portfolioRunId = $state('private');
      ${componentDeclarations(app, ['backtestOwner', 'subscribeNotebookAccount'])}
      const unsubscribe = subscribeNotebookAccount();
      $effect(() => unsubscribe);
      export function read() { return compareOpen; }
      export function open() { compareOpen = true; }
      export function resultState() { return backtest; }
      export function resultOpen() { return backtestOpen; }
    </script>`,
      );
      let harness!: ReturnType<typeof module.default>;
      cleanups.push(
        client.effect_root(() => {
          harness = module.default(null, {});
        }),
      );
      expect(history.entries).toEqual([]);
      history.record({
        run_id: 'private',
        kind: 'single',
        label: 'Private',
        created_at: '2026-01-01T00:00:00Z',
      });
      const metadata = history.exportMetadata(),
        owner = history.accountVersion;
      harness.open();
      const pending = comparison.load('one', 'two');
      const previousResult = harness.resultState();
      const disposed = vi.spyOn(previousResult, 'dispose');
      authState.set({ user: { id: 'a' } });
      expect(harness.resultState()).toBe(previousResult);
      expect(disposed).not.toHaveBeenCalled();
      authState.set({ user: { id: 'b' } });
      expect(disposed).toHaveBeenCalledOnce();
      expect(harness.resultState()).not.toBe(previousResult);
      expect(harness.resultOpen()).toBe(false);
      expect(history.entries).toEqual([]);
      authState.set({ user: { id: 'a' } });
      expect(history.entries.map(entry => entry.run_id)).toEqual(['private']);
      expect(() => history.importMetadata(metadata, owner)).toThrow(
        /account|changed/i,
      );
      if (completion === 'success') response.resolve({} as RunDiff);
      else response.reject(new Error('Obsolete failure'));
      await pending;
      expect(comparison.diff).toBeNull();
      expect(comparison.error).toBeNull();
      expect(harness.read()).toBe(false);
      authState.set({ user: null });
      expect(history.entries.map(entry => entry.run_id)).toEqual(['guest']);
    },
  );
});
