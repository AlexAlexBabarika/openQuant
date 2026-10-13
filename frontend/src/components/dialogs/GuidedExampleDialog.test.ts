import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { compile, parse } from 'svelte/compiler';
import { render } from 'svelte/server';
import { writable } from 'svelte/store';
import {
  client,
  clientModule,
  deferred,
} from '$lib/features/chart/reactiveTestSupport';
import * as evidence from '$lib/features/trial/evidence';
import * as workspace from '$lib/features/trial/workspace';
import * as recovery from '$lib/features/trial/recovery';
import { readTrialShareConfig } from '$lib/features/trial-report/sharing';
import type {
  ResearchReview,
  TrialStrategy,
} from '$lib/features/trial-report/types';
import GuidedExampleDialog from './GuidedExampleDialog.svelte';

// SSR exercises the complete guide markup; modal DOM/focus containment is the
// integration browser tester's responsibility, not this shell-only harness.
vi.mock('$lib/components/ui/dialog', () => {
  type Props = { open?: boolean; children?: (payload: unknown) => void };
  const content = (payload: unknown, props: Props) => props.children?.(payload);
  return {
    Root: (payload: unknown, props: Props) => {
      if (props.open) content(payload, props);
    },
    Content: content,
    Header: content,
    Title: content,
    Description: content,
    Footer: content,
  };
});

const guideUrl = new URL('./GuidedExampleDialog.svelte', import.meta.url);
const guideSource = readFileSync(guideUrl, 'utf8');
const cleanups: (() => void)[] = [];
afterEach(() => {
  cleanups
    .splice(0)
    .reverse()
    .forEach(cleanup => cleanup());
  vi.unstubAllGlobals();
});

async function settle() {
  for (let i = 0; i < 8; i++) {
    client.flush();
    await Promise.resolve();
  }
  client.flush();
}

function mountGuide(returnFocus: HTMLElement | null = null) {
  const module = clientModule<{
    default: (
      anchor: null,
      props: unknown,
    ) => {
      setOpen: (value: boolean) => void;
      start: () => void;
      close: () => void;
      move: (direction: -1 | 1) => void;
      setHeading: (element: HTMLHeadingElement) => void;
      focus: (event: Event) => void;
      restore: (event: Event) => void;
      read: () => {
        open: boolean;
        step: number;
        exampleStarted: boolean;
        title: string;
        instruction: string;
      };
    };
  }>(
    guideUrl,
    {
      '$lib/components/ui/dialog': {},
      '$lib/features/trial/StrategyTrial.svelte': {},
    },
    `${guideSource.split('</script>')[0]}
    export function setOpen(value: boolean) { open = value; }
    export function start() { startExample(); }
    export function close() { closeGuide(); }
    export function move(direction: -1 | 1) { moveStep(direction); }
    export function setHeading(element: HTMLHeadingElement) { heading = element; }
    export function focus(event: Event) { focusGuide(event); }
    export function restore(event: Event) { restoreFocus(event); }
    export function read() { return { open, step, exampleStarted, title: steps[step].title, instruction: steps[step].instruction }; }
  </script>`,
  );
  let guide!: ReturnType<typeof module.default>;
  cleanups.push(
    client.effect_root(() => {
      guide = module.default(null, { open: false, returnFocus });
    }),
  );
  return guide;
}

const strategy: TrialStrategy = {
  id: 'backtest-billionaire',
  name: 'Synthetic scenario',
  description: 'Deterministic test scenario',
  lesson: 'Compare costs and holdout',
};

function jsonResponse(value: unknown): Response {
  return { ok: true, json: async () => value } as Response;
}

function mountTrial(
  apiFetch: ReturnType<typeof vi.fn>,
  user: { id: string } | null = null,
  context?: workspace.WorkspaceContext,
  storage?: recovery.ReviewStorage,
  fingerprint = recovery.reviewInputFingerprint,
) {
  const storageAccess = vi.fn(() => storage ?? globalThis.localStorage);
  vi.stubGlobal('window', {
    location: { search: '' },
    get localStorage() {
      return storageAccess();
    },
  });
  const url = new URL(
    '../../lib/features/trial/StrategyTrial.svelte',
    import.meta.url,
  );
  const script = readFileSync(url, 'utf8')
    .split('</script>')[0]
    .replace("from 'svelte'", "from 'test:svelte'");
  const runWorkspaceChecks = vi.fn();
  const authState = writable({ user });
  const module = clientModule<{
    default: (
      anchor: null,
      props: { embedded: boolean; workspace?: workspace.WorkspaceContext },
    ) => {
      checkWorkspace: () => Promise<void>;
      restore: () => void;
      review: (value: ResearchReview) => void;
      edit: (value: workspace.WorkspaceContext) => void;
      read: () => {
        mode: string;
        report: workspace.EvidenceReport | null;
        runError: string;
        running: boolean;
        receivedAt: string;
        restored: boolean;
        inputsChanged: boolean;
        recovery: recovery.RecoveryResult;
        storageMessage: string;
      };
    };
  }>(
    url,
    {
      'test:svelte': {
        untrack: client.untrack,
        onMount: (fn: () => () => void) =>
          client.user_effect(() => client.untrack(fn)),
      },
      '$lib/features/auth/auth': { authState },
      '../../../components/dialogs/AuthDialog.svelte': {},
      '$lib/core/api': {
        apiFetch,
        readErrorMessage: async () => 'Unavailable',
      },
      '$lib/features/trial-report/sharing': { readTrialShareConfig },
      '$lib/features/trial-report/ReportActions.svelte': {},
      './EquityEvidence.svelte': {},
      './RunMetrics.svelte': {},
      './ReportContext.svelte': {},
      './evidence': evidence,
      '@lucide/svelte/icons/chart-candlestick': {},
      '@lucide/svelte/icons/activity': {},
      'bits-ui': {},
      './workspace': { ...workspace, runWorkspaceChecks },
      './ResearchReview.svelte': {},
      '../../../components/backtest/DataQualityEvidence.svelte': {},
      './recovery': { ...recovery, reviewInputFingerprint: fingerprint },
    },
    `${script}
    export function checkWorkspace() { return runWorkspace(); }
    export function restore() { restorePrevious(); }
    export function review(value) { updateReview(value); }
    export function edit(value) { workspace = value; }
    export function read() { return { mode, report, runError, running, receivedAt, restored, inputsChanged, recovery, storageMessage }; }
  </script>`,
  );
  let trial!: ReturnType<typeof module.default>;
  const stop = client.effect_root(() => {
    trial = module.default(null, { embedded: true, workspace: context });
  });
  return { trial, stop, runWorkspaceChecks, authState, storageAccess };
}

function mountEntry(
  apiFetch: ReturnType<typeof vi.fn>,
  user: { id: string } | null = null,
) {
  const guide = mountGuide();
  let trial: ReturnType<typeof mountTrial> | undefined;
  cleanups.push(
    client.effect_root(() => {
      client.user_effect(() => {
        const state = guide.read();
        if (!state.open || !state.exampleStarted) return;
        trial = client.untrack(() => mountTrial(apiFetch, user));
        return trial.stop;
      });
    }),
  );
  return { guide, trial: () => trial };
}

describe('guided example entry', () => {
  it('compiles the full Svelte 5 component and renders the unstarted guide without an executor', () => {
    expect(
      compile(guideSource, {
        filename: guideUrl.pathname,
        generate: 'client',
        runes: true,
      }).warnings,
    ).toEqual([]);
    expect(
      render(GuidedExampleDialog, { props: { open: false } }).body.replace(
        /<!--.*?-->/g,
        '',
      ),
    ).toBe('');
    const html = render(GuidedExampleDialog, { props: { open: true } }).body;
    expect(html).toContain('first ten minutes');
    expect(html).toContain('Educational synthetic scenarios');
    expect(html).toContain('Load and run synthetic example');
    expect(html).toContain('No example has been run');
    expect(html).toContain('Nothing is automatically saved');
    expect(html).toContain('Return to workbench');
    expect(html).not.toContain('Robustness checks');
  });

  it('uses the actual entry gate and supplies no workspace to the existing executor', () => {
    const ast = parse(guideSource, { modern: true });
    const nodes: { type: string; [key: string]: unknown }[] = [];
    function visit(value: unknown) {
      if (!value || typeof value !== 'object') return;
      if (Array.isArray(value)) {
        value.forEach(visit);
        return;
      }
      const node = value as { type: string; [key: string]: unknown };
      if (node.type) nodes.push(node);
      Object.values(node).forEach(visit);
    }
    visit(ast.fragment);
    const gate = nodes.find(node => node.type === 'IfBlock')!;
    const test = gate.test as { start: number; end: number };
    expect(guideSource.slice(test.start, test.end)).toBe(
      'open && exampleStarted',
    );
    const trial = nodes.find(
      node => node.type === 'Component' && node.name === 'StrategyTrial',
    )!;
    expect(
      (trial.attributes as { name: string }[]).map(attr => attr.name),
    ).toEqual(['embedded', 'onreturnworkspace']);
  });

  it('mounts the production guide lifecycle, bounds all four steps, and resets only its session on close', async () => {
    const guide = mountGuide();
    await settle();
    guide.start();
    expect(guide.read().exampleStarted).toBe(false);
    guide.setOpen(true);
    await settle();
    guide.start();
    for (let i = 0; i < 8; i++) guide.move(1);
    expect(guide.read()).toMatchObject({
      step: 3,
      exampleStarted: true,
      title: 'Write a cautious research conclusion',
    });
    expect(guide.read().instruction).toContain('not a buy/sell recommendation');
    guide.move(-1);
    expect(guide.read().instruction).toContain('chronological split');
    guide.move(-1);
    expect(guide.read().instruction).toContain('cost-adjusted');
    for (let i = 0; i < 8; i++) guide.move(-1);
    expect(guide.read().step).toBe(0);
    guide.close();
    await settle();
    guide.setOpen(true);
    await settle();
    expect(guide.read()).toMatchObject({
      open: true,
      step: 0,
      exampleStarted: false,
    });
  });

  it('requests explicit modal initial focus and returns focus only to a connected supplied trigger', () => {
    const focus = vi.fn();
    const connected = { isConnected: true, focus } as unknown as HTMLElement;
    const guide = mountGuide(connected);
    const headingFocus = vi.fn();
    guide.setHeading({ focus: headingFocus } as unknown as HTMLHeadingElement);
    const initial = new Event('open', { cancelable: true });
    guide.focus(initial);
    expect(initial.defaultPrevented).toBe(true);
    expect(headingFocus).toHaveBeenCalledOnce();
    guide.move(1);
    expect(headingFocus).toHaveBeenCalledTimes(2);
    const close = new Event('close', { cancelable: true });
    guide.restore(close);
    expect(close.defaultPrevented).toBe(true);
    expect(focus).toHaveBeenCalledOnce();
    const detached = { isConnected: false, focus } as unknown as HTMLElement;
    const disconnected = new Event('close', { cancelable: true });
    mountGuide(detached).restore(disconnected);
    expect(disconnected.defaultPrevented).toBe(false);
    expect(focus).toHaveBeenCalledOnce();
    const fallback = new Event('close', { cancelable: true });
    mountGuide().restore(fallback);
    expect(fallback.defaultPrevented).toBe(false);
  });

  it.each([null, { id: 'account-fixture' }])(
    'keeps signed-out/signed-in entry public and storage-independent (%j)',
    async user => {
      const storage = {
        getItem: vi.fn(() => {
          throw new Error('Unreadable storage');
        }),
        setItem: vi.fn(),
      };
      vi.stubGlobal('localStorage', storage);
      const apiFetch = vi.fn(async (path: string, _options?: RequestInit) =>
        jsonResponse(
          path === '/trial/catalog'
            ? { schema_version: 1, strategies: [strategy] }
            : {
                schema_version: 1,
                dataset: { synthetic: true },
                config: {
                  strategy_id: strategy.id,
                  commission_bps: 1,
                  slippage_bps: 5,
                },
                strategy,
              },
        ),
      );
      const entry = mountEntry(apiFetch, user);
      await settle();
      entry.guide.setOpen(true);
      await settle();
      expect(apiFetch).not.toHaveBeenCalled();
      entry.guide.start();
      await settle();
      expect(apiFetch.mock.calls.map(([path]) => path)).toEqual([
        '/trial/catalog',
        '/trial/run',
      ]);
      expect(JSON.parse(apiFetch.mock.calls[1][1]!.body as string)).toEqual({
        strategy_id: strategy.id,
        commission_bps: 1,
        slippage_bps: 5,
      });
      expect(entry.trial()?.trial.read()).toMatchObject({
        mode: 'examples',
        running: false,
        runError: '',
      });
      expect(entry.trial()?.runWorkspaceChecks).not.toHaveBeenCalled();
      expect(entry.trial()?.storageAccess).not.toHaveBeenCalled();
      entry.guide.close();
      await settle();
      entry.guide.setOpen(true);
      await settle();
      expect(apiFetch).toHaveBeenCalledTimes(2);
      entry.guide.start();
      await settle();
      expect(apiFetch.mock.calls.map(([path]) => path)).toEqual([
        '/trial/catalog',
        '/trial/run',
        '/trial/catalog',
        '/trial/run',
      ]);
      expect(storage.getItem).not.toHaveBeenCalled();
      expect(storage.setItem).not.toHaveBeenCalled();
    },
  );

  it('aborts a closing catalog and ignores its controlled obsolete completion without running', async () => {
    const response = deferred<Response>();
    const apiFetch = vi.fn(
      (_path: string, _options?: RequestInit) => response.promise,
    );
    const entry = mountEntry(apiFetch);
    entry.guide.setOpen(true);
    entry.guide.start();
    await settle();
    const signal = apiFetch.mock.calls[0][1]!.signal as AbortSignal;
    entry.guide.close();
    await settle();
    expect(signal.aborted).toBe(true);
    entry.guide.setOpen(true);
    await settle();
    response.resolve(
      jsonResponse({ schema_version: 1, strategies: [strategy] }),
    );
    await settle();
    expect(apiFetch).toHaveBeenCalledTimes(1);
    expect(entry.guide.read().exampleStarted).toBe(false);
  });

  it.each(['success', 'failure'])(
    'ignores an obsolete run %s after close/reopen',
    async completion => {
      const response = deferred<Response>();
      const apiFetch = vi.fn((path: string, _options?: RequestInit) =>
        path === '/trial/catalog'
          ? Promise.resolve(
              jsonResponse({ schema_version: 1, strategies: [strategy] }),
            )
          : response.promise,
      );
      const entry = mountEntry(apiFetch);
      entry.guide.setOpen(true);
      entry.guide.start();
      await settle();
      const old = entry.trial()!;
      const signal = apiFetch.mock.calls[1][1]!.signal as AbortSignal;
      entry.guide.close();
      await settle();
      expect(signal.aborted).toBe(true);
      entry.guide.setOpen(true);
      await settle();
      if (completion === 'failure')
        response.reject(new Error('Obsolete failure'));
      else
        response.resolve(
          jsonResponse({
            schema_version: 1,
            dataset: { synthetic: true },
            config: {
              strategy_id: strategy.id,
              commission_bps: 1,
              slippage_bps: 5,
            },
            strategy,
          }),
        );
      await settle();
      expect(old.trial.read()).toMatchObject({
        report: null,
        runError: '',
        running: false,
      });
      expect(apiFetch).toHaveBeenCalledTimes(2);
      expect(entry.guide.read().exampleStarted).toBe(false);
    },
  );
});

const draft: workspace.WorkspaceContext = {
  code: 'def on_bar(ctx):\n    pass',
  name: 'Draft',
  symbol: 'TEST',
  provider: 'yfinance',
  period: '1y',
  interval: '1d',
};
const inputHash = 'd'.repeat(64);
function oldWorkspaceReport(): workspace.WorkspaceReport {
  const run = {
    total_return: -0.1,
    max_drawdown: -0.2,
    trade_count: 1,
    total_cost: 7,
    equity: [{ t: 1735689600, value: 100000 }],
  };
  return {
    schema_version: 1,
    source: 'workspace',
    report_id: 'a'.repeat(64),
    code_hash: 'b'.repeat(64),
    engine_version: 'engine-1',
    strategy: {
      id: 'workspace',
      name: 'Draft',
      description: 'Current strategy',
      lesson: 'Research only',
    },
    dataset: {
      id: 'yfinance:TEST',
      version: 'c'.repeat(64),
      label: 'TEST · yfinance',
      synthetic: false,
      start: '2025-01-01',
      end: '2025-04-01',
      split_date: '2025-03-01',
      training_bars: 70,
      holdout_bars: 30,
    },
    config: {
      strategy_id: 'workspace',
      seed: 0,
      commission_bps: 1,
      slippage_bps: 5,
      starting_cash: 100000,
      holdout_fraction: 0.3,
      params: {},
      sensitivity_parameter: null,
    },
    baseline: run,
    realistic: run,
    benchmark: run,
    holdout: { strategy: run, benchmark: run },
    sensitivity: [],
    selected_parameter: null,
    findings: [],
    assumptions: [],
    limitations: [],
  };
}

function mountWorkspace(
  storage: recovery.ReviewStorage,
  fingerprint: typeof recovery.reviewInputFingerprint = async () => inputHash,
) {
  const instance = mountTrial(
    vi.fn(async () =>
      jsonResponse({ schema_version: 1, strategies: [strategy] }),
    ),
    { id: 'a' },
    draft,
    storage,
    fingerprint,
  );
  cleanups.push(instance.stop);
  return instance;
}

describe('integrated workspace report lifecycle', () => {
  it.each(['success', 'failure'])(
    'fences actual obsolete workspace %s through same-turn A→B→A',
    async completion => {
      const storage = { getItem: vi.fn(() => null), setItem: vi.fn() };
      const { trial, runWorkspaceChecks, authState } = mountWorkspace(storage);
      await settle();
      const response = deferred<workspace.WorkspaceReport>();
      runWorkspaceChecks.mockReturnValueOnce(response.promise);
      const pending = trial.checkWorkspace();
      const signal = runWorkspaceChecks.mock.calls[0][2] as AbortSignal;
      expect(trial.read().running).toBe(true);
      authState.set({ user: { id: 'b' } });
      authState.set({ user: { id: 'a' } });
      expect(signal.aborted).toBe(true);
      if (completion === 'success') response.resolve(oldWorkspaceReport());
      else response.reject(new Error('Obsolete account failure'));
      await pending;
      await settle();
      expect(trial.read()).toMatchObject({
        report: null,
        running: false,
        runError: '',
      });
      expect(storage.setItem).not.toHaveBeenCalled();
      runWorkspaceChecks.mockResolvedValueOnce(oldWorkspaceReport());
      await trial.checkWorkspace();
      expect(trial.read().report?.report_id).toBe('a'.repeat(64));
      expect(storage.setItem).toHaveBeenCalledOnce();
    },
  );

  it('fences a delayed input hash and never overwrites the new account report', async () => {
    const storage = { getItem: vi.fn(() => null), setItem: vi.fn() };
    const fingerprint = vi.fn(async () => inputHash);
    const { trial, runWorkspaceChecks, authState } = mountWorkspace(
      storage,
      fingerprint,
    );
    await settle();
    const hash = deferred<string>();
    fingerprint.mockReturnValueOnce(hash.promise);
    runWorkspaceChecks.mockResolvedValue(oldWorkspaceReport());
    const obsolete = trial.checkWorkspace();
    await settle();
    authState.set({ user: { id: 'b' } });
    await trial.checkWorkspace();
    const current = trial.read().report;
    hash.resolve(inputHash);
    await obsolete;
    expect(trial.read().report).toBe(current);
    expect(storage.setItem).toHaveBeenCalledOnce();
    expect(storage.setItem.mock.calls[0][0]).toBe(
      recovery.latestReviewKey('b'),
    );
  });

  it.each(['unreadable', 'blocked', 'quota'])(
    'keeps a completed report in memory and preserves %s recovery storage',
    async failure => {
      const bytes = '{unreadable';
      const storage = {
        getItem: vi.fn(() => {
          if (failure === 'blocked') throw new Error('Blocked');
          return failure === 'unreadable' ? bytes : null;
        }),
        setItem: vi.fn(() => {
          throw new Error('Quota');
        }),
      };
      const { trial, runWorkspaceChecks } = mountWorkspace(storage);
      await settle();
      runWorkspaceChecks.mockResolvedValue(oldWorkspaceReport());
      await trial.checkWorkspace();
      expect(trial.read().report?.report_id).toBe('a'.repeat(64));
      expect(trial.read().storageMessage).toMatch(/preserved/i);
      expect(trial.read().storageMessage).not.toMatch(/saved in this account/);
      expect(storage.setItem).toHaveBeenCalledTimes(
        failure === 'quota' ? 1 : 0,
      );
      if (failure === 'unreadable') expect(storage.getItem()).toBe(bytes);
    },
  );

  it('explicitly restores an old report, retains receipt time, and marks edited inputs stale without executing', async () => {
    const saved: recovery.SavedReview = {
      version: 1,
      account: 'a',
      received_at: '2026-01-01T00:00:00Z',
      input_fingerprint: inputHash,
      context: {
        name: draft.name,
        symbol: draft.symbol,
        provider: draft.provider,
        period: draft.period,
        interval: draft.interval,
      },
      report: {
        ...oldWorkspaceReport(),
        research_review: { decision: 'revise', reason: 'Review costs' },
      },
    };
    const storage = {
      getItem: vi.fn((key: string) =>
        key === recovery.latestReviewKey('a') ? JSON.stringify(saved) : null,
      ),
      setItem: vi.fn(),
    };
    const fingerprint = async (context: workspace.WorkspaceContext) =>
      context.code === draft.code ? inputHash : 'e'.repeat(64);
    const { trial, runWorkspaceChecks, authState } = mountWorkspace(
      storage,
      fingerprint,
    );
    await settle();
    expect(trial.read().report).toBeNull();
    trial.restore();
    expect(trial.read()).toMatchObject({
      receivedAt: saved.received_at,
      restored: true,
      inputsChanged: false,
      report: {
        research_review: { decision: 'revise', reason: 'Review costs' },
      },
    });
    trial.edit({ ...draft, code: `${draft.code}\n# changed` });
    await settle();
    expect(trial.read().inputsChanged).toBe(true);
    expect(runWorkspaceChecks).not.toHaveBeenCalled();
    authState.set({ user: { id: 'b' } });
    expect(trial.read().report).toBeNull();
    trial.restore();
    trial.review({ decision: 'continue-research', reason: 'No obsolete save' });
    expect(storage.setItem).not.toHaveBeenCalled();
    expect(trial.read().recovery).toEqual({ status: 'ready', saved: null });
  });
});
