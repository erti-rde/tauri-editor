# ADR 002 — A versioned manuscript envelope that carries its sources

**Status:** Accepted, 2026-09-24, **amended the same day** (see Amendment: the envelope shape below
would destroy manuscripts opened by any Erti already installed). **Must land before 1.0 (M1a).**

## Context

A manuscript is saved as bare `JSON.stringify(editor.getJSON())` (`Editor.svelte`). Two
consequences:

1. **No version.** Every file written after 1.0 is a format Erti has to read forever, and there is
   no field to branch on when the schema changes. Today is the last cheap moment to add one.
2. **Citations don't travel.** A citation node stores only source ids (`["<sha256>"]`). Rendering
   looks those ids up in _this machine's_ library. A co-author without the same PDFs sees
   `[source removed]` for every citation. Manuscripts are explicitly meant to move between people
   (plan.md, the stored-XSS fix). With no-file sources (ADR 003) it gets worse: their
   `erti:<uuid>` ids exist in exactly one library.

## Decision

The saved file becomes an envelope:

```json
{
	"format": "erti-manuscript",
	"version": 1,
	"doc": { "type": "doc", "content": [] },
	"sources": { "<source id>": { "…CSL-JSON…": "" } },
	"savedWith": "1.0.0"
}
```

- `sources` holds a CSL-JSON snapshot of **every source cited in the document**, rewritten on
  each save. It's what Zotero's Word plugin does with field codes, for the same reason.
- **Reading:** a bare ProseMirror doc (anything with `type: "doc"` at the root) is read as
  version 0 and upgraded in memory; it's written back as an envelope on the next save. A
  `version` higher than the build knows is **refused with a message**, never guessed at. That's
  the same rule the library applies to a newer schema.
- **Rendering:** a cited id missing from the local library renders from the envelope's snapshot
  and is marked "not in your library" (with an action to add it), instead of `[source removed]`.
  The local library wins when both exist.
- The envelope is **untrusted input.** CSL-JSON from it is validated (shape and types) before it
  reaches citeproc, and rendered output keeps going through `citations/sanitize.ts`.

## Alternatives

- **Keep bare JSON; send a `.bib` alongside.** Two files that drift apart, and the co-author has
  to import by hand before anything renders.
- **Embed only on export.** Doesn't help the co-author who opens the working file, which is the
  case that happens.
- **A zip container (`.erti` with doc + assets).** Needed eventually for embedded images, but it
  costs diffability and simple sync. Not needed for 1.0, and `version` leaves room to move later.

## Consequences

- Upgrade logic lives in one pure module (`manuscript/format.ts`) with a test per version.
- Files grow by a few KB per cited work. That's negligible next to the doc.
- Every save rewrites `sources`, so a correction to a source's metadata reaches the file on the
  next save.
- Autosave, LaTeX/DOCX export, the outline and the document list must all read through the same
  loader. A second parser would be the drift this ADR exists to prevent.

## Amendment (2026-09-24): the document stays at the root

Found in adversarial review, and reproduced against the TipTap version in the lockfile. The
envelope as specified above (`{ format, version, doc, sources }`) has no `type: "doc"` at its
root. Every Erti already installed (0.2.x, and any 0.9 beta built before this lands) loads a
manuscript with `setContent(JSON.parse(file))`. Given the envelope, TipTap reports "Invalid
content" and falls back to treating the object as HTML. The editor shows nothing usable, and
**the next autosave writes that over the file.** A co-author one version behind would lose the
manuscript.

**The shape is therefore:**

```json
{
	"type": "doc",
	"content": [],
	"erti": { "format": 1, "sources": { "<source id>": {} }, "savedWith": "1.0.0" }
}
```

- ProseMirror's `Node.fromJSON` reads `type` and `content` and ignores other keys, so an older
  Erti opens the manuscript intact. Verified: content round-trips, and `erti` is dropped. On
  re-save it loses only the embedded sources, which the next 1.0 save rebuilds from any library
  that has them. Degradation, not loss.
- **Version:** no `erti` key means format 0. `erti.format` greater than the build knows is
  refused, as above.
- Everything else in this ADR stands: embedded CSL snapshots, rendering from them when the local
  library lacks a source, validation as untrusted input, and one loader for every reader.
- **Test:** a fixture written by 1.0, loaded through the 0.2.5 code path
  (`createNodeFromContent` with the 0.2.5 schema), keeps every paragraph.
