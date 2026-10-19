import { readdirSync, readFileSync } from 'node:fs';
import { parse } from 'svelte/compiler';
import { describe, expect, it } from 'vitest';

// OptionsPanel says these once, in the model line and "What the model leaves out".
const RESTATED =
  /European,? cash[- ]settled|historical (options )?(replay|backtest)|American assignment|\bBSM\b|financing\/borrowing|margin or assignment|brokerage or historical/i;

type Node = {
  type?: string;
  name?: string;
  data?: string;
};

const checkbox = (node: Node) =>
  JSON.stringify(node).includes('"data":"checkbox"');

/** Static text, minus acknowledgements the user must tick: those are decisions. */
function text(node: unknown, found: string[] = []): string[] {
  if (Array.isArray(node)) node.forEach(child => text(child, found));
  else if (node && typeof node === 'object') {
    const element = node as Node;
    if (element.type === 'Text' && element.data) found.push(element.data);
    if (element.type === 'RegularElement' && element.name === 'label')
      if (checkbox(element)) return found;
    Object.values(node).forEach(child => text(child, found));
  }
  return found;
}

describe('options model line', () => {
  it('is said once: the tools do not restate it', () => {
    const dir = new URL('./', import.meta.url);
    const restated: string[] = [];
    for (const file of readdirSync(dir).filter(
      f => f.endsWith('.svelte') && f !== 'OptionsPanel.svelte',
    )) {
      const ast = parse(readFileSync(new URL(file, dir), 'utf8'), {
        modern: true,
      });
      for (const run of text(ast.fragment)) {
        const match = RESTATED.exec(run);
        if (match) restated.push(`${file}: ${match[0]}`);
      }
    }
    expect(restated).toEqual([]);
  });
});
