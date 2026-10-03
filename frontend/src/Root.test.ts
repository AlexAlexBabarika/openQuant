import { afterEach, describe, expect, it, vi } from 'vitest';
import { render } from 'svelte/server';
import Root from './Root.svelte';

vi.mock('$lib/features/theme/theme', () => ({
  applyTheme: vi.fn(),
  loadTheme: () => 'dark',
}));
vi.mock('./App.svelte', () => ({ default: vi.fn() }));

function page(search: string, standalone = false): string {
  vi.stubGlobal('window', { location: { search } });
  vi.stubGlobal('document', {
    querySelector: () =>
      standalone ? { getAttribute: () => 'trial-only' } : null,
  });
  return render(Root).body;
}

afterEach(() => vi.unstubAllGlobals());

describe('OpenQuant entry surface', () => {
  it.each(['', '?trial=1', '?workspace=1'])(
    'mounts the workspace in full-app mode (%s)',
    search => {
      const html = page(search);
      expect(html).toContain('Opening the research workspace');
      expect(html).not.toContain('Standalone examples server');
      expect(html).not.toContain('Robustness configuration');
    },
  );

  it.each(['', '?workspace=1'])(
    'explains standalone mode without presenting a landing page (%s)',
    search => {
      const html = page(search, true);
      expect(html).toContain('Standalone examples server');
      expect(html).toContain('Changing the URL cannot enable the workspace');
      expect(html).toContain('Robustness checks');
      expect(html).toContain('Example strategy');
      expect(html).toContain('Commission (bps)');
      expect(html).toContain('Run checks');
      expect(html).toContain(
        'These checks do not use your chart data or custom strategy',
      );
      expect(html).not.toContain('Cross-examine');
      expect(html).not.toContain('Strategy on Trial');
      expect(html).not.toContain('Your backtest looks brilliant');
    },
  );
});
