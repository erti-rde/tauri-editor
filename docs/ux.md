# Erti 1.0 — Interaction design

Where every new 1.0 surface lives, how it behaves, and what it says. The mockups in
[ux/mockups.html](ux/mockups.html) draw these screens in Erti's own tokens. This file is the
spec: acceptance criteria in `docs/specs/` cite its sections (`UX-n`).

Grounded in the app as it is: a left rail (Files, Outline, Notes, Sources; Settings at the foot),
side panels of 256–288 px, Sources and the reader taking over the workspace, tabs and a split
view, the manuscript as the one bright surface, thin rules instead of shadows.

## Principles

These carry over from what the app already does, and every new surface is checked against them.

1. **Quiet by default.** Nothing new speaks unasked except the note nudge, which already exists.
   Nothing takes focus, animates in, or opens without a click.
2. **State the fact, not a verdict about the person.** "This sentence matches Smith 2020, p. 12,
   and has no citation nearby", never "possible plagiarism". No scores and no percentages.
3. **Say what happened.** Empty, failed and done are three different messages, and none of them
   is a blank panel.
4. **Colour is never the only channel.** Labels travel with their names, and findings carry their
   kind in words.
5. **Everything is reversible or asks first.** Restores snapshot first. Removals say what they
   touch. Imports preview before they commit.
6. **One place per job.** No feature appears in two panels with two behaviours.

## Map of the app after 1.0

| Place        | Today                                               | 1.0 adds                                                                                                  |
| ------------ | --------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| Rail         | Files, Outline, Notes, Sources                      | **Check** (UX-7), between Notes and Sources                                                               |
| Notes panel  | Search, follow-the-writing, marks                   | Follows with **notes and passages** (UX-5); source notes appear here too                                  |
| Sources view | Table, attention banner, edit sidebar               | **Add ▾** (UX-2), no-file rows, detail sidebar with **Details · Notes · File** tabs (UX-3), remove (UX-4) |
| Toolbar      | Print-to-PDF button, `.tex` button                  | One **Export ▾** menu: PDF, Word, LaTeX, and Check first (UX-8)                                           |
| Document bar | Tabs, "+ New"                                       | A **⋯ menu** per document: Rename, Duplicate, History…, Delete (UX-9)                                     |
| Editor       | Citations, nudge                                    | **Find & replace** bar (UX-11); citations not in your library (UX-12)                                     |
| Settings     | General, Citations, Reading, Page setup, Appearance | **Library** (location, backups) and **About** (UX-10)                                                     |
| First run    | Lookup consent                                      | Consent for lookups **and** update checks, then a **bundled style** choice (UX-1)                         |

## UX-1 First run

1. **Two questions, asked once, on one card.** "Look up citation details online?" as today, and
   "Check for new versions of Erti?" ("sends the version number you have to GitHub once a day").
   Each has its own switch, both are off by default, and the card lists the exact hosts.
   "Continue" works with both off.
2. **Choose a citation style**, from the styles that ship with Erti: APA 7, Chicago
   author-date, Chicago notes and bibliography, Harvard (Cite Them Right), IEEE, MLA 9 and
   Vancouver. APA is preselected. "More styles are available in Settings once lookups are on"
   appears only if lookups are off. **No network is needed to start writing.**
3. The landing screen follows, as today.

States: if a bundled style fails to load (corrupt install), say so and fall back to APA. The
editor never waits on a style (M0 fix).

## UX-2 Adding a source

**Sources header → Add ▾**:

- **Enter details…** opens the right sidebar in _create_ mode. **Type first** (Book, Book
  section, Journal article, Web page, Report, Thesis, and the rest from the Zotero schema), then
  the fields that type needs, with required ones marked. It saves as a no-file source.
- **From a DOI…** is a single field. It resolves via doi.org if lookups are on; otherwise it
  explains that lookups are off and offers "Enter details" instead, prefilled with the DOI.
- **Import a bibliography…** opens the file picker (`.bib`, `.ris`, `.json`), then the import
  preview (UX-6).

No-file sources sit in the same table. The **File** column says "No file" in muted ink with an
**Attach PDF…** action on hover and focus. Attaching runs normal ingest, and the row's state
follows the existing pending → ready flow.

## UX-3 A source's detail sidebar

Selecting a row opens the sidebar (today it's "Edit Source"). It now has three tabs:

- **Details**: the existing field editor, fixed to show the type and fields for sources ingested
  before `zotero_type` existed.
- **Notes (n)**: this source's notes and highlights together, in page order. Notes are listed
  first, then marks by page. **New note** opens an inline form:
  - **Note** (multi-line, Markdown)
  - **Quote** (optional): "the exact words, if you're copying from the source"
  - **Page** (optional, as printed): "853", "xiv"
  - **Label** (the eight labels)

  Save with ⌘↩. A note with a quote shows it in the serif, set off like a block quote. **Cite
  with this page** is on every note that has a page.

- **File**: attached PDF(s) with **Open**, **Show in folder** and **Attach another** (a
  preprint and its published version), or "No file" with **Attach PDF…**. It shows where the
  PDF lives, or "file not found" when it has moved.

The sidebar footer holds **Remove from library…** (UX-4).

## UX-4 Removing a source

A dialog, not a menu item that acts immediately:

> **Remove "Attention Is All You Need" from your library?**
> Cited 4 times in _Chapter 1_ and _Chapter 3_ in this project. Those citations will show
> "not in your library" until you add it again. 2 notes and 11 highlights will be deleted.
> The PDF itself stays where it is.
> [Cancel] [Remove]

If nothing cites it, the first sentence is omitted. **Remove** is the danger colour. After
removing: "Removed. Restore from last night's library backup in Settings › Library."

## UX-5 The writing companion (Notes panel)

This extends the existing panel rather than adding one.

- The awkward checkbox label ("Show notes about the paragraph I'm in", which wraps) becomes a
  header toggle: **Follow my writing** (on/off), with the paragraph's first words shown as
  context: "Related to: _Sequence models built on…_".
- While following, two groups with counts:
  - **Your notes (n)**: highlights, page notes and source notes, as today's cards.
  - **From your papers (n)**: passages from ingested PDFs, one line of source and page, the
    passage in two lines, **Show in PDF** and **Cite**.
- Updates when the cursor leaves a paragraph or after a pause, never while typing. A result
  already cited in this paragraph is marked "cited here" and sinks to the bottom.
- Typing in the search box takes over, as today. Clearing it returns to following.
- Empty states: "No notes on this project's sources yet: highlight in a PDF or add a note to a
  source" versus "Nothing in your notes or papers is close to this paragraph". Different words,
  because they're different situations.
- The margin nudge covers source notes too, still one ring per paragraph at most.

## UX-6 Import preview

A dialog after the file is chosen, **before anything is written**:

> **Import `library.bib`**
> 412 entries · **380 new** · **32 already in your library** (matched by DOI or title) ·
> **12 with a PDF** that will be attached · **3 PDFs not found** (listed)
> ☐ Also add them to this project
> [Cancel] [Import 380]

Unparseable entries are listed by key with the reason. During import, a progress line: "Importing
214 of 380…". The result is a toast plus the Sources table filtered to "Imported just now", with
a clear-filter chip.

## UX-7 Check attribution (rail → Check)

A side panel, so the writing stays visible.

- **Header:** "Check attribution" and **Run check**, with the scope beneath: "142 sentences
  checked against 23 sources in your library and 2 other documents in this project". **Never a
  percentage, never "no problems found".** With nothing to report: "Nothing to review in the
  sentences checked. This only covers sources in your library."
- **Findings, grouped by what they are, each group titled in words:**
  - **Matches a source, no citation nearby**
  - **Quoted, but the words differ from the source** (drifted quotation)
  - **Cited to one source, matches another**
  - **Reused from another document in this project**
- **Each finding:** the manuscript sentence (two lines), the source with its page, and actions.
  Selecting a finding scrolls the editor to the sentence, gives _that sentence only_ a quiet
  underline, and opens the source in the split pane at the matched page with the passage marked.
- **Actions** (the right ones per kind): **Quote and cite** (pinpoint from the match),
  **Cite**, **Make a block quote**, **Show source**, **Dismiss**. Dismissed findings go to a
  collapsed "Dismissed (n)" group, where they can be restored.
- **Stale:** after edits, "The document has changed since this check · Run again". Old findings
  stay visible, dimmed.
- It runs only when asked, and never automatically on a document opened from someone else.

## UX-8 Export

The toolbar's PDF and `.tex` buttons become one **Export ▾** button:

- **Check attribution first…** (at the top, with a small dot if the document changed since the
  last check)
- ——
- **PDF…** (print dialog, or direct save where print falls short, M5)
- **Word document (.docx)…**
- **LaTeX bundle…** (compiles if TeX is installed, as today)

Each asks where to save and ends with a toast holding **Show in folder**.

## UX-9 Document menu and history

**⋯** beside the active document's tab in the document bar: **Rename…**, **Duplicate**,
**History…**, ——, **Delete…** (deleting keeps its history and says so).

**History** takes over the workspace, as Sources does:

- **Left:** snapshots grouped by day, each with a time, a word delta ("+312 words", "−1,204
  words") and what triggered it ("while writing", "before restore", "on close").
- **Right:** a read-only preview of the selected snapshot in the manuscript serif.
- **Restore this version** snapshots the current state first, then says so: "Restored. Your
  previous version is saved as a snapshot."
- **Footer:** "History uses 4.2 MB · Clear snapshots older than 3 months".

## UX-10 Settings: Library and About

**Library** (new tab):

- Library location, with **Move library…** (moves the file, then reopens)
- Backups: "Last backup: today 09:12 · 7 daily, 4 weekly kept", **Back up now**, **Restore from
  a backup…** (with confirmation, keeping the replaced library)
- **Open backup folder**

**About** (new tab):

- Erti _version_, AGPL-3.0, **source code** link, **third-party notices**, and the model and
  its licence
- **Check for new versions** (the same consent as UX-1) with **Check now**
- **Open log folder**, for attaching to a bug report; nothing is sent

## UX-11 Find & replace

⌘F opens a slim bar pinned to the top of the manuscript: a find field, match count ("3 of 12"),
previous/next, and an options menu (match case, whole word). ⌘⌥F adds the replace field with
**Replace** and **Replace all**. Matches are highlighted in the editor. Text inside a citation is
never matched or replaced. Replace all is one undo step. Esc closes it.

## UX-12 Citations whose source isn't in your library

Citations render from the manuscript's embedded sources (ADR 002) with a dotted underline.
Hovering shows "From the manuscript: not in your library" with **Add to library**. In the
bibliography, those entries render normally. Nothing is marked as an error.

## Copy

- Buttons say what happens: "Import 380", "Remove", "Restore this version", "Run check".
- Errors say what went wrong and what to do: "Couldn't read `library.bib`: line 214 isn't a
  BibTeX entry. The other 411 can still be imported."
- British spelling in the UI (the codebase and README use it: "colour", "licence").
- English only for 1.0, with UI strings kept in one module per surface so translation is
  possible later (decision in plan-v1.md §6).
