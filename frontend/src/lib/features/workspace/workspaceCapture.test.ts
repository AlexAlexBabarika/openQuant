import { describe, expect, it, vi } from 'vitest';
import {
  client,
  clientModule,
  componentDeclarations,
} from '../chart/reactiveTestSupport';
import type { ResearchLayout } from './researchShelf.svelte';
import { trialSearch } from '../../../entry';

const app = new URL('../../../App.svelte', import.meta.url);

describe('workspace capture through research commands', () => {
  it.each(['strategy', 'indicator', 'neither'] as const)(
    'retains the pre-dialog %s layout while closing panels for a usable workspace dialog',
    async panel => {
      const saveWorkspace = vi.fn(
        (_name: string, _layout: ResearchLayout) => true,
      );
      const module = clientModule<{
        default: (
          anchor: unknown,
          props: unknown,
        ) => {
          open: (panel: string) => void;
          command: () => void;
          close: () => void;
          save: (name: string) => boolean;
          getPanels: () => {
            strategyOpen: boolean;
            indicatorsOpen: boolean;
            researchWorkspacesOpen: boolean;
          };
        };
      }>(
        app,
        {
          'test:shelf': { saveWorkspace },
          'test:tick': { tick: () => Promise.resolve() },
          'test:entry': { trialSearch },
        },
        `<script lang="ts">
        import { saveWorkspace } from 'test:shelf';
        import { tick } from 'test:tick';
        import { trialSearch } from 'test:entry';
        const window = { location: { href: 'http://localhost/' }, history: { pushState: () => {} } };
        const researchShelf = { saveWorkspace };
        const chart = { symbol: 'SPY', source: 'yfinance', interval: '1d', period: '1y' };
        const strategy = { draftName: 'Strategy draft', draftCode: 'strategy code', scripts: [] };
        const indicators = { draftName: 'Indicator draft', draftCode: 'indicator code', scripts: [] };
        const smaConfig = { enabled: true, period: 13, lineWidth: 2 };
        const emaConfig = { enabled: false, period: 19, lineWidth: 2 };
        const bbandsConfig = { enabled: true, period: 17, stdDev: 3, lineWidth: 1 };
        const chartType = 'line', showArea = true, showVolume = false, desktopSidebarVisible = false;
        const groups = [], listTools = () => [], CURSOR = 'cursor';
        const runsHistory = { entries: [] };
        const authState = { subscribe: fn => { fn({ user: null }); return () => {}; } };
        const selectChartSymbol = () => {}, openStoredRun = () => {};
        const backtest = { load: () => {} };
        let trialOpen = false, watchlistOpen = false, activeTool = CURSOR;
        ${componentDeclarations(app, [
          'strategyOpen',
          'setTrialOpen',
          'openStrategy',
          'indicatorsOpen',
          'analyticsOpen',
          'backtestOpen',
          'runsOpen',
          'compareOpen',
          'researchWorkspacesOpen',
          'dataInspectorOpen',
          'portfolioRunId',
          'strategyEditorShare',
          'indicatorSplitPct',
          'strategyTab',
          'indicatorTab',
          'workspaceLayout',
          'currentResearchLayout',
          'closeResearchPanels',
          'activateCommand',
          'openResearchWorkspaces',
          'saveResearchWorkspace',
          'researchCommands',
        ])}
        export function open(panel) {
          strategyOpen = panel === 'strategy'; indicatorsOpen = panel === 'indicator';
          strategyTab = 'docs'; indicatorTab = 'docs'; strategyEditorShare = 60; indicatorSplitPct = 56;
        }
        export function command() { researchCommands.find(c => c.id === 'workspaces').action(); }
        export function close() { researchWorkspacesOpen = false; }
        export function save(name) { return saveResearchWorkspace(name); }
        export function getPanels() { return { strategyOpen, indicatorsOpen, researchWorkspacesOpen }; }
      </script>`,
      );
      let harness!: ReturnType<typeof module.default>;
      const stop = client.effect_root(() => {
        harness = module.default(null, {});
      });
      try {
        harness.open(panel);
        harness.command();
        expect(harness.getPanels()).toEqual({
          strategyOpen: false,
          indicatorsOpen: false,
          researchWorkspacesOpen: false,
        });
        await Promise.resolve();
        client.flush();
        expect(harness.getPanels().researchWorkspacesOpen).toBe(true);
        expect(harness.save('Original')).toBe(true);
        const layout = saveWorkspace.mock.calls[0][1] as ResearchLayout;
        expect(layout).toMatchObject({
          strategyOpen: panel === 'strategy',
          indicatorsOpen: panel === 'indicator',
          strategyTab: 'docs',
          indicatorTab: 'docs',
          strategyEditorShare: 60,
          indicatorSplitPct: 56,
        });
        expect(layout.strategy.code).toBe('strategy code');
        harness.command();
        await Promise.resolve();
        client.flush();
        harness.save('Still original');
        expect(saveWorkspace.mock.calls[1][1]).toEqual(layout);
        harness.close();
        harness.open('neither');
        harness.command();
        await Promise.resolve();
        client.flush();
        harness.save('Next');
        expect(saveWorkspace.mock.calls[2][1]).toMatchObject({
          strategyOpen: false,
          indicatorsOpen: false,
        });
        expect(layout.strategyOpen).toBe(panel === 'strategy');
      } finally {
        stop();
      }
    },
  );
});
