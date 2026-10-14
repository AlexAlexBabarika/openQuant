import { describe, expect, it, vi } from 'vitest';
import { createOptionsDraft } from './optionsTemplates';
import {
  decodeLegacyOptions,
  decodeOptionsStorage,
  encodeOptionsStorage,
  exportOptionsBundle,
  importOptionsBundle,
  optionsScope,
  downloadOptionsFile,
  type OptionsSavedDraft,
  type OptionsLibraryData,
} from './optionsPersistence';

const saved = (): OptionsSavedDraft => ({
  name: 'Saved',
  updatedAt: '2026-01-01T00:00:00Z',
  draft: createOptionsDraft(),
  mode: 'python',
  source: '# custom source\nresult = analyze_options(request)',
});
const library = (): OptionsLibraryData => ({
  version: 2,
  drafts: [saved()],
  recovery: null,
});

describe('bounded portable and scoped options storage', () => {
  it('roundtrips named snapshots/source and incomplete working fields without responses', () => {
    const data = library();
    const draft = createOptionsDraft();
    draft.spot = NaN;
    draft.rate = Infinity;
    draft.dividend_yield = -Infinity;
    draft.strategy.legs[0].strike = null;
    data.recovery = {
      draft,
      mode: 'python',
      source: '',
      updatedAt: '2026-01-01T00:00:00Z',
    };
    const raw = encodeOptionsStorage(data);
    expect(raw).not.toContain('today_pnl');
    const restored = decodeOptionsStorage(raw);
    expect(restored.recovery!.draft).toEqual(draft);
    expect(restored.drafts).toEqual(data.drafts);
    expect(importOptionsBundle(exportOptionsBundle(data.drafts))).toEqual(
      data.drafts,
    );
    expect(exportOptionsBundle(data.drafts)).not.toContain('recovery');
  });
  it('reads valid legacy v1 unchanged and rejects unsupported/oversize legacy data', () => {
    const data = [saved()];
    expect(
      decodeLegacyOptions(JSON.stringify({ version: 1, drafts: data })),
    ).toEqual(data);
    expect(() => decodeLegacyOptions('x'.repeat(300001))).toThrow(/bounds/);
    expect(() => decodeLegacyOptions('{"version":2,"drafts":[]}')).toThrow(
      /unchanged/,
    );
  });
  it.each([
    'not JSON',
    '{"version":3,"drafts":[],"recovery":null}',
    '{"version":2,"drafts":[],"recovery":null,"result":{}}',
    '{"version":2,"drafts":[],"recovery":{}}',
    'x'.repeat(1000001),
  ])('rejects corrupt storage without guessing at records', raw => {
    expect(() => decodeOptionsStorage(raw)).toThrow();
  });
  it('rejects invalid nested imports, oversized lists, revisions and nonfinite named inputs', () => {
    const d = saved();
    const bundle = (drafts: unknown[]) =>
      JSON.stringify({
        format: 'openquant-options-drafts',
        version: 2,
        drafts,
      });
    expect(() =>
      importOptionsBundle(bundle(Array.from({ length: 11 }, saved))),
    ).toThrow();
    expect(() => importOptionsBundle(bundle([]))).toThrow();
    d.draft.spot = NaN;
    expect(() => importOptionsBundle(bundle([d]))).toThrow();
    expect(() => exportOptionsBundle([d])).toThrow();
    const invalidRevision = {
      ...saved(),
      revision: 2,
      revisions: [{ ...saved(), revision: 2 }],
    };
    expect(() => importOptionsBundle(bundle([invalidRevision]))).toThrow();
    const extra = saved();
    Object.assign(extra.draft.strategy.legs[0], { expiry_date: '2026-01-01' });
    expect(() => importOptionsBundle(bundle([extra]))).toThrow();
    const source = { ...saved(), source: 'x'.repeat(20001) };
    expect(() => importOptionsBundle(bundle([source]))).toThrow();
  });
  it('bounds total storage and distinguishes guest/encoded account namespaces', () => {
    const d = saved();
    d.source = 'x'.repeat(20000);
    d.revision = 4;
    d.revisions = [3, 2, 1].map(revision => ({
      ...saved(),
      revision,
      source: d.source,
    }));
    const data = {
      version: 2 as const,
      drafts: Array.from({ length: 10 }, () => d),
      recovery: null,
    };
    expect(encodeOptionsStorage(data).length).toBeLessThan(1000000);
    expect(() => decodeOptionsStorage('x'.repeat(1000001))).toThrow(/exceeds/);
    expect(optionsScope(null)).toBe('guest');
    expect(optionsScope('guest')).toBe('account:guest');
    expect(optionsScope('a:b')).toBe('account:a%3Ab');
  });
  it('downloads only when explicitly called and releases the blob URL', () => {
    vi.useFakeTimers();
    const click = vi.fn();
    const create = vi.fn().mockReturnValue('blob:options');
    const revoke = vi.fn();
    const link = { click, href: '', download: '' };
    vi.stubGlobal('document', { createElement: vi.fn().mockReturnValue(link) });
    const createSpy = vi
      .spyOn(URL, 'createObjectURL')
      .mockImplementation(create);
    const revokeSpy = vi
      .spyOn(URL, 'revokeObjectURL')
      .mockImplementation(revoke);
    try {
      expect(click).not.toHaveBeenCalled();
      downloadOptionsFile(
        'private',
        'options-account-source.py',
        'text/x-python',
      );
      expect(click).toHaveBeenCalledOnce();
      expect(link.download).toContain('account');
      expect(create.mock.calls[0][0]).toBeInstanceOf(Blob);
      vi.advanceTimersByTime(1000);
      expect(revoke).toHaveBeenCalledWith('blob:options');
    } finally {
      createSpy.mockRestore();
      revokeSpy.mockRestore();
      vi.unstubAllGlobals();
      vi.useRealTimers();
    }
  });
});
