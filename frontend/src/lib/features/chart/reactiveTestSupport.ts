import { readFileSync } from 'node:fs';
import { compile, compileModule, parse } from 'svelte/compiler';
import { transformSync } from 'esbuild';
import ts from 'typescript';
// @ts-expect-error Svelte does not publish types for its client test runtime.
import * as runtime from 'svelte/internal/client';

export const client: {
  proxy: <T>(value: T) => T;
  state: <T>(value: T) => { v: T };
  get: <T>(source: { v: T }) => T;
  set: <T>(source: { v: T }, value: T) => void;
  effect: (fn: () => void | (() => void)) => void;
  user_effect: (fn: () => void | (() => void)) => void;
  effect_root: (fn: () => void) => () => void;
  flush: () => void;
  untrack: <T>(fn: () => T) => T;
} = runtime;

// Compile the real client code in Node: these script-only components need no DOM.
export function clientModule<T>(
  url: URL,
  imports: Record<string, unknown> = {},
  source = readFileSync(url, 'utf8'),
): T {
  const filename = url.pathname;
  const code = filename.endsWith('.svelte')
    ? compile(source, {
        filename,
        generate: 'client',
        runes: true,
        dev: false,
        discloseVersion: false,
      }).js.code
    : compileModule(transformSync(source, { loader: 'ts' }).code, {
        filename,
        generate: 'client',
        dev: false,
      }).js.code;
  const cjs = transformSync(code, { format: 'cjs' }).code;
  const module = { exports: {} };
  const require = (name: string) => {
    if (name === 'svelte/internal/client') return runtime;
    if (name === 'svelte')
      return {
        untrack: client.untrack,
        onDestroy: (cleanup: () => void) => client.effect(() => cleanup),
      };
    if (name.startsWith('svelte/internal/flags/')) return {};
    if (name in imports) return imports[name];
    throw new Error(`Unprovided test import: ${name}`);
  };
  new Function('require', 'exports', 'module', cjs)(
    require,
    module.exports,
    module,
  );
  return module.exports as T;
}

// Execute named production script declarations without mounting chart/editor DOM.
export function componentDeclarations(url: URL, names: string[]): string {
  const component = readFileSync(url, 'utf8');
  const instance = parse(component, { modern: true }).instance;
  const source = instance
    ? component
        .slice(instance.start, instance.end)
        .replace(/^<script[^>]*>|<\/script>$/g, '')
    : '';
  const ast = ts.createSourceFile(
    url.pathname,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  return names
    .map(name => {
      const statement = ast.statements.find(
        node =>
          (ts.isFunctionDeclaration(node) && node.name?.text === name) ||
          (ts.isVariableStatement(node) &&
            node.declarationList.declarations.some(
              d => ts.isIdentifier(d.name) && d.name.text === name,
            )),
      );
      if (!statement)
        throw new Error(`Missing production declaration: ${name}`);
      return statement.getText(ast);
    })
    .join('\n');
}

export function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}
