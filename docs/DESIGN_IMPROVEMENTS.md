# Design improvement proposals

Status: in progress. See "Progress" at the end for what has been implemented.

This records the design directions discussed for making the openQuant frontend
look more professional. It complements `FRONTEND_DESIGN.md`, which describes the
current conventions; where the two disagree, this document is proposing a change
or pointing out drift.

Findings come from reading `frontend/src/styles.css`, counting values across
`frontend/src`, and the screenshots in `docs/images` and `showcase/captures`.
The app was not run for this review, so counts are grep counts of source, not
measurements of rendered UI.

The screenshots date from 2026-10-19. Later commits (sentence-case panel labels
and a shared panel top bar, both 2026-11-14) may already cover parts of items 1
and 2 in Part 1. Re-check those against the running app before working on them.

## Scope and stance

openQuant is a dense research workbench, not a marketing page. Landing-page
techniques (floating pill navigation, nested "double-bezel" cards, scroll
reveals, large whitespace) are out of scope and would make it look less
professional. The existing foundations are kept: Geist and Geist Mono, semantic
OKLCH tokens, light and dark themes, compact controls.

The gap is consistency and hierarchy, not style.

## Part 1: Interface directions

In rough priority order. Items 1 to 4 give the most visible lift.

### 1. Cut chrome height

The Strategy view stacks about six rows before any content: navigation, data
context, sub-tabs, strategy title, data quality, save status. That is roughly a
third of the viewport.

- Merge the save status into the strategy title row.
- Show "Data quality · N warnings" once. It currently appears twice on the same
  screen (above the editor and above the results).
- Collapse the data context row to a single summary chip when it is not being
  edited.

### 2. One control vocabulary

The same screen mixes sentence-case tabs (`Chart`), lowercase mono tabs
(`editor`), lowercase buttons (`new`, `save`), uppercase (`BACKTEST`) and
outlined sentence-case buttons (`Load history`).

- Pick one casing rule for labels.
- Use three button tiers everywhere: primary, outlined, quiet.

### 3. Fewer borders

Nearly every control is outlined, so nothing recedes and the UI looks boxy.

- Make secondary actions borderless. The `.ot-workbench-ghost.quiet` variant
  already exists.
- Separate panels by surface tint rather than 1px lines (depends on the surface
  ladder in Part 2).
- Keep outlines for inputs and the one or two key actions per bar.

### 4. Ration the primary green

The primary fill marks both the active sub-tab (`editor`) and the `BACKTEST`
button, so the eye has two targets.

- Keep the fill for the run action only.
- Give active tabs a neutral treatment, such as the underline the top
  navigation already uses.

### 5. Tighten the token scale

Covered in detail in Part 2. The CSS has drifted from `FRONTEND_DESIGN.md` in
font sizes, letter-spacing, radii, shadows and easing.

### 6. Format data for people

- `Completed 2026-10-19T19:32:04.510417+00:00` is a raw ISO string with
  microseconds. Show a short local time, with the full value in a tooltip.
- Review other raw strings in result headers, such as `run 6795f5a2… compare…`.

### 7. Drop the gimmicks

The glitch effect on the error dialog title (`components/layout/GlitchText.svelte`)
undermines trust in a tool whose pitch is reproducible results. Errors should
be the calmest, clearest surface in the app.

### 8. Give the brand a real mark

The logo is mono text plus a stock Lucide candlestick icon. A simple custom
glyph and wordmark, reused for the favicon and empty states, would lift
perceived quality for little work.

### 9. Polish the edge states

- Empty states such as `no data — load market data first.` could carry a
  one-click action.
- Check that skeleton loaders match the final layout.
- Make the outlined full-width "Tools" bar at the bottom read as a dock rather
  than a stray button.

## Part 2: Design foundations

The token layer is too thin, so components fill the gaps by hand. That is the
source of most of the inconsistency above.

### Palette

**Surfaces.** There are effectively two: `--background` and `--card`.
`--popover` aliases card; `--muted` and `--secondary` alias background. With no
elevation steps, every panel needs a border to separate itself.

- Add a four-step ladder: app, panel, raised, overlay.
- Add hover and selected tints.

**Text and border levels.** There are only `--foreground` and
`--muted-foreground`, and a single `--border`. Components compensate with 221
inline `color-mix()` calls, for example foreground at 50%, 45% and 35%, and
`popover + black 4%`. 42 of them mix `--border` at 100%, which is a no-op.

- Add a tertiary text level.
- Add subtle and strong border variants.
- Replace the inline mixes with these tokens.

**Border contrast.** In dark mode the border (`#33404D`) on card (`#18212B`) is
high contrast for a line that appears everywhere. Use a softer default and
reserve the stronger variant for inputs.

**Hue count.** The palette has a lime primary, teal for gains, a separate green
for "ok", three blues (ring, info, accent), purple, amber and two reds. The
split between action green and gain teal is deliberate per `FRONTEND_DESIGN.md`,
but the two still read as related on screen.

Open decision, two options:

| Option | Description | Trade-off |
|---|---|---|
| Keep lime as brand | Lime only for the run action and the logo; selection and active states become neutral | Smallest change; keeps current identity |
| Neutral actions (recommended) | Near-white primary in dark mode, near-black in light; colour on screen always means data | More institutional look; lime survives only in the brand mark |

Either way, chart colours, gain/loss semantics and status tokens are unchanged.

**Cleanups.**

- `--chart-grid` is a hex literal among OKLCH tokens.
- `--destructive` has the same lightness in both themes; confirm this is still
  intended for every place it is used.

### Typography

| Finding | Evidence | Proposal |
|---|---|---|
| No type tokens | 12px (84 uses), 11px (67), 10px (43), 13px (18), 14px (13), plus strays at 15, 16, 18, 20, 22px and several `rem` values | About five named steps (annotation, chrome, body, title, display) with paired line heights |
| 10px overused | 43 uses, beyond the "chart and axis annotations only" rule | Raise most to 11px |
| Weight is binary | 600 (59 uses) and 400; 500 is shipped but unused | Use 500 for labels and tabs |
| Tracking drift | Six values from 0.04em to 0.18em | Two: normal, and one for uppercase labels |
| Numeric alignment by hand | `tabular-nums` set in 52 places | One numeric utility class |

### Shape, spacing and sizing

| Finding | Evidence | Proposal |
|---|---|---|
| Radii are hardcoded | `--radius` is 6px, so the derived `--radius-md` is already the 4px control radius; components hardcode 4px (76 times) instead, plus 2, 3, 6, 8 and 12px | Keep `--radius`; replace hardcoded values with the derived `--radius-*` steps |
| Control height disagrees three ways | Token says 32px, `FRONTEND_DESIGN.md` says 28px, code uses 26, 28, 30, 32 and 36px | Two heights: compact chrome and standard form (44px touch height stays) |
| Spacing is near a scale, not on one | Gaps of 4, 6, 8, 10 and 12px are all common | A named spacing scale |

### Elevation, motion and layers

| Area | Current | Proposal |
|---|---|---|
| Shadows | Primary-tinted glows (`0 6px 18px -6px` at 60% primary) and one raw black shadow | Two neutral tokens: popover and dialog |
| Motion | `120ms ease` (31 uses) plus five other variants. A global `prefers-reduced-motion` rule already exists in `styles.css` | Two duration and easing pairs |
| Z-index | 10, 20, 40, 50, 60, 70, 80 and 90 scattered across components | Named layers: dropdown, sticky, dialog, toast |
| Disabled state | Six different opacity values | One token |

## Suggested rollout

1. **Add tokens, change nothing visually.** Surfaces, text and border levels,
   type steps, radius, control heights, spacing, shadows, motion, layers,
   disabled opacity. Verify with a before/after screenshot comparison.
2. **Migrate area by area.** Replace hardcoded values and inline `color-mix()`
   calls with tokens, one feature folder at a time.
3. **Apply the interface directions** from Part 1 (chrome height, control
   vocabulary, borders, primary colour usage).
4. **Retune the palette last.** By then it is a change to one file, and the two
   action-colour options can be compared side by side.
5. **Update `FRONTEND_DESIGN.md`** so it matches the new tokens (radius, control
   height and type rules in particular).

## Open questions

- Lime primary kept for actions, or neutral actions?
- Which casing rule for control labels?
- Is the glitch effect wanted anywhere, or removed entirely?
- Is a custom logo mark in scope?

## Progress

### Recheck against the running app (2026-11-16)

Checked in both themes with the frontend dev server and mocked API responses
(market data and one backtest run); the backend was not running.

- **Item 1, chrome height: still open.** With a completed run there are eight
  rows above the metrics, which start about 390px down a 900px viewport.
- **Item 2, control vocabulary: mostly done already** by the sentence-case
  commit. Remaining uppercase: `BACKTEST`, `SIMULATED RESULTS · NO REAL ORDERS`,
  the `SRC` value and the `WORKSPACE STRATEGY` badge.
- **Item 3, borders: partly open.** `Workspaces` and `Guided example` are now
  quiet; `Load history`, `Stream`, `New`, `Robustness`, `Save` and the
  editor/results toggles are still outlined.
- **Item 4, primary green: still open.** The active `Editor` tab and `BACKTEST`
  both use the fill.

### Done

- **Tokens in `:root` in `styles.css`.**
  - Colour levels: `--foreground-tertiary`, `--border-strong`,
    `--border-subtle`, `--surface-hover`, `--surface-selected`,
    `--surface-sunken`, `--surface-raised`.
  - Type: `--font-size-annotation` to `--font-size-title`, three
    `--line-height-*` steps, `--tracking-caps`.
  - Sizing: `--control-height-compact` (28px) next to the existing 32px.
  - Motion: `--motion-fast`, `--motion-base`.
  - State: `--opacity-disabled`.
  - Layers: `--z-header`, `--z-popover`, `--z-dialog`, `--z-dialog-popover`,
    `--z-top`.
  - Elevation: `--elevation-popover`, `--elevation-dialog`, exposed to Tailwind
    as `shadow-popover` and `shadow-dialog`.
- **Component migration with no visual change.** Font sizes (225
  declarations), `120ms ease` transitions, disabled opacity, the 50%, 6% and
  10% colour mixes, and the popover, dialog and top z-index classes now use
  tokens. Screenshots of the chart, strategy, backtest and robustness views
  were pixel-identical before and after, in both themes. Two tests that read
  literal `z-[N]` classes now resolve the layer tokens instead.
- **Surface ladder.** Floating layers (menus, popovers, dialogs) sit on
  `--surface-raised`, which `--popover` now points to; in dark mode it is one
  step lighter than a panel. Panels that used `--popover` as their background
  were repointed to `--card`, so they did not change. The ad hoc
  "background plus black" wells use `--surface-sunken`.
- **Subtle border.** Single-side divider lines (scoped CSS, the Tailwind
  `border-b border-border` family, and `.ot-hairline-v`) use `--border-subtle`.
  Full control and card outlines keep `--border`.
- **Shadows.** Popovers use `shadow-popover` in place of a mix of `shadow-md`,
  `shadow-lg` and `shadow-xl`; dialogs gain `shadow-dialog`. The primary-tinted
  hover glows on panel run buttons are removed.
- **Faint text.** Text at 35% and 45% foreground now uses
  `--foreground-tertiary` (50%).
- **Completed-run timestamp** (Part 1, item 6) shows `YYYY-MM-DD HH:MM UTC`
  via `formatIsoMinute`, with the full ISO value in the tooltip and `datetime`
  attribute. UTC rather than local time, to match the other dates in the
  results and keep runs comparable across machines.

- **Outlined buttons** (Part 1, item 3). In the Strategy view, `New`,
  `Robustness`, `Save`, `Library` and `Expand results` are quiet, as is `Stream`
  in the header. `Load history` and `Sign in` keep their outline as the key
  action of their bar. The `Editor`, `Results` and `Split view` buttons are one
  segmented control; choosing `Editor` or `Results` now also leaves split view.
- **Primary green** (Part 1, item 4). Active panel tabs and the pressed view
  segment use `--accent`, the same selected style as the interval and range
  pickers. The fill is left to the run action.

- **Chrome height** (Part 1, item 1), first step. In the Strategy view the
  save status, view switch and run status moved into the title row, and the
  completed-run context is one line. With a result open at 1440px the metrics
  start about 315px down instead of 390px. The title row wraps to two lines on
  narrower windows, which is the height it had before.
- **Indicators panel.** `New`, `Save`, `Save & run` and `Library` are quiet in
  dark mode. Light mode keeps its outlined ink style.
- **Panel top bar layout.** In overlay panels the `Library` button stretched
  across the bar and pushed the close button onto a second row. The bar is now
  a flex row with the context pill centred.

### Not migrated, and why

- **Local stacking and the select primitive.** `z-10`, `z-20`, `z-50` and
  small scoped `z-index` values order elements inside one component; they are
  not app layers.
- **Hardcoded radii, letter-spacing, line heights and odd font sizes** (15, 18,
  20, 22px and `rem` values). Not yet touched.
- **Other colour mixes.** One-off percentages (for example primary at 8, 12,
  18, 50, 60 and 80%) need a decision on which levels to keep.
- **Light-theme overrides.** About 70 `html:not(.dark)` rules restyle overlay
  panels for light mode and are pinned by tests. Folding them into tokens is a
  separate piece of work.
- **Spacing.** No token added; Tailwind's scale exists and scoped CSS uses raw
  pixels.

### Visual coverage

Opened with mocked data and no backend, so sweep, options and portfolio showed
their error or empty states: chart, strategy (editor, results, split), options,
sweep, portfolio, docs, robustness, the indicators and analytics panels. Not
checked: populated sweep, options and portfolio results, forced colours, and
200% zoom.

### Next

- Chrome height, remaining steps: the embedded backtest header and the data
  context row. Both need a product decision (what the header must always state,
  and whether the data row may collapse outside the chart view).
- The remaining uppercase labels from item 2.
- The action-colour decision (lime or neutral), then the palette retune.
- Update `FRONTEND_DESIGN.md` to describe the tokens.
