# M1c — Design system

Refs throughout: [ADR 010](../adr/010-design-system.md), [design-system.md](../design-system.md).
Runs after M1a-1 (the harness renders the catalogue) and **before any new UI**. M1b's backend
items (M1b-1 to M1b-3) can proceed alongside it.

### M1c-1 One token source

Depends on: —

- AC-1 The bits-ui starter block in `global.css` is removed (the `--shadow-*`, `--radius-card*`,
  `--dark-*` and `--border-*` template tokens). Its two live uses (`shadow-popover`) move to
  `shadow-overlay`.
- AC-2 Type tokens `caption`, `small`, `body`, `title`, `heading` and `display` are derived from
  `--ui-size` and exposed as `text-*`. Changing the interface size in Appearance scales all of
  them (test).
- AC-3 Motion tokens, zeroed under `prefers-reduced-motion` (test on the computed value).
- AC-4 The contrast test still passes for all seven palettes; nothing visible changes except
  the two popovers' shadow.

### M1c-2 Actions and inputs

Depends on: M1c-1

- AC-1 `Button`, `IconButton`, `Menu`, `TextField`, `TextArea`, `SearchField`, `Switch`,
  `Checkbox` and `RadioGroup` are added. `Select`, `DateField` and `Dropdown` are restyled to
  tokens and folded in (`Dropdown` becomes `Menu`).
- AC-2 `IconButton` without a `label` is a type error.
- AC-3 Each primitive has a component test for keyboard use, disabled state and its accessible
  name.
- AC-4 `variants.ts` has no dependencies.

### M1c-3 Containers and feedback

Depends on: M1c-1

- AC-1 `Dialog`, `ConfirmDialog`, `Popover`, `Tabs`, `Panel`, `PanelHeader`, `Sidebar`, `Banner`,
  `EmptyState` and `ProgressLine` are added. `Toast` and `Loader` are aligned to tokens.
- AC-2 `Dialog` traps focus, closes on Esc and returns focus. `ConfirmDialog` requires a verb
  label and a consequences slot.
- AC-3 Settings' dialog and tabs move onto these without behaviour change; the existing
  Settings tests pass unchanged.

### M1c-4 Content pieces

Depends on: M1c-1

- AC-1 `Item`, `LabelChip`, `Chip` and `Kbd` are added.
- AC-2 The Notes panel's result cards and the citation `ResultCard` both render through `Item`,
  and their existing tests pass.
- AC-3 `LabelChip` always renders the name (a test asserts the text is present in every
  palette).

### M1c-5 Catalogue and rendered contrast

Depends on: M1c-2, M1c-3, M1c-4, M1a-1

- AC-1 A test-only route shows every primitive in every state (rest, hover, focus, active,
  disabled, loading, error), excluded from production builds.
- AC-2 The harness screenshots it in 7 palettes × 2 densities in CI, uploaded as an artefact.
- AC-3 A rendered-contrast check computes the text/background pair of each primitive state,
  and fails below WCAG AA (4.5:1 text, 3:1 large text and UI boundaries).

### M1c-6 Ratchet and guide

Depends on: M1c-2

- AC-1 A vitest guard counts, per file outside `src/lib/ui`: raw `<button>`, raw `<input>`,
  `text-[Npx]`, off-token radii (`rounded-md|lg|xl|[…]` where not allowed) and shadows outside
  overlays.
- AC-2 `design-system-baseline.json` records today's counts. A file above its baseline fails,
  and **a file not in the baseline must be at zero**.
- AC-3 When counts drop, the test prints the new numbers to record. Lowering the baseline is
  part of any PR that migrates a surface.
- AC-4 `docs/design-system.md` matches what shipped.

**M1c Verify:** the catalogue screenshots for every palette are attached to the PR; the
rendered-contrast check passes; the ratchet is running in CI.
