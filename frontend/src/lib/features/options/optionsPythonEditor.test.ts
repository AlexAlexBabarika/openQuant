import {
  readFileSync,
  mkdtempSync,
  writeFileSync,
  rmSync,
  existsSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { render } from 'svelte/server';
import { parse } from 'svelte/compiler';
import ts from 'typescript';
import { describe, expect, it, vi } from 'vitest';
import OptionsPythonEditor from '../../../components/options/OptionsPythonEditor.svelte';
import { createOptionsDraft } from './optionsTemplates';
import { exportOptionsPython, OPTIONS_SOURCE_LIMIT } from './optionsPython';

const componentSource = readFileSync(
  new URL(
    '../../../components/options/OptionsPythonEditor.svelte',
    import.meta.url,
  ),
  'utf8',
);

describe('options Python editor contract (SSR and pure callbacks)', () => {
  it('renders the themed CodeMirror host, scoped shortcuts and explicit local actions, without mutating source', () => {
    const onChange = vi.fn();
    const onRun = vi.fn();
    const source = 'custom_source = "not overwritten"';
    const html = render(OptionsPythonEditor, {
      props: { source, onChange, onRun, documentKey: 'account-a:1' },
    }).body;
    expect(html).toContain('editor-host');
    expect(html).not.toContain('<textarea');
    expect(html).toContain('Ctrl/⌘+Enter');
    expect(html).toContain('Ctrl+Space');
    expect(html).toContain('Copy Python');
    expect(html).toContain('Export .py');
    expect(html).toContain('No Python stdout');
    expect(componentSource).toContain(
      'value={source} onChange={change} onRun={run} {documentKey} {extensions}',
    );
    expect(componentSource).not.toContain('exportOptionsPython');
    expect(componentSource).not.toContain('svelte:window');
    expect(componentSource).toContain("key: 'Mod-Enter'");
    expect(componentSource).toContain('stopPropagation: true');
    expect(onChange).not.toHaveBeenCalled();
    expect(onRun).not.toHaveBeenCalled();
  });

  it.each([
    { pending: true, source: 'custom' },
    { source: '' },
    { source: 'x'.repeat(OPTIONS_SOURCE_LIMIT + 1) },
  ])(
    'disables only analysis for pending/invalid source and preserves copy/export',
    props => {
      const html = render(OptionsPythonEditor, {
        props: { ...props, onChange: vi.fn(), onRun: vi.fn() },
      }).body;
      expect(html).toMatch(
        /<button[^>]*disabled[^>]*>\s*(?:Analyze Python|Analyzing…)/,
      );
      expect(html).toMatch(/<button[^>]*>Copy Python<\/button>/);
      expect(html).toMatch(/<button[^>]*>Export \.py<\/button>/);
    },
  );

  it('shows escaped canonical stdout/error and labels pending output as previous submission', () => {
    const html = render(OptionsPythonEditor, {
      props: {
        source: 'print("manual")',
        onChange: vi.fn(),
        onRun: vi.fn(),
        stdout: '<script>private = 1</script>' + '😀'.repeat(5000),
        error: '<failure>',
        pending: true,
      },
    }).body;
    expect(html).toContain('&lt;script>private = 1&lt;/script>');
    expect(html).not.toContain('<script>private');
    expect(html).toContain('&lt;failure>');
    expect(html).toContain('16,384 UTF-8 bytes');
    expect(html).toContain('previous submission');
    expect(html).toContain('role="region"');
    expect(html).toContain('tabindex="0"');
  });

  it('forwards source edits and guards the actual run callback', () => {
    const ast = parse(componentSource, { modern: true });
    const functions = ast.instance!.content.body.filter(
      node =>
        node.type === 'FunctionDeclaration' &&
        ['change', 'run'].includes(node.id!.name),
    );
    const script = functions
      .map(node => {
        const span = node as typeof node & { start: number; end: number };
        return componentSource.slice(span.start, span.end);
      })
      .join('\n');
    const code = ts.transpileModule(script, {
      compilerOptions: { target: ts.ScriptTarget.ES2022 },
    }).outputText;
    const onChange = vi.fn();
    const onRun = vi.fn();
    for (const canRun of [false, true]) {
      const [change, run] = new Function(
        'canRun',
        'onChange',
        'onRun',
        `let limitError, actionNotice; ${code}; return [change, run];`,
      )(canRun, onChange, onRun);
      change('custom changed source');
      run();
    }
    expect(onChange.mock.calls).toEqual([
      ['custom changed source'],
      ['custom changed source'],
    ]);
    expect(onRun).toHaveBeenCalledOnce();
  });
});

describe('actual frontend export → guest spawned Python endpoint', () => {
  const root = fileURLToPath(new URL('../../../../../', import.meta.url));
  const python = join(root, '.venv/bin/python');
  it.skipIf(!existsSync(python))(
    'round-trips expanded metadata, signed legs, both surfaces and canonical output without imports',
    () => {
      const directory = mkdtempSync(
        join(tmpdir(), 'openquant-options-export-'),
      );
      try {
        const drafts = ['elapsed_days', 'iv_shift_pp'].map(axis => {
          const d = createOptionsDraft();
          d.strategy.name = 'Manual " π \\ \n export';
          d.strategy.underlying = 'Manual XYZ';
          d.strategy.valuation_date = '2026-10-14';
          d.strategy.expiry_date = '2026-11-13';
          d.rate = -0.0123456789012345;
          d.dividend_yield = -0.02;
          d.spot_grid = [0, 50.12345678901234, 100, 150];
          d.strategy.entry_fee_per_contract = 1.123456789012345;
          d.strategy.legs = [
            {
              ...d.strategy.legs[0],
              quantity: -2,
              entry_premium: 4.123456789012345,
              implied_volatility: 0.31,
              bid: 4.000000000000001,
              ask: 5,
              quote_as_of: '2026-10-14T11:00:00+00:00',
            },
            {
              kind: 'put' as const,
              quantity: 1,
              strike: 100,
              entry_premium: 5,
              multiplier: 100,
              enabled: true,
              implied_volatility: null,
              bid: null,
              ask: null,
              quote_as_of: null,
            },
            {
              kind: 'underlying' as const,
              quantity: -100,
              strike: null,
              entry_premium: 102.12345678901234,
              multiplier: 1,
              enabled: true,
            },
            {
              ...d.strategy.legs[0],
              enabled: false,
              implied_volatility: 0,
              quantity: -1,
            },
          ];
          d.scenarios = [
            { name: 'Days+IV', elapsed_days: 30, iv_shift_pp: -5 },
          ];
          d.surface = {
            axis: axis as 'elapsed_days' | 'iv_shift_pp',
            spots: [0, 100, 150],
            steps: axis === 'elapsed_days' ? [0, 30] : [-5, 0, 5],
          };
          return d;
        });
        writeFileSync(
          join(directory, 'payloads.json'),
          JSON.stringify(
            drafts.map(request => ({
              request,
              source:
                exportOptionsPython(request) + 'print("manual diagnostics")\n',
            })),
          ),
        );
        writeFileSync(
          join(directory, 'check.py'),
          `import json, sys
from pathlib import Path
from fastapi import FastAPI
from fastapi.testclient import TestClient
from backend.routes.options_routes import router
from backend.derivatives import analyze_options

if __name__ == "__main__":
    app = FastAPI()
    app.include_router(router)
    with TestClient(app) as client:
        for case in json.loads(Path(sys.argv[1]).read_text()):
            response = client.post("/options/python", json={"source": case["source"]})
            assert response.status_code == 200, response.text
            actual = response.json()
            assert actual.pop("stdout") == "manual diagnostics\\n"
            expected = analyze_options(case["request"]).model_dump(mode="json")
            assert actual == expected
    print("expanded exports passed spawned HTTP endpoint")
`,
        );
        const output = execFileSync(
          python,
          [join(directory, 'check.py'), join(directory, 'payloads.json')],
          {
            cwd: root,
            env: { ...process.env, PYTHONPATH: root },
            encoding: 'utf8',
            timeout: 30000,
          },
        );
        expect(output).toContain(
          'expanded exports passed spawned HTTP endpoint',
        );
      } finally {
        rmSync(directory, { recursive: true, force: true });
      }
    },
    35000,
  );
});
