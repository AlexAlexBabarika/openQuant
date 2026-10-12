import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { parse } from 'svelte/compiler';
import { render } from 'svelte/server';
import { writable } from 'svelte/store';
import { client, clientModule } from '$lib/features/chart/reactiveTestSupport';
import TopHeader from './TopHeader.svelte';

const url = new URL('./TopHeader.svelte', import.meta.url);
const source = readFileSync(url, 'utf8');
const cleanups: (() => void)[] = [];
afterEach(() => cleanups.splice(0).forEach(cleanup => cleanup()));

function mountHeader(props: Record<string, unknown> = {}) {
  const module = clientModule<{
    default: (anchor: null, props: unknown) => { guide: () => void };
  }>(
    url,
    {
      'test:svelte': { tick: async () => {} },
      '../dialogs/AuthDialog.svelte': {},
      '../dialogs/ApiKeysModal.svelte': {},
      '$lib/components/ui/select': {},
      '$lib/features/auth/auth': {
        authState: writable({ user: null }),
        logout: vi.fn(),
      },
      '$lib/features/market/marketDataProviders': {
        MARKET_DATA_PROVIDERS: [],
        providerSupportsWs: () => false,
      },
      '$lib/features/market/marketIntervals': { DEFAULT_MARKET_INTERVAL: '1d' },
      './IntervalPicker.svelte': {},
      '$lib/features/market/marketPeriods': { DEFAULT_MARKET_PERIOD: '1y' },
      './PeriodPicker.svelte': {},
      '@lucide/svelte/icons/loader-circle': {},
      '@lucide/svelte/icons/chart-candlestick': {},
      'bits-ui': {},
      '@lucide/svelte/icons/user-round': {},
    },
    `${source.split('</script>')[0].replace("from 'svelte'", "from 'test:svelte'")}
    export function guide() { onguidedexample(); }
  </script>`,
  );
  let header!: ReturnType<typeof module.default>;
  cleanups.push(
    client.effect_root(() => {
      header = module.default(null, props);
    }),
  );
  return header;
}

describe('guided example header entry', () => {
  it('renders a keyboard-native dialog entry without removing existing research controls', () => {
    const html = render(TopHeader, {
      props: {
        symbol: 'MSFT',
        period: '1y',
        interval: '1d',
        source: 'yfinance',
        autoRefresh: false,
        connectionStatus: 'disconnected',
        isLoading: false,
        onload: vi.fn(),
        onstream: vi.fn(),
        oncsvupload: vi.fn(),
      },
    }).body;
    expect(html).toMatch(
      /<button type="button"[^>]*aria-haspopup="dialog"[^>]*>Guided example<\/button>/,
    );
    for (const text of [
      'Chart',
      'Strategy',
      'Robustness',
      'Workspaces',
      'Inspect data',
    ])
      expect(html).toContain(text);
    const ast = parse(html, { modern: true });
    expect(ast.fragment.nodes.length).toBeGreaterThan(0);
    expect(source).toContain('onclick={onguidedexample}');
  });

  it('defaults the added callback safely when omitted or undefined', () => {
    expect(() => mountHeader().guide()).not.toThrow();
    expect(() =>
      mountHeader({ onguidedexample: undefined }).guide(),
    ).not.toThrow();
  });

  it('invokes only the supplied guide action without loading or changing research views', () => {
    const onguidedexample = vi.fn();
    const onload = vi.fn();
    const onchart = vi.fn();
    const onstrategy = vi.fn();
    const onrobustness = vi.fn();
    const onworkspaces = vi.fn();
    mountHeader({
      onguidedexample,
      onload,
      onchart,
      onstrategy,
      onrobustness,
      onworkspaces,
    }).guide();
    expect(onguidedexample).toHaveBeenCalledOnce();
    for (const callback of [
      onload,
      onchart,
      onstrategy,
      onrobustness,
      onworkspaces,
    ])
      expect(callback).not.toHaveBeenCalled();
  });
});
