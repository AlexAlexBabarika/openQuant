import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { compile as compileCss, optimize } from '@tailwindcss/node';
import { compile as compileSvelte } from 'svelte/compiler';
import postcss, { type Root } from 'postcss';
import {
  clampRgb,
  converter,
  interpolate,
  parse,
  toGamut,
  wcagContrast,
  type Rgb,
} from 'culori';
import { buttonVariants } from '$lib/components/ui/button';

const base = fileURLToPath(new URL('./', import.meta.url));
const source = readFileSync(`${base}styles.css`, 'utf8');
let css: Root;

function declarations(selector: string, root = css): Record<string, string> {
  const result: Record<string, string> = {};
  root.walkRules(rule => {
    if (!rule.selectors.includes(selector)) return;
    rule.walkDecls(decl => {
      result[decl.prop] = decl.value;
    });
  });
  return result;
}

function tokens(dark: boolean) {
  return { ...declarations(':root'), ...(dark ? declarations('.dark') : {}) };
}

function resolveColor(value: string, vars: Record<string, string>): Rgb {
  const resolved = value.replace(/var\((--[\w-]+)\)/g, (_, key) => vars[key]);
  const mix = resolved.match(
    /^color-mix\(in oklab, (.+) ([\d.]+)%, (transparent|black)(?: [\d.]+%)?\)$/,
  );
  if (mix?.[3] === 'black')
    return converter('rgb')(
      interpolate([mix[1], 'black'], 'oklab')(1 - Number(mix[2]) / 100),
    )!;
  const color = converter('rgb')(parse(mix ? mix[1] : resolved)!);
  if (!color) throw new Error(`Unsupported test color: ${resolved}`);
  return {
    ...color,
    alpha: (color.alpha ?? 1) * (mix ? Number(mix[2]) / 100 : 1),
  };
}

function composite(top: Rgb, bottom: Rgb): Rgb {
  const alpha = top.alpha ?? 1;
  return {
    mode: 'rgb',
    r: top.r * alpha + bottom.r * (1 - alpha),
    g: top.g * alpha + bottom.g * (1 - alpha),
    b: top.b * alpha + bottom.b * (1 - alpha),
  };
}

function contrast(
  foreground: string,
  background: string,
  vars: Record<string, string>,
  surface: string,
) {
  // Test both channel clipping and CSS Color 4's perceptual sRGB gamut mapping.
  return [(color: Rgb) => clampRgb(color), toGamut('rgb', 'oklch')].map(map => {
    const rgb = (value: string) =>
      converter('rgb')(map(resolveColor(value, vars)))!;
    const bg = composite(rgb(background), rgb(surface));
    return wcagContrast(composite(rgb(foreground), bg), bg);
  });
}

function utility(className: string) {
  const selector = `.${className.replace(/[:/]/g, '\\$&')}${className.includes('hover:') ? ':hover' : ''}`;
  return declarations(selector);
}

beforeAll(async () => {
  const candidates = [
    ...new Set(
      (
        [
          'default',
          'destructive',
          'link',
          'secondary',
          'outline',
          'ghost',
        ] as const
      ).flatMap(variant => buttonVariants({ variant }).split(' ')),
    ),
    'bg-primary/10',
    'text-primary',
  ];
  const compiled = await compileCss(source, { base, onDependency() {} });
  css = postcss.parse(
    optimize(compiled.build(candidates), { minify: false }).code,
  );
});

describe.each([false, true])('resolved action colors (dark=%s)', dark => {
  it('keeps enabled inactive-tab text readable on the muted surface', () => {
    const vars = tokens(dark);
    for (const ratio of contrast(
      'oklch(var(--muted-foreground))',
      'oklch(var(--muted))',
      vars,
      'oklch(var(--background))',
    ))
      expect(ratio).toBeGreaterThanOrEqual(4.5);
  });

  it('keeps selected-control text readable over translucent primary on every surface', () => {
    const vars = tokens(dark);
    for (const surface of ['background', 'card', 'popover']) {
      for (const ratio of contrast(
        utility('text-primary').color,
        utility('bg-primary/10')['background-color'],
        vars,
        `oklch(var(--${surface}))`,
      ))
        expect(ratio).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('keeps every shared action variant readable normally and on hover on each surface', () => {
    const vars = tokens(dark);
    for (const variant of [
      'default',
      'destructive',
      'link',
      'secondary',
      'outline',
      'ghost',
    ] as const) {
      const classes = buttonVariants({ variant }).split(' ');
      const textClass = classes.find(
        c => c.startsWith('text-') && utility(c).color,
      )!;
      const foreground = textClass
        ? utility(textClass).color
        : 'oklch(var(--foreground))';
      const background =
        (dark && classes.find(c => c.startsWith('dark:bg-'))) ||
        classes.find(c => c.startsWith('bg-'));
      const hover =
        (dark && classes.find(c => c.startsWith('dark:hover:bg-'))) ||
        classes.find(c => c.startsWith('hover:bg-'));
      const hoverText = classes.find(c => c.startsWith('hover:text-'));
      for (const surface of ['background', 'card', 'popover']) {
        const substrate = `oklch(var(--${surface}))`;
        const normal = background
          ? utility(background)['background-color']
          : substrate;
        const hovered = hover ? utility(hover)['background-color'] : normal;
        for (const [text, fill] of [
          [foreground, normal],
          [hoverText ? utility(hoverText).color : foreground, hovered],
        ]) {
          for (const ratio of contrast(text, fill, vars, substrate))
            expect(ratio).toBeGreaterThanOrEqual(4.5);
        }
      }
    }
  });

  it('keeps context and ghost chrome readable in enabled and hover states', () => {
    const vars = tokens(dark);
    for (const name of ['.ot-ctx-pill', '.ot-workbench-ghost']) {
      const normal = {
        ...declarations(name),
        ...(dark ? {} : declarations(`html:not(.dark) ${name}`)),
      };
      const hover = {
        ...normal,
        ...declarations(`${name}:hover:not(:disabled)`),
        ...(dark
          ? {}
          : declarations(`html:not(.dark) ${name}:hover:not(:disabled)`)),
      };
      for (const state of [normal, hover]) {
        const fill =
          state.background === 'none'
            ? 'oklch(var(--background))'
            : state.background;
        for (const ratio of contrast(
          state.color,
          fill,
          vars,
          'oklch(var(--background))',
        ))
          expect(ratio).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it('keeps workbench RUN/STREAM and both STOP patterns readable without changing chart colors', () => {
    const vars = tokens(dark);
    const primary = declarations('.ot-workbench-primary');
    const hover = declarations('.ot-workbench-primary:hover:not(:disabled)');
    for (const selector of [
      '.ot-workbench-primary',
      'html .ot-workbench-primary.stop',
      'html .btn.primary.stop[class]',
    ]) {
      const normal = { ...primary, ...declarations(selector) };
      const hovered = {
        ...normal,
        ...hover,
        ...declarations(`${selector}:hover:not(:disabled)`),
      };
      for (const state of [normal, hovered]) {
        for (const ratio of contrast(
          state.color,
          state.background,
          vars,
          'oklch(var(--background))',
        ))
          expect(ratio).toBeGreaterThanOrEqual(4.5);
      }
    }
    for (const ratio of contrast(
      'oklch(var(--sidebar-primary-foreground))',
      'oklch(var(--sidebar-primary))',
      vars,
      'oklch(var(--sidebar))',
    ))
      expect(ratio).toBeGreaterThanOrEqual(4.5);
    expect(converter('oklch')(`oklch(${vars['--up-color']})`)?.h).toBeCloseTo(
      131.684,
    );
    expect(converter('oklch')(`oklch(${vars['--down-color']})`)?.h).toBeCloseTo(
      27.325,
    );
    expect(converter('oklch')(`oklch(${vars['--down-color']})`)).toMatchObject({
      l: 0.577,
      c: 0.245,
      h: 27.325,
    });
  });
});

describe('compiled global selectors', () => {
  it('preserves the dark-theme primary palette', () => {
    const vars = tokens(true);
    expect(converter('oklch')(`oklch(${vars['--primary']})`)).toMatchObject({
      l: 0.648,
      c: 0.2,
      h: 131.684,
    });
    expect(
      converter('oklch')(`oklch(${vars['--primary-foreground']})`),
    ).toMatchObject({
      l: 0.141,
      c: 0.005,
      h: 285.823,
    });
  });

  it.each([
    'components/chart/ChartOptionsMenu.svelte',
    'components/toolbar/ToolSettingsModal.svelte',
  ])(
    'bounds %s by the dynamic viewport and allows vertical scrolling',
    async filename => {
      const menu = readFileSync(`${base}${filename}`, 'utf8');
      const classes = menu
        .match(/<Dialog\.Content[\s\S]*?class="([^"]+)"/)![1]
        .split(/\s+/);
      const compiled = await compileCss(source, { base, onDependency() {} });
      const menuCss = postcss.parse(
        optimize(compiled.build(classes), { minify: false }).code,
      );
      expect(
        declarations('.max-h-\\[calc\\(100dvh-2rem\\)\\]', menuCss)[
          'max-height'
        ],
      ).toBe('calc(100dvh - 2rem)');
      expect(declarations('.overflow-y-auto', menuCss)['overflow-y']).toBe(
        'auto',
      );
    },
  );

  it('ships native light-only selectors and the declared pill/ghost treatment', () => {
    css.walkRules(rule => {
      expect(
        rule.selectors.every(selector => !selector.includes(':global(')),
      ).toBe(true);
    });
    const pill = declarations('html:not(.dark) .ot-ctx-pill');
    const ghost = declarations('html:not(.dark) .ot-workbench-ghost');
    const hover = declarations(
      'html:not(.dark) .ot-workbench-ghost:hover:not(:disabled)',
    );
    expect(pill).toMatchObject({
      color: '#000',
      background: '#fff',
      'border-color': '#000',
    });
    expect(ghost).toMatchObject({ color: '#000', 'border-color': '#000' });
    expect(hover).toMatchObject({ color: '#fff', background: '#000' });
    expect(declarations('.ot-ctx-pill').color).toBe(
      'oklch(var(--muted-foreground))',
    );
    expect(declarations('.ot-workbench-ghost').color).toBe(
      'oklch(var(--foreground))',
    );
  });

  it('overrides the compiled panel STOP selector even if panel CSS loads last', () => {
    const filename = `${base}components/indicators/IndicatorsPanel.svelte`;
    const panel = postcss.parse(
      compileSvelte(readFileSync(filename, 'utf8'), {
        filename,
        generate: 'server',
      }).css!.code,
    );
    const selectors: string[] = [];
    panel.walkRules(rule => {
      selectors.push(
        ...rule.selectors.filter(
          s => s.startsWith('.btn.primary.stop') && !s.includes(':hover'),
        ),
      );
    });
    expect(selectors).toHaveLength(1);
    const scopedClasses = selectors[0].match(/\.[\w-]+/g)!.length;
    expect(scopedClasses).toBe(4);
    const global = 'html .btn.primary.stop[class]';
    // Four class/attribute components plus the html type beat four scoped classes.
    expect(global.match(/\.[\w-]+|\[[^\]]+\]/g)!.length).toBe(scopedClasses);
    expect(declarations(global)).toMatchObject({
      background: 'oklch(var(--destructive))',
      color: 'oklch(var(--destructive-foreground))',
    });
    css.walkRules(rule => {
      if (rule.selectors.includes(global))
        expect(rule.parent?.type).toBe('root');
    });
  });
});
