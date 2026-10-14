import type { OptionsDraft } from './optionsTypes';

export const OPTIONS_SOURCE_LIMIT = 20000;

function pythonLiteral(value: unknown, depth = 0): string {
  if (value === null) return 'None';
  if (typeof value === 'boolean') return value ? 'True' : 'False';
  if (typeof value === 'number') {
    if (!Number.isFinite(value))
      throw new Error('Export needs finite numeric inputs.');
    return String(value);
  }
  if (typeof value === 'string') return JSON.stringify(value);
  const indent = '    '.repeat(depth);
  const next = '    '.repeat(depth + 1);
  if (Array.isArray(value)) {
    if (!value.length) return '[]';
    if (value.every(v => typeof v === 'number'))
      return `[${value.map(v => pythonLiteral(v)).join(', ')}]`;
    return `[\n${value.map(v => next + pythonLiteral(v, depth + 1)).join(',\n')}\n${indent}]`;
  }
  if (value && typeof value === 'object') {
    return `{\n${Object.entries(value)
      .map(
        ([k, v]) =>
          `${next}${JSON.stringify(k)}: ${pythonLiteral(v, depth + 1)}`,
      )
      .join(',\n')}\n${indent}}`;
  }
  throw new Error('Export needs complete inputs.');
}

export function exportOptionsPython(draft: OptionsDraft): string {
  return `# Manual/synthetic European cash-settled options research, USD.\n# analyze_options is supplied by the supported sandbox; no imports needed.\n# IV/rate/yield are annual fractions; premiums are USD per underlying unit.\nrequest = ${pythonLiteral(draft)}\n\nresult = analyze_options(request)\n`;
}
