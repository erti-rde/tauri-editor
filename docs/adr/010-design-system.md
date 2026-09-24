# ADR 010 — Erti's design system: one token source, a primitive layer, a catalogue

**Status:** Accepted, 2026-09-24. Implemented by milestone M1c.

## Context

Erti has half a design system. Measured on `main`, 2026-09-24:

**The token layer is strong.** Semantic colour tokens across seven palettes, a contrast test
(189 assertions), density (`--row-height`, `--gap`), `--ui-size`, `--page-font`, `--radius`,
and one global focus ring. **Not one raw colour class** anywhere in `src`.

**The component layer is missing.**

| Measure                                                                           | Count                                                 |
| --------------------------------------------------------------------------------- | ----------------------------------------------------- |
| Hand-styled `<button>` outside `src/lib/ui`                                       | 101, in 34 components                                 |
| Raw `<input>`                                                                     | 26                                                    |
| `hover:bg-surface-hover` typed out by hand                                        | 55                                                    |
| Radius variants in use (`rounded`, `-sm`, `-md`, `-lg`, `-xl`, `-full`, `[12px]`) | 7, against 2 tokens (`--radius`, `--radius-lg`)       |
| Shadows (`shadow`, `-sm`, `-md`, `-lg`)                                           | 27, in an app whose look is "thin rules, not shadows" |
| `text-[11px]` / `text-[10px]` hard-coded                                          | 45; there is no type scale                            |
| Shared primitives in `src/lib/ui`                                                 | 4 (Dropdown, Tooltip, Select, DateField)              |

`global.css` also carries a **second token set** left from the bits-ui starter template
(`--shadow-card`, `--radius-card: 16px`, `--dark-10`, …) in raw `rgba` that no palette
controls. All of it is dead except `shadow-popover`, used twice.

1.0 adds about a dozen surfaces (docs/ux.md UX-1 to UX-12). Built the way the current ones
were, each would invent its own button, panel header and empty state, and the look would drift
further with every milestone.

## Decision

**1. One token source.** `tokens.css` + `palettes.css`. The template block in `global.css` is
deleted, and its two live uses move to the overlay elevation token. Added tokens:

| Kind      | Tokens                                                                                                                                                                                                                                                                        |
| --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Type      | `--text-caption` (ui−2), `--text-small` (ui−1), `--text-body` (= `--ui-size`), `--text-title` (ui+2), `--text-heading` (ui+5), `--text-display` (ui+11), all derived from `--ui-size` so the interface-size setting scales them together. The manuscript keeps `--page-size`. |
| Elevation | Two levels only. **Flat** (rules, no shadow) for everything in the layout. **Overlay** (`--shadow-overlay`, already palette-aware) for menus, popovers, dialogs and toasts.                                                                                                   |
| Radius    | `--radius` (4px) for controls, rows and cards; `--radius-lg` (6px) for dialogs and overlays; `full` only for switches, chips and dots.                                                                                                                                        |
| Motion    | `--duration-fast` (120ms), `--duration` (180ms), one easing. `prefers-reduced-motion` sets both to 0. Nothing that appears unasked animates (docs/ux.md principle 1).                                                                                                         |

They are exposed to Tailwind through `@theme` (`text-caption`, `shadow-overlay`, …), so
components use names, not numbers.

**2. A primitive layer in `src/lib/ui`, built on bits-ui**, styled only with tokens. Each
primitive owns its states: hover, focus, active, disabled, loading, and error.

- **Actions:** `Button` (primary · secondary · ghost · danger; sm · md; loading), `IconButton`
  (a label is **required**: it becomes the tooltip and the accessible name, as the toolbar
  already does), `Menu` (items with description, separator, danger item).
- **Inputs:** `TextField` (label, hint, error), `TextArea`, `SearchField`, `Select`, `Switch`,
  `Checkbox`, `RadioGroup`, `DateField`.
- **Containers:** `Dialog`, `ConfirmDialog` (title, what it touches, one danger action),
  `Popover`, `Tabs`, `Panel` + `PanelHeader` (the rail panels), `Sidebar` (the right-hand detail
  sidebar).
- **Feedback:** `Toast` (existing, aligned), `Banner` (info · warning · danger · success, with
  optional action), `EmptyState` (message, optional action; one per situation, principle 3),
  `Loader` (existing), `ProgressLine`.
- **Content:** `Item` (the list row every panel shows: meta line, body, optional quote, actions).
  It's shared by Notes, source notes, the companion, attribution findings and citation results.
  Also `LabelChip` (colour dot **with** its name, never the dot alone), `Chip` and `Kbd`.

Variants use a 20-line local helper (`src/lib/ui/variants.ts`), not a new dependency.

**3. A catalogue.** A test-only route renders every primitive in every state. The
app-in-browser harness (M1a-1) screenshots it in all seven palettes × two densities, and a
**rendered-contrast** check measures the text/background pairs primitives actually produce. That
closes the gap plan.md Phase 6 left open: "the contrast test covers the tokens, not the
combinations a component actually uses".

**4. A ratchet, not a big-bang migration.** A vitest guard counts, per file outside
`src/lib/ui`: raw `<button>`/`<input>`, `text-[Npx]`, off-token radii and non-overlay shadows.

- A file may never go **above** its recorded baseline.
- **New files start at zero.**
- Every 1.0 item that touches a surface migrates that surface.
- M6-8 sweeps what's left, and ends with the baseline empty or with each remaining line
  justified.

## Alternatives

- **Adopt shadcn-svelte via its CLI.** Its components are bits-ui wrappers, which is what Erti
  already uses underneath. But its visual defaults (large radii, card shadows, zinc neutrals)
  are exactly what Erti's look rejects, and it brings `tailwind-variants` + `tailwind-merge`.
  Its component APIs are worth copying where they fit; its styling isn't.
- **Only document conventions, no primitives.** That's what produced 101 hand-styled buttons.
- **Migrate everything first.** It freezes feature work for weeks. The ratchet gets there by
  riding along with work that touches each surface anyway.

## Consequences

- New UI in any 1.0 item is assembled from primitives. A needed primitive that doesn't exist
  yet is added to `src/lib/ui`, with a catalogue entry, in the same PR or before it.
- The mockups (docs/ux/mockups.html) are the reference look. Primitives reproduce their
  proportions using tokens, not the mockups' pixel values.
- Font sizes shift slightly where `text-sm` (14px) becomes `text-body` (13px). That's
  intended: one scale.
- `docs/design-system.md` is the usage guide. The catalogue is the living reference.
