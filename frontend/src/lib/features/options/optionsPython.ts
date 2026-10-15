import {
  autocompletion,
  snippetCompletion,
  type Completion,
  type CompletionContext,
} from '@codemirror/autocomplete';
import { syntaxTree } from '@codemirror/language';
import { EditorState, type Extension } from '@codemirror/state';
import type { OptionsDraft } from './optionsTypes';

export const OPTIONS_SOURCE_LIMIT = 20000;
export const OPTIONS_STDOUT_LIMIT = 16384;

export function optionsPythonSourceError(source: string): string | null {
  if (!source.trim()) return 'Enter Python source before analyzing.';
  if (source.length > OPTIONS_SOURCE_LIMIT)
    return 'Python source exceeds 20,000 characters. Nothing was truncated; shorten it before analyzing.';
  return null;
}

export function boundedOptionsStdout(stdout: string): {
  text: string;
  truncated: boolean;
} {
  let bytes = 0;
  let text = '';
  for (const char of stdout) {
    const point = char.codePointAt(0)!;
    const size =
      point <= 0x7f ? 1 : point <= 0x7ff ? 2 : point <= 0xffff ? 3 : 4;
    if (bytes + size > OPTIONS_STDOUT_LIMIT) return { text, truncated: true };
    bytes += size;
    text += char;
  }
  return { text, truncated: false };
}

export const OPTIONS_PYTHON_HELPERS: Completion[] = [
  snippetCompletion(
    'OptionLeg(kind="call", quantity=${1}, strike=${100}, entry_premium=${5}, multiplier=${100})',
    {
      label: 'OptionLeg',
      type: 'function',
      detail: '(**fields) → dict',
      info: 'Injected validating helper, not a class or import. Signed option contracts (±1–10,000), USD/unit premium, units/contract multiplier. Underlying uses signed shares, strike=None, multiplier=1 and no option IV/quotes/expiry. Optional days_to_expiry and expiry_date overrides, enabled, implied_volatility, bid/ask/quote_as_of and bounded source provenance.',
    },
  ),
  snippetCompletion('OptionStrategy(legs=[${leg}], days_to_expiry=${30})', {
    label: 'OptionStrategy',
    type: 'function',
    detail: '(**fields) → dict',
    info: 'Injected validating helper returns a dictionary with 1–16 explicit legs, ≥1 enabled. European cash-settled USD, ACT/365. Default days_to_expiry inherited by legs without overrides. Dates require valuation_date; supplied days and dates must agree. Calendar/diagonal labels do not change pricing. Optional underlying, name/template and once-only entry_fee_per_contract.',
  }),
  snippetCompletion('analyze_options(${request})', {
    label: 'analyze_options',
    type: 'function',
    detail: '(request: dict) → dict',
    info: 'Assign result = analyze_options(request). Canonical Python BSM manual/synthetic research only; no provider, brokerage or historical execution. Returns summary, signed total Greeks (undefined is None), aligned curves, exact expiry_curve vertices, per-leg contributions, scenarios and optional surface. USD totals include fixed premiums and fees.',
  }),
];

const FIELD_DOCS: [string, string][] = [
  [
    'strategy',
    'OptionStrategy dictionary; European cash-settled USD with default and optional per-leg expiries.',
  ],
  ['name', 'Nonblank strategy ≤120 characters; scenario ≤80 characters.'],
  [
    'template',
    'Descriptive template label only; explicit legs define the payoff.',
  ],
  [
    'legs',
    '1–16 legs, at least one enabled; options may override days_to_expiry and/or expiry_date.',
  ],
  [
    'days_to_expiry',
    '0–3650 default calendar days, ACT/365; optional per-leg override. A leg date alone resolves days using strategy.valuation_date.',
  ],
  [
    'underlying',
    'Optional manual identity, nonblank ≤80 characters or None; no provider lookup.',
  ],
  [
    'valuation_date',
    'Optional YYYY-MM-DD valid date, paired with expiry_date. Difference must equal days_to_expiry.',
  ],
  [
    'expiry_date',
    'Optional YYYY-MM-DD expiry. Strategy date matches default days; leg date overrides it and requires strategy.valuation_date. If leg days also supplied they must agree. No freshness claim.',
  ],
  ['currency', 'USD only.'],
  ['exercise_style', '"european" only; no early exercise model.'],
  ['settlement', '"cash" only; no physical settlement or brokerage.'],
  [
    'source',
    'Optional bounded Tradier contract provenance; observed exercise/delivery may be unknown or incompatible with the European cash model. Never a token or raw response.',
  ],
  [
    'entry_fee_per_contract',
    '0–10,000 USD × abs(enabled option quantity), charged once; stock fee is zero.',
  ],
  ['kind', '"call", "put" or "underlying".'],
  [
    'quantity',
    'Nonzero signed integer; options ±1–10,000 contracts, stock ±1–1,000,000 shares.',
  ],
  ['strike', 'Options: >0–1,000,000 USD. Underlying: None.'],
  [
    'entry_premium',
    '0–1,000,000 USD/unit; underlying entry price. Never automatically changed by quotes.',
  ],
  [
    'multiplier',
    '1–1000 units/option contract; underlying must explicitly use 1.',
  ],
  ['enabled', 'True/False; disabled legs contribute zero money and Greeks.'],
  [
    'implied_volatility',
    'Optional option IV fraction 0–5; None falls back to request.volatility. Forbidden on underlying.',
  ],
  [
    'bid',
    'Optional paired bid/ask USD/unit 0–1,000,000, bid ≤ ask; requires quote_as_of. Manual unverified quotes only.',
  ],
  [
    'ask',
    'Optional paired bid/ask USD/unit 0–1,000,000; metadata never changes entry_premium.',
  ],
  [
    'quote_as_of',
    'Optional ≤64-character timezone-aware ISO timestamp with T and Z or ±HH:MM. Manual, not verified/fresh. No underlying quotes.',
  ],
  ['spot', 'Current underlying spot >0–1,000,000 USD.'],
  [
    'volatility',
    'Annual IV fraction 0–5, default 0.2; fallback for options without their own IV.',
  ],
  ['rate', 'Annual continuously compounded rate fraction −1–1.'],
  ['dividend_yield', 'Annual continuous dividend yield fraction −1–1.'],
  [
    'spot_grid',
    '2–201 strictly increasing USD prices 0–1,000,000; aligned curves, separate exact expiry vertices.',
  ],
  [
    'scenarios',
    'Up to 3 named manual what-if scenarios with elapsed_days and iv_shift_pp.',
  ],
  [
    'elapsed_days',
    'Calendar days elapsed 0–first active option expiry; use lifecycle research for settlement beyond it.',
  ],
  [
    'iv_shift_pp',
    '−100–100 percentage points; shifts base and enabled resolved leg IVs, each must stay 0–5.',
  ],
  [
    'surface',
    'Optional/None bounded P&L grid {axis, spots, steps}; rows=steps, columns=spots, ≤861 cells.',
  ],
  [
    'axis',
    '"elapsed_days" at current resolved IV or "iv_shift_pp" at current time; fixed entry premiums/fees.',
  ],
  ['spots', 'Surface: 2–41 strictly increasing USD prices 0–1,000,000.'],
  [
    'steps',
    'Surface: 2–21 strictly increasing values; days 0–horizon, IV shifts −100–100 pp with all shifted IVs in 0–5.',
  ],
];

export const OPTIONS_PYTHON_FIELDS: Completion[] = FIELD_DOCS.map(
  ([label, info]) => ({
    label,
    type: 'property',
    detail: 'canonical input',
    info,
  }),
);

export function optionsPythonCompletions(context: CompletionContext) {
  const word = context.matchBefore(/\w*/);
  if (!word || (word.from === word.to && !context.explicit)) return null;
  let node = syntaxTree(context.state).resolveInner(context.pos, -1);
  let inString = false;
  let dictionaryString = false;
  for (; node.parent; node = node.parent) {
    if (node.name === 'Comment') return null;
    if (node.name === 'String' || node.name === 'FormatString') {
      inString = true;
      dictionaryString =
        /^(DictionaryExpression|SetExpression|SetComprehensionExpression)$/.test(
          node.parent.name,
        ) &&
        /[{,]\s*$/.test(
          context.state.doc.sliceString(node.parent.from, node.from),
        );
    }
  }
  if (inString && !dictionaryString) return null;
  return {
    from: word.from,
    options: inString
      ? OPTIONS_PYTHON_FIELDS
      : [...OPTIONS_PYTHON_HELPERS, ...OPTIONS_PYTHON_FIELDS],
    validFor: /^\w*$/,
  };
}

export function optionsPythonExtensions(onLimit: () => void): Extension[] {
  return [
    autocompletion({ override: [optionsPythonCompletions] }),
    EditorState.transactionFilter.of(transaction => {
      if (
        transaction.docChanged &&
        transaction.newDoc.length > OPTIONS_SOURCE_LIMIT &&
        transaction.newDoc.length >= transaction.startState.doc.length
      ) {
        onLimit();
        return [];
      }
      return transaction;
    }),
  ];
}

function pythonLiteral(value: unknown, depth = 0, compact = false): string {
  if (value === null) return 'None';
  if (typeof value === 'boolean') return value ? 'True' : 'False';
  if (typeof value === 'number') {
    if (!Number.isFinite(value))
      throw new Error('Export needs finite numeric inputs.');
    return Object.is(value, -0) ? '-0.0' : String(value);
  }
  if (typeof value === 'string') return JSON.stringify(value);
  const indent = '    '.repeat(depth);
  const next = '    '.repeat(depth + 1);
  if (Array.isArray(value)) {
    if (!value.length) return '[]';
    if (compact || value.every(v => typeof v === 'number'))
      return `[${value.map(v => pythonLiteral(v, depth + 1, compact)).join(compact ? ',' : ', ')}]`;
    return `[\n${value.map(v => next + pythonLiteral(v, depth + 1)).join(',\n')}\n${indent}]`;
  }
  if (value && typeof value === 'object') {
    return `{${compact ? '' : '\n'}${Object.entries(value)
      .map(
        ([k, v]) =>
          `${compact ? '' : next}${JSON.stringify(k)}:${compact ? '' : ' '}${pythonLiteral(v, depth + 1, compact)}`,
      )
      .join(compact ? ',' : ',\n')}${compact ? '' : '\n' + indent}}`;
  }
  throw new Error('Export needs complete inputs.');
}

export function exportOptionsPython(draft: OptionsDraft): string {
  const omitOptional = (value: object, fields: string[]) =>
    Object.fromEntries(
      Object.entries(value).filter(
        ([key, v]) => v !== undefined || !fields.includes(key),
      ),
    );
  const request = {
    ...omitOptional(draft, ['surface']),
    strategy: {
      ...omitOptional(draft.strategy, [
        'underlying',
        'valuation_date',
        'expiry_date',
      ]),
      legs: draft.strategy.legs.map(leg =>
        omitOptional(leg, [
          'implied_volatility',
          'bid',
          'ask',
          'quote_as_of',
          'days_to_expiry',
          'expiry_date',
          'source',
        ]),
      ),
    },
  };
  const wrap = (literal: string) =>
    `# Manual/synthetic European cash-settled options research, USD.\n# analyze_options is supplied by the supported sandbox; no imports needed.\n# IV/rate/yield are annual fractions; premiums are USD per underlying unit.\nrequest = ${literal}\n\nresult = analyze_options(request)\n`;
  const readable = wrap(pythonLiteral(request));
  const source =
    readable.length <= OPTIONS_SOURCE_LIMIT
      ? readable
      : wrap(pythonLiteral(request, 0, true));
  if (source.length > OPTIONS_SOURCE_LIMIT)
    throw new Error(
      'Python export exceeds 20,000 characters; reduce the request before exporting. Nothing was truncated.',
    );
  return source;
}
