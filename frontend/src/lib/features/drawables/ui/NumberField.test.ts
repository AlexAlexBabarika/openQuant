import { readFileSync } from 'node:fs';
import { compile } from 'svelte/compiler';
import { render } from 'svelte/server';
import { describe, expect, it } from 'vitest';
import NumberField from './NumberField.svelte';

const url = new URL('./NumberField.svelte', import.meta.url);

describe('Element numeric fields', () => {
  it('requires a value and preserves native range and step constraints', () => {
    const { body } = render(NumberField, {
      props: {
        label: 'Value area %',
        value: 0.7,
        min: 0.01,
        max: 1,
        step: 0.01,
      },
    });
    expect(body).toContain('required');
    expect(body).toContain('min="0.01"');
    expect(body).toContain('max="1"');
    expect(body).toContain('step="0.01"');
    expect(body).toContain('value="0.7"');
  });

  it('uses native numeric binding so editing text is not rewritten mid-input', () => {
    const source = readFileSync(url, 'utf8');
    const generated = compile(source, { generate: 'client' }).js.code;
    expect(source).toContain('bind:value');
    expect(source).not.toContain('value={value}');
    expect(generated).toContain('$.bind_value(input, value);');
  });
});
