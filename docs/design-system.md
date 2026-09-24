# Erti design system

How Erti's interface is put together: the tokens, the primitives, and the rules. The decision
and its reasoning are in [ADR 010](adr/010-design-system.md). The look it serves is described in
[ux.md](ux.md) and drawn in the [mockups](ux/mockups.html).

**The look in one line:** a code editor's chrome that recedes, with thin rules instead of
shadows and the manuscript as the one bright surface.

## Tokens

All of them are defined in `src/lib/theme/tokens.css` (sizes, radii, motion) and
`palettes.css` (colour, per palette), and exposed to Tailwind in `global.css` `@theme`. Use the
Tailwind names in components; never write a number or a colour.

**Colour: semantic roles only**

| Role        | Tokens                                                           | Use                                                                 |
| ----------- | ---------------------------------------------------------------- | ------------------------------------------------------------------- |
| Surfaces    | `surface`, `surface-raised`, `surface-sunken`, `surface-overlay` | Layout ground; inputs and cards; wells and rails; menus and dialogs |
| Interaction | `surface-hover`, `surface-active`, `selection`                   | Only through primitives                                             |
| Ink         | `ink`, `ink-muted`, `ink-faint`                                  | Text by importance; `ink-faint` never for anything required to read |
| Rules       | `line`, `line-strong`                                            | Dividers; control borders                                           |
| Accent      | `accent`, `accent-ink`, `accent-quiet`, `accent-hover`           | One primary action per view; the selected item                      |
| Status      | `danger`, `warning`, `success`                                   | Meaning, never decoration; always with words                        |
| Page        | `surface-page-themed`, `ink-page-themed`                         | The manuscript only                                                 |

**Type**

| Token          | Size (default `--ui-size` 13px) | Use                                                  |
| -------------- | ------------------------------- | ---------------------------------------------------- |
| `text-caption` | 11px                            | Meta lines, counts, group labels (uppercase +0.04em) |
| `text-small`   | 12px                            | Secondary text, menu descriptions, table cells       |
| `text-body`    | 13px                            | Default interface text                               |
| `text-title`   | 15px                            | Panel and dialog titles                              |
| `text-heading` | 18px                            | Settings sections, History headers                   |
| `text-display` | 24px                            | Landing only                                         |

The interface font is the system UI stack. The manuscript is `--page-font` (Iowan Old Style →
Palatino → Georgia), and quotes from sources are set in it too, so quoted words look like the
page they came from. Numbers that line up use `tabular-nums`.

**Space, radius, elevation, motion**

- Space: Tailwind's 4px scale. Rows use `--row-height`, and gaps use `--gap`. Both follow
  **density**.
- Radius: `rounded` (4px) for controls, rows and cards; `rounded-lg` (6px) for dialogs and
  overlays; `rounded-full` only for switches, chips and dots.
- Elevation: **flat** everywhere in the layout. `shadow-overlay` only on menus, popovers,
  dialogs and toasts.
- Motion: `duration-fast` for hover and press, `duration` for overlays opening. Zero under
  reduced motion. Anything that appears unasked doesn't animate.

## Primitives (`src/lib/ui`)

| Need                               | Use                                    | Notes                                                                                    |
| ---------------------------------- | -------------------------------------- | ---------------------------------------------------------------------------------------- |
| An action with words               | `Button`                               | `primary` once per view · `secondary` · `ghost` · `danger`; `sm`/`md`; `loading`         |
| An action with an icon             | `IconButton`                           | `label` required: tooltip + accessible name                                              |
| A list of actions                  | `Menu`                                 | Items can carry a one-line description; `danger` item sits last, after a separator       |
| Text in                            | `TextField`, `TextArea`, `SearchField` | Label, hint and error built in; the error says how to fix it                             |
| One of a few                       | `RadioGroup`                           | Arrow keys; the Appearance settings pattern                                              |
| One of many                        | `Select`                               |                                                                                          |
| On/off                             | `Switch`                               | Takes effect at once; `Checkbox` is for choices submitted together                       |
| A date                             | `DateField`                            |                                                                                          |
| A decision                         | `Dialog`, `ConfirmDialog`              | ConfirmDialog states what the action touches; the action button says the verb ("Remove") |
| Extra detail on demand             | `Popover`, `Tooltip`                   | A tooltip never holds the only copy of information                                       |
| Sections of one surface            | `Tabs`                                 |                                                                                          |
| A rail panel                       | `Panel` + `PanelHeader`                | Header: title, one primary action, a scope line                                          |
| A right-hand detail view           | `Sidebar`                              | Close with Esc                                                                           |
| Something happened                 | `Toast`                                | Past tense, with an action if there's a next step ("Show in folder")                     |
| Something needs attention in place | `Banner`                               | `info`/`warning`/`danger`/`success`, in words, optionally one action                     |
| Nothing to show                    | `EmptyState`                           | Say which kind of nothing: none yet, none match, or failed                               |
| Working                            | `Loader`, `ProgressLine`               | ProgressLine when the count is known ("214 of 380")                                      |
| A row in any list                  | `Item`                                 | Meta line (`LabelChip` · source · page), body, optional quote, actions                   |
| A label                            | `LabelChip`                            | The dot **and** the name, always                                                         |

## Rules

1. Build new UI only from primitives. If one is missing, add it to `src/lib/ui` with a
   catalogue entry first.
2. No numbers in class names (`text-[11px]`, `rounded-[12px]`), no colours, and no shadows
   outside overlays. The ratchet test enforces this.
3. Every interactive thing is reachable by keyboard and has a visible focus: the global ring,
   drawn inside with `focus-inset` for elements flush with a pane edge.
4. Colour is never the only channel. State and kind are also in words or shape.
5. Copy follows ux.md: say what happens, state facts not verdicts, British spelling.

## The catalogue

A test-only route (see testing.md) shows every primitive in every state. CI screenshots it in
all seven palettes at both densities, and checks the contrast of the colour pairs primitives
really render. When you change a primitive, attach the relevant catalogue screenshots to the
PR.
