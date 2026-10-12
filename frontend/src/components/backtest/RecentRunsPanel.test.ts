import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render } from 'svelte/server';
import {
  client,
  clientModule,
  deferred,
} from '$lib/features/chart/reactiveTestSupport';
import * as metadata from '$lib/features/runs/notebookMetadata';
import { truncateRunId } from '$lib/features/runs/format';
import {
  runsHistory,
  type RunsHistory,
  type RunHistoryEntry,
} from '$lib/features/runs/runsHistory.svelte';
import RecentRunsPanel from './RecentRunsPanel.svelte';

const cleanups: (() => void)[] = [];
afterEach(() => {
  cleanups.splice(0).forEach(cleanup => cleanup());
  runsHistory.entries = [];
  runsHistory.storageError = null;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const entry = (run_id: string): RunHistoryEntry => ({
  run_id,
  kind: 'single',
  label: `Experiment ${run_id}`,
  created_at: '2026-01-01T00:00:00Z',
  notes: 'Private hypothesis',
  decision: 'revise',
});

function storage(): Storage {
  const data = new Map<string, string>();
  return {
    getItem: key => data.get(key) ?? null,
    setItem: (key, value) => void data.set(key, value),
  } as Storage;
}

const historyModule = clientModule<{ RunsHistory: typeof RunsHistory }>(
  new URL('../../lib/features/runs/runsHistory.svelte.ts', import.meta.url),
  { './notebookMetadata': metadata },
);

function setup(store = storage()) {
  const history = new historyModule.RunsHistory(store);
  const url = new URL('./RecentRunsPanel.svelte', import.meta.url);
  const script = readFileSync(url, 'utf8').split('</script>')[0];
  const module = clientModule<{
    default: (
      anchor: null,
      props: { open: boolean; onOpenRun: () => void; onCompare: () => void },
    ) => {
      choose: (file: Pick<File, 'size' | 'text'>) => void;
      importNow: () => Promise<void>;
      exportNow: () => void;
      setOpen: (value: boolean) => void;
      save: (data: FormData, id: string) => void;
      read: () => {
        importing: boolean;
        message: string | null;
        error: boolean;
        hasFile: boolean;
      };
    };
  }>(
    url,
    {
      '$lib/components/ui/dialog': {},
      '$lib/features/runs/runsHistory.svelte': { runsHistory: history },
      '$lib/features/runs/format': { truncateRunId },
      '$lib/features/runs/notebookMetadata': metadata,
    },
    `${script}
    export function choose(file: File) { chooseImport({ currentTarget: { files: [file] } } as unknown as Event); }
    export function importNow() { return importMetadata(); }
    export function exportNow() { exportMetadata(); }
    export function setOpen(value: boolean) { open = value; }
    export function save(data: FormData, id: string) { saveEntry({ currentTarget: data, preventDefault() {} } as unknown as SubmitEvent, id); }
    export function read() { return { importing, message: transferMessage, error: transferError, hasFile: importFile !== null }; }
  </script>`,
  );
  let panel!: ReturnType<typeof module.default>;
  const stop = client.effect_root(() => {
    panel = module.default(null, {
      open: true,
      onOpenRun: vi.fn(),
      onCompare: vi.fn(),
    });
  });
  cleanups.push(stop);
  client.flush();
  return { panel, history, stop, store };
}

const file = (json: string) => ({
  size: new TextEncoder().encode(json).length,
  text: vi.fn(async () => json),
});

describe('notebook transfer client lifecycle', () => {
  it('waits for explicit submission, prevents duplicate reads, and reports only persisted imports', async () => {
    const { panel, history, store } = setup();
    const read = deferred<string>();
    const text = vi.fn(() => read.promise);
    panel.choose({ size: 20, text });
    expect(text).not.toHaveBeenCalled();
    const pending = panel.importNow();
    expect(panel.read().importing).toBe(true);
    await panel.importNow();
    expect(text).toHaveBeenCalledTimes(1);
    read.resolve(metadata.serializeNotebookMetadata([entry('imported')]));
    await pending;
    expect(history.entries[0]).toMatchObject({
      run_id: 'imported',
      decision: 'revise',
    });
    expect(store.getItem('openquant.runs.history')).toContain(
      'Private hypothesis',
    );
    expect(panel.read()).toMatchObject({
      importing: false,
      error: false,
      message: expect.stringContaining('Saved 1'),
    });
  });

  it.each(['resolve', 'reject'] as const)(
    'discards an obsolete %s after an owner switch',
    async completion => {
      const { panel, history } = setup();
      history.setAccount('a');
      client.flush();
      const read = deferred<string>();
      panel.choose({ size: 20, text: () => read.promise });
      const pending = panel.importNow();
      history.setAccount('b');
      client.flush();
      if (completion === 'resolve')
        read.resolve(metadata.serializeNotebookMetadata([entry('a-private')]));
      else read.reject(new Error('A-private read error'));
      await pending;
      expect(history.entries).toEqual([]);
      expect(panel.read()).toEqual({
        importing: false,
        message: null,
        error: false,
        hasFile: false,
      });
      history.setAccount('a');
      expect(history.entries).toEqual([]);
    },
  );

  it('rejects a completion even if the owner switches away and back before effects flush', async () => {
    const { panel, history } = setup();
    const read = deferred<string>();
    panel.choose({ size: 20, text: () => read.promise });
    const pending = panel.importNow();
    history.setAccount('another');
    history.setAccount(null);
    read.resolve(metadata.serializeNotebookMetadata([entry('obsolete')]));
    await pending;
    client.flush();
    expect(history.entries).toEqual([]);
    expect(panel.read().message).toBeNull();
  });

  it.each(['close', 'destroy'] as const)(
    'discards obsolete reads on %s',
    async action => {
      const { panel, history, stop } = setup();
      const read = deferred<string>();
      panel.choose({ size: 20, text: () => read.promise });
      const pending = panel.importNow();
      if (action === 'close') panel.setOpen(false);
      if (action === 'destroy') stop();
      client.flush();
      read.resolve(metadata.serializeNotebookMetadata([entry('obsolete')]));
      await pending;
      expect(history.entries).toEqual([]);
      expect(panel.read().message).toBeNull();
    },
  );

  it('does not let an obsolete completion replace a newer import or its feedback', async () => {
    const { panel, history } = setup();
    const read = deferred<string>();
    panel.choose({ size: 20, text: () => read.promise });
    const obsolete = panel.importNow();
    panel.choose(
      file(metadata.serializeNotebookMetadata([entry('replacement')])),
    );
    await panel.importNow();
    const message = panel.read().message;
    read.resolve(metadata.serializeNotebookMetadata([entry('obsolete')]));
    await obsolete;
    expect(history.entries.map(e => e.run_id)).toEqual(['replacement']);
    expect(panel.read()).toMatchObject({
      importing: false,
      error: false,
      message,
    });
  });

  it('does not read oversized files and keeps a malformed file available for correction/retry', async () => {
    const { panel, history } = setup();
    const text = vi.fn(async () => '{}');
    panel.choose({ size: metadata.MAX_NOTEBOOK_BYTES + 1, text });
    await panel.importNow();
    expect(text).not.toHaveBeenCalled();
    expect(panel.read()).toMatchObject({
      error: true,
      importing: false,
      message: expect.stringContaining('6 MiB'),
    });
    panel.choose(file('{broken'));
    await panel.importNow();
    expect(panel.read()).toMatchObject({
      error: true,
      importing: false,
      hasFile: true,
      message: expect.stringContaining('JSON'),
    });
    expect(history.entries).toEqual([]);
  });

  it('shows current read failures, quota failures and successful retry without a false saved state', async () => {
    const { panel, history, store } = setup();
    history.record(entry('keep'));
    panel.choose({
      size: 20,
      text: async () => {
        throw new Error('Read failed');
      },
    });
    await panel.importNow();
    expect(panel.read()).toMatchObject({
      error: true,
      importing: false,
      message: 'Read failed',
    });
    panel.choose(file(metadata.serializeNotebookMetadata([entry('new')])));
    const persist = vi.spyOn(store, 'setItem').mockImplementationOnce(() => {
      throw new Error('Quota exceeded');
    });
    await panel.importNow();
    expect(panel.read()).toMatchObject({
      error: true,
      importing: false,
      hasFile: true,
      message: expect.stringContaining('not saved'),
    });
    expect(history.entries.map(e => e.run_id)).toEqual(['keep']);
    persist.mockRestore();
    await panel.importNow();
    expect(panel.read()).toMatchObject({
      error: false,
      message: expect.stringContaining('Saved 1'),
    });
    expect(history.storageError).toBeNull();
    await panel.importNow();
    expect(panel.read().message).toContain('No new references');
  });

  it('shows unreadable-storage failures without mutating or claiming a saved import', async () => {
    const store = storage();
    store.setItem('openquant.runs.history', '{broken');
    const { panel, history } = setup(store);
    panel.choose(file(metadata.serializeNotebookMetadata([entry('new')])));
    await panel.importNow();
    expect(panel.read()).toMatchObject({
      error: true,
      message: expect.stringContaining('not overwritten'),
    });
    expect(history.entries).toEqual([]);
    panel.exportNow();
    expect(panel.read()).toMatchObject({
      error: true,
      message: expect.stringContaining('unreadable'),
    });
    expect(store.getItem('openquant.runs.history')).toBe('{broken');
  });

  it('exports current-owner metadata on click and reports only that a download was requested', async () => {
    const { panel, history } = setup();
    history.record(entry('guest'));
    history.setAccount('a');
    history.record(entry('account'));
    client.flush();
    const anchor = { href: '', download: '', click: vi.fn() };
    vi.stubGlobal('document', { createElement: vi.fn(() => anchor) });
    const createUrl = vi
      .spyOn(URL, 'createObjectURL')
      .mockReturnValue('blob:metadata');
    const revoke = vi
      .spyOn(URL, 'revokeObjectURL')
      .mockImplementation(() => {});
    panel.exportNow();
    const json = await (createUrl.mock.calls[0][0] as Blob).text();
    expect(json).toContain('account');
    expect(json).not.toContain('guest');
    expect(anchor.click).toHaveBeenCalledOnce();
    expect(anchor.download).toBe('openquant-notebook-metadata-v1.json');
    expect(panel.read()).toMatchObject({
      error: false,
      message: expect.stringContaining('download requested'),
    });
    await vi.waitFor(() =>
      expect(revoke).toHaveBeenCalledWith('blob:metadata'),
    );
  });

  it('makes export failures visible instead of reporting download success', () => {
    const { panel, history } = setup();
    history.record(entry('account'));
    vi.spyOn(URL, 'createObjectURL').mockImplementation(() => {
      throw new Error('Download unavailable');
    });
    panel.exportNow();
    expect(panel.read()).toMatchObject({
      error: true,
      message: 'Download unavailable',
    });
  });

  it('saves the form decision with notes and preserves both after re-recording', () => {
    const { panel, history } = setup();
    history.record(entry('run'));
    const data = new FormData();
    data.set('name', 'Revised hypothesis');
    data.set('tags', 'fees');
    data.set('notes', 'Reject after higher costs');
    data.set('decision', 'reject');
    const NativeFormData = FormData;
    vi.stubGlobal('FormData', function (value: FormData) {
      return value;
    });
    panel.save(data, 'run');
    history.record(entry('run'));
    expect(history.entries[0]).toMatchObject({
      label: 'Revised hypothesis',
      notes: 'Reject after higher costs',
      decision: 'reject',
    });
    vi.stubGlobal('FormData', NativeFormData);
  });
});

describe('notebook SSR form semantics', () => {
  it('renders labelled native controls, bounds, non-certification wording and honest storage boundaries', () => {
    runsHistory.entries = [entry('test')];
    const html = render(RecentRunsPanel, {
      props: { open: true, onOpenRun: vi.fn(), onCompare: vi.fn() },
    }).body;
    expect(html).toContain('Experiment notebook');
    expect(html).toMatch(
      /<label[^>]*>Notebook metadata JSON file<input[^>]*type="file"/,
    );
    expect(html).toContain(
      'aria-describedby="notebook-transfer-help notebook-import-policy"',
    );
    expect(html).toContain('Import missing references');
    expect(html).toMatch(
      /<label[^>]*>Human research decision<select[^>]*name="decision"/,
    );
    expect(html).toContain('aria-describedby="decision-help-test"');
    for (const label of Object.values(metadata.RESEARCH_DECISIONS))
      expect(html).toContain(label);
    expect(html).toContain('not certification');
    expect(html).toContain('not account-scoped');
    expect(html).toContain('6 MiB');
    expect(html).toContain('Unencrypted');
    expect(html).toContain('no cloud sync');
  });

  it('renders unreadable-storage feedback and an empty notebook safely without window or localStorage', () => {
    runsHistory.entries = [];
    runsHistory.storageError =
      'Existing browser data has not been overwritten.';
    const html = render(RecentRunsPanel, {
      props: { open: true, onOpenRun: vi.fn(), onCompare: vi.fn() },
    }).body;
    expect(html).toContain('No recorded runs yet');
    expect(html).toContain('role="status"');
    expect(html).toContain('not been overwritten');
  });
});
