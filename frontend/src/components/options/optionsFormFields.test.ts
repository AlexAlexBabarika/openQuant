import { readdirSync, readFileSync } from 'node:fs';
import { parse } from 'svelte/compiler';
import { describe, expect, it } from 'vitest';

type Node = {
  type?: string;
  name?: string;
  start?: number;
  attributes?: { type: string; name: string; value: unknown }[];
};

function fields(node: unknown, found: Node[] = []): Node[] {
  if (Array.isArray(node)) node.forEach(child => fields(child, found));
  else if (node && typeof node === 'object') {
    const element = node as Node;
    if (
      element.type === 'RegularElement' &&
      ['input', 'select', 'textarea'].includes(element.name ?? '')
    )
      found.push(element);
    Object.values(node).forEach(child => fields(child, found));
  }
  return found;
}

const attribute = (field: Node, name: string) =>
  field.attributes?.find(a => a.type === 'Attribute' && a.name === name);

describe('options form fields', () => {
  it('names every field and turns autocomplete off on typed ones', () => {
    const dir = new URL('./', import.meta.url);
    const unnamed: string[] = [];
    const autofilled: string[] = [];
    for (const file of readdirSync(dir).filter(f => f.endsWith('.svelte'))) {
      const ast = parse(readFileSync(new URL(file, dir), 'utf8'), {
        modern: true,
      });
      for (const field of fields(ast.fragment)) {
        const where = `${file}@${field.start}`;
        if (!attribute(field, 'name')) unnamed.push(where);
        const type = attribute(field, 'type')?.value;
        const typeText = Array.isArray(type) ? type[0]?.data : undefined;
        const typed =
          field.name === 'textarea' ||
          (field.name === 'input' &&
            (!type || ['text', 'number'].includes(typeText)));
        if (typed && !attribute(field, 'autocomplete')) autofilled.push(where);
      }
    }
    expect(unnamed).toEqual([]);
    expect(autofilled).toEqual([]);
  });
});
