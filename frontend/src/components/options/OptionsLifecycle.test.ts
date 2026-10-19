import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { compile } from 'svelte/compiler';
import { render } from 'svelte/server';
import { createOptionsDraft } from '$lib/features/options/optionsTemplates';
import { pathControls } from '$lib/features/options/optionsLifecycle';
import OptionsLifecycle from './OptionsLifecycle.svelte';
import OptionsHedgeLab from './OptionsHedgeLab.svelte';
import OptionsExpiryEditor from './OptionsExpiryEditor.svelte';

afterEach(() => vi.unstubAllGlobals());

describe('controlled lifecycle and hedge components', () => {
  const props = () => ({
    draft: new Proxy(createOptionsDraft(), {}),
    documentKey: 'guest:doc-a',
    onEdit: vi.fn(),
  });
  it.each(['OptionsLifecycle', 'OptionsHedgeLab', 'OptionsResearchTools'])(
    'contains %s in a shrinkable grid track without hiding overflow',
    name => {
      const source = readFileSync(
        new URL(`./${name}.svelte`, import.meta.url),
        'utf8',
      );
      const compiled = compile(source, {
        generate: 'client',
        filename: `${name}.svelte`,
      });
      expect(compiled.warnings).toEqual([]);
      expect(compiled.css?.code).toMatch(
        /grid-template-columns:\s*minmax\(0,\s*1fr\)/,
      );
      expect(source).not.toMatch(/overflow(?:-x)?:\s*hidden/);
    },
  );
  it('renders the lifecycle empty state and bounded explicit path controls without fetching or editing', () => {
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    const p = props();
    const html = render(OptionsLifecycle, { props: p }).body;
    expect(html).toContain('Options multi-expiry lifecycle');
    expect(html).toContain('Evaluate lifecycle');
    expect(html).toContain('No lifecycle evidence');
    expect(html).toContain('realized payoff');
    expect(html).toContain('seeded');
    expect(fetch).not.toHaveBeenCalled();
    expect(p.onEdit).not.toHaveBeenCalled();
  });
  it('renders bounded supplied CSV with validation beside the editable input', () => {
    const p = props();
    const html = render(OptionsLifecycle, {
      props: {
        ...p,
        controls: { ...pathControls(p.draft), source: 'supplied', csv: '0,' },
      },
    }).body;
    expect(html).toContain('day,spot');
    expect(html).toContain('maxlength="24000"');
    expect(html).toContain('Blank is not zero');
    expect(html).toContain('aria-invalid="true"');
  });
  it('reuses path inputs without offering duplicate lifecycle submission', () => {
    const html = render(OptionsLifecycle, {
      props: { ...props(), inputsOnly: true },
    }).body;
    expect(html).toContain('Hypothetical path inputs');
    expect(html).not.toContain('Evaluate lifecycle');
    expect(html).not.toContain('No lifecycle evidence');
  });
  it('renders hedge modes, costs and honest execution exclusions without automatic requests', () => {
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    const p = props();
    const html = render(OptionsHedgeLab, { props: p }).body;
    expect(html).toContain('Simulate hedge path');
    expect(html).toContain('observation-constrained');
    expect(html).toContain('Residual delta threshold');
    expect(html).toContain('per nonzero trade');
    expect(html).toContain('Slippage');
    expect(html).toContain('liquidated');
    expect(html).toContain('No interest on cash or market impact');
    expect(html).toContain('not total account equity');
    expect(html).not.toContain('Evaluate lifecycle');
    expect(fetch).not.toHaveBeenCalled();
    expect(p.onEdit).not.toHaveBeenCalled();
  });
  it('renders per-leg date/day overrides and explicit construction without changing common defaults', () => {
    const p = props();
    const before = JSON.stringify(p.draft);
    const html = render(OptionsExpiryEditor, { props: p }).body;
    expect(html).toContain('Per-leg expiry authoring');
    expect(html).toContain('Use common expiry');
    expect(html).toContain('calendar days (0–3650)');
    expect(html).toContain('Replace all legs with calendar');
    expect(html).toContain('entry premium');
    expect(html).toContain('0–1000000');
    expect(html).toContain('no invented quotes');
    expect(JSON.stringify(p.draft)).toBe(before);
    expect(p.onEdit).not.toHaveBeenCalled();
  });
  it('keeps stock expiry-free and disables mutation/submission in read-only mode', () => {
    const p = props();
    p.draft.strategy.legs[0].kind = 'underlying';
    const expiry = render(OptionsExpiryEditor, {
      props: { ...p, readOnly: true },
    }).body;
    expect(expiry).toContain('shares have no expiry');
    expect(expiry).toContain('<fieldset disabled');
    expect(expiry).toContain('Read-only source mode');
    const lifecycle = render(OptionsLifecycle, {
      props: { ...p, readOnly: true },
    }).body;
    expect(lifecycle).toMatch(/<button[^>]*disabled[^>]*>Evaluate lifecycle/);
    const hedge = render(OptionsHedgeLab, {
      props: { ...p, readOnly: true },
    }).body;
    expect(hedge).toMatch(/<button[^>]*disabled[^>]*>Simulate hedge path/);
  });
});
