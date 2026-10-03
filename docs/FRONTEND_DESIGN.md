# Frontend workbench conventions

OpenQuant is a quantitative research workbench: the chart, data context, code,
and reproducible results are the product. Extend its compact native controls;
do not replace them with a promotional dashboard or invent trading capabilities.

## Existing foundations

- `frontend/src/styles.css` owns semantic OKLCH tokens, light/dark themes,
  locally served fonts, and `ot-*` chrome utilities. Component styles remain
  scoped; Svelte's `:global(...)` syntax belongs only in component styles.
- Lato is the reading/form font. Space Mono (`--font-mono`) is for workbench
  chrome, code, coordinates, and numeric results. Preserve both fonts and the
  existing hierarchy: compact 11–12px chrome, 10px chart/axis annotations,
  ordinary form/body text, then section headings. Do not shrink essential labels
  to accommodate overflow.
- Chrome actions use the 28px workbench button, 4px corner radius, and 6–8px
  internal gaps. Shared Button sizes serve ordinary forms/dialogs. Match the
  surrounding surface, not a new page-wide spacing scale.
- Green primary actions and red destructive actions are separate from chart
  gain/loss and indicator colors. Chart colors, legend meanings, axes, price
  notation, and drawable semantics must not change as a side effect of UI work.
- Reuse shared Button/Input/Select/Dialog primitives where appropriate; the
  shared Dialog wraps Bits UI. Keep Svelte 5 runes and pure feature derivations
  in `frontend/src/lib/features/`, with regression tests alongside the logic.
- Backtest formatting/metric definitions already describe fractions, ratios,
  USD-by-dashboard-convention, counts, and bars. Use those meanings rather than
  inferring units or P&L from a color or a drawable.

## Additions: color and readable data

- Green action fills keep their existing hue; their foreground is dark.
  Destructive fills use the deeper red token and destructive foreground,
  including STOP. Shared destructive buttons do not add a dark-theme opacity
  wash; link actions use the readable foreground token. Do not copy literal
  reds/white text into a new action.
- Enabled action labels must reach **4.5:1** normally and on hover in both themes.
  Measure the resolved sRGB color, gamut mapping/clipping, and alpha compositing
  over the actual surface, not raw OKLCH coordinates. Check translucent states
  against background/card/popover surfaces. Disabled opacity is not the sample.
- Keep a visible keyboard focus indicator independent of hover/selection.
  Workbench utilities use a 2px outline with a 2px offset. New controls must also
  remain identifiable in forced colors; do not remove native focus without a
  replacement or rely on green/red alone.
- Numeric results use monospace/tabular alignment. Always state metric, unit,
  sign, and precision policy. A percentage is a display of a fraction; a ratio
  is unitless. Avoid rounding small nonzero values to an apparent zero; use
  appropriate precision or scientific notation.
- The sweep heatmap shows **unrounded raw values** and explicit units. Its five
  legend swatches at 0/25/50/75/100% use the same low-to-high mapping as cells,
  not an unrelated endpoint gradient. This ordering is not profitability or a
  universal better/worse score. Constant results use one midpoint swatch;
  missing/nonfinite results show `—` and “no result,” not a numeric zero.
  Accessible cell names include the metric, exact value/unit, and both parameter
  coordinates. A native title is supplementary, never the only value channel.

## Contributor interaction contracts

These are requirements for additions and touched flows, not a claim that every
legacy control has already been audited.

| Surface        | Contract                                                                                                                                                                                                                  |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Sheets/panels  | Keep context and section titles visible. Scroll the content region, not essential close/run actions offscreen. Do not introduce a second spacing/font system.                                                             |
| Menus/popovers | Use a labelled button trigger, visible focus, keyboard navigation appropriate to the primitive, Escape dismissal, and return focus. A tooltip is not an accessible name.                                                  |
| Tables/results | Preserve headers, units, numeric alignment, and an explicit sort control/direction. Rows that open details need a keyboard action. Keep missing data distinct from zero.                                                  |
| Forms          | Associate labels with fields; show constraints/units before submission and errors next to their field. Keep entered values after failure. Prevent duplicate submissions while pending.                                    |
| Feedback       | Distinguish initial loading, refresh with previous results, empty success, cancellation, and error. State the affected data/context; provide a useful retry when supported. Never present stale results as fresh success. |

- Use native buttons/inputs first. Every essential action needs a visible
  keyboard path; icon-only actions need a name. Use Enter/Space for buttons and
  the appropriate arrows/Home/End for tabs, menus, or sliders. Intercept only
  handled keys; do not steal chart/editor typing or page scrolling.
- Modal dialogs need a title, initial focus, forward/reverse focus containment,
  background isolation, Escape handling, and return focus to their trigger.
  Nested dialogs dismiss only the top layer. Prefer the existing Bits UI
  primitive rather than a hand-rolled modal; test the actual nesting path.
- Maintain compact density on small screens without clipping essential actions.
  Wrap control groups, give flex/grid children `min-width: 0` where needed, and
  use bounded scrolling for genuinely two-dimensional tables/heatmaps. Keep
  labels and units intact. Verify 360px, 760/761px breakpoint boundaries, and
  200% zoom; horizontal scrolling regions must be keyboard reachable.
- Reactive data/status belongs to its current symbol/provider/interval and
  request generation. Publish changes through tracked state; discard obsolete
  success/error responses after replacement or unmount. Pending/error/empty
  states must describe the current request, not whichever response finished
  last. Keep incremental chart updates and expose freshness where relevant.

## Validation

Run the frontend checks in `CONTRIBUTING.md`, plus focused runtime regressions.
For style changes inspect compiled selectors and resolved contrast, not just
compiler accessibility warnings. For interactive changes validate keyboard,
focus return, both themes, narrow reflow, and forced colors in the actual UI.
Preserve chart semantics and existing regressions. Bundle advisories alone are
not evidence for virtualization, editor splitting, or a redesign.
