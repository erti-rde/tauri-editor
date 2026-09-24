# Erti 1.0 — Threat model

STRIDE over Erti's data flows, written 2026-09-24 against `main` plus the 1.0 designs in
`docs/adr/`. Re-read this whenever a new input format, network host, Tauri permission or
Rust command is added.

## What we protect

| Asset                                                 | Why it matters                                                    |
| ----------------------------------------------------- | ----------------------------------------------------------------- |
| The researcher's files, far beyond Erti's (`$HOME`)   | The webview can reach them; a compromise is not contained to Erti |
| Manuscripts and their history                         | Months of irreplaceable work                                      |
| `library.db`: notes, highlights, sources, corrections | Irreplaceable (ADR 008)                                           |
| The privacy promise: what leaves the machine          | The project's founding claim (README)                             |
| The update channel                                    | Whoever controls it runs code on every install                    |

## Trust boundaries

```
 untrusted content                     webview (JS)                        Rust core
 ──────────────────                    ────────────                        ─────────
 PDFs (anyone)            ──pdf.js──▶  reader, extractor   ──IPC cmds──▶   read_pdf_file(path), hash_file(path),
 manuscripts (co-authors) ──JSON────▶  editor, citeproc                    read_directory(path), db, ML, latex
 BibTeX/RIS/CSL (web)     ──parse───▶  import (M1)          fs plugin ──▶   $HOME read; writes only where scoped
 annotation sidecars      ──JSON────▶  notes
 CSL styles/locales (GH)  ──XML─────▶  citeproc
 doi.org / Crossref       ──JSON────▶  resolver
 updater manifest (GH)    ─────────────────────────────────────────────▶   tauri-plugin-updater (signature check)
```

**The load-bearing boundary is webview → Rust.** Every untrusted format is parsed in the
webview. Script execution in the webview currently means: read any file in `$HOME` (fs scope,
and `read_pdf_file` with no scope at all); write, rename or delete wherever the write scope
reaches (app directories and folders the user opened, not `$HOME` as a whole: see T3); and
send data out through the query string of any `connect-src` host. That's why the XSS fix in
Phase 4 mattered, and why the tasks below narrow what a compromise can reach instead of only
trying to prevent one.

## Threats

Risk = impact × likelihood, High / Medium / Low.

| #   | STRIDE | Threat                                                                                                     | Existing mitigation                                                                                                                                                    | Gap                                                                                                                                           | Risk     |
| --- | ------ | ---------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| T1  | E      | Script injection via a shared manuscript (citation HTML, new envelope `sources`)                           | DOMPurify allowlist on citation HTML (`sanitize.ts`); no other `{@html}`/`innerHTML`                                                                                   | Envelope CSL-JSON (ADR 002) is new input into citeproc; no shape validation yet                                                               | **High** |
| T2  | E / I  | After T1: read any file via `read_pdf_file(path)` / `hash_file` / `read_directory`                         | None; the commands accept any path                                                                                                                                     | Rust path commands ignore every scope                                                                                                         | **High** |
| T3  | T / D  | After T1: delete or overwrite files via the fs plugin                                                      | Tauri 2 scopes each permission separately. **Observed 2026-09-24:** writing and removing `~/.erti-scope-probe.txt` from inside the app were refused ("forbidden path") | `fs:write-all` still enables `remove` wherever the write scope reaches (app dirs, dialog-opened project folders), so a project can be damaged | Medium   |
| T4  | E      | Malicious PDF runs code in pdf.js (cf. CVE-2024-4367, font-based JS execution)                             | pdfjs-dist 4.9.155 is past the 4.2.67 fix                                                                                                                              | `isEvalSupported` not set to `false` (defence in depth); 2 majors behind (plan.md §9)                                                         | Medium   |
| T5  | I      | After T1: data leaves through the query string of an allowed host                                          | `connect-src` allowlist of 4 hosts (PR #109)                                                                                                                           | Can't be closed by CSP alone; T1–T3 are the real defence                                                                                      | Medium   |
| T6  | T      | Malicious update                                                                                           | Updater verifies minisign signatures against the embedded pubkey                                                                                                       | Key storage and rotation undocumented; release job uses tag-pinned actions with secrets                                                       | Medium   |
| T7  | T      | Build-time supply chain: npm/cargo deps; `ort` downloads ONNX Runtime binaries at build time               | Lockfiles; `--frozen-lockfile`; toolchain pinned                                                                                                                       | No `pnpm audit` / `cargo audit` in CI; ort download integrity unverified by us                                                                | Medium   |
| T8  | D      | Decompression/size bombs: huge PDFs, a 1M-entry `.bib`, a 50 MB manuscript, a deeply nested sidecar        | Ingest runs off the main thread; failures recorded per source                                                                                                          | No size or count limits on any input                                                                                                          | Medium   |
| T9  | I      | Unconsented network traffic (updater, future features, a dependency that phones home)                      | Consent gate on lookups; README enumeration; CSP allowlist                                                                                                             | Rust-side traffic (updater) is outside the CSP; no test pins Rust network use                                                                 | Medium   |
| T10 | T      | Sidecar / annotation import plants misleading marks as the user's own                                      | Imported marks are `origin = 'imported'` and removable in one action                                                                                                   | None for 1.0                                                                                                                                  | Low      |
| T11 | S      | A co-author's manuscript cites a source id that resolves to a different work in your library               | Content-addressed ids for PDFs                                                                                                                                         | `erti:` uuids are random, so collisions are negligible; envelope snapshot shows the author's metadata                                         | Low      |
| T12 | I      | SQL injection via search boxes                                                                             | sqlx parameters everywhere; LIKE wildcards escaped (tested)                                                                                                            | None                                                                                                                                          | Low      |
| T14 | E      | Imported or co-author metadata reaches a `.bib` compiled locally; shell escape if the user's TeX allows it | `escapeBibtex` escapes braces and backslashes; `latexmk`/`pdflatex` run with `-no-shell-escape`, `latexmk` with `-norc` (M1a-9); tectonic has it off                   | A TeX bug that escapes without shell escape                                                                                                   | Low      |
| T13 | E      | `shell:allow-open` opens attacker-chosen URLs/paths                                                        | Default shell scope limits `open` to URL schemes                                                                                                                       | The plugin is unused from JS (`opener` does the job); dead privilege                                                                          | Low      |

## 1.0 security tasks

Ordered by what they cut off. Each lands in the milestone that touches the area.

1. **Scope the Rust path commands (T2)** — M1a. `read_pdf_file`, `hash_file`, `read_directory`
   and `source_for_path` canonicalise the path and require it to be under the open project root
   or a location already recorded in `locations`. Paths chosen through the dialog are added to
   that allowlist. Test: `../`, symlinks out of the root, and absolute paths elsewhere are
   refused.
2. **Narrow the fs scope (T3)** — M1a. Replace `fs:write-all` + `fs:allow-home-read-recursive`
   with specific commands (no `remove` unless a feature needs it, and then via a Rust command
   that moves to the OS trash). Scope grows at runtime to the open project and the library
   directory through `FsExt::fs_scope()`. **Verified 2026-09-24** with a probe built into the
   app: writes and removes in `$HOME` are refused; the home scope is read-only. So this task
   drops from High to Medium: it's about keeping `remove` away from project folders, not about
   the whole home directory.
3. **Validate every untrusted format at the boundary (T1, T8)** — M1a (manuscript format), M1b (imports, sidecars), M5. One shape-guard module
   for the manuscript envelope, CSL-JSON (envelope + imports), annotation sidecars and parsed
   BibTeX/RIS. Unknown fields dropped, strings length-capped, arrays count-capped, nesting
   depth-capped. Each guard has a hostile-fixture test (script tags in titles, prototype keys like
   `__proto__`, 10⁶-entry arrays).
4. **Input limits (T8)** — M1b/M6. PDF > 200 MB, `.bib` > 20 MB or > 50k entries, manuscript >
   50 MB: refused with a message, not a hang. Exact numbers set from M6 measurements.
5. **pdf.js hardening (T4)** — M6. `isEvalSupported: false` on every `getDocument`; plan the
   pdfjs-dist upgrade (4.9 → current) with the golden extraction tests as the guard.
6. **Remove `tauri-plugin-shell` (T13)** — M0. It's unused from JS; `opener` covers opening
   links.
7. **Dependency audit in CI (T7)** — M7. `pnpm audit --prod` and `cargo audit` (RustSec) as a
   non-blocking job that becomes blocking before the tag. Actions pinned by SHA in the release
   workflow (`docs/release.md`).
8. **Rust network inventory (T9)** — M7. A test or build check listing every crate feature that
   enables HTTP (`reqwest` via the updater) so a new one is a reviewed change. The updater sits
   behind consent (`docs/release.md`).
9. **Updater key custody (T6)** — M7. Keypair generated offline, private key + password in repo
   secrets and in the maintainer's password manager. Rotation procedure written down before 1.0,
   because rotating means shipping a release signed by the old key that carries the new pubkey.
10. **Re-run this model** — M6, against the finished 1.0 surface.
11. **Compile LaTeX with `-no-shell-escape` explicitly (T14)** — done in M1a-9, which also
    passes `-norc` to `latexmk`, so a `latexmkrc` (Perl) in a shared project folder isn't run.
    Was: `compile_latex` ran `latexmk`/`pdflatex` with no shell-escape flag. TeX Live's default (restricted) and escaped
    `.bib` fields make it safe today, but imports and co-authors' manuscripts now feed
    third-party metadata into files Erti compiles on the user's machine. Safety shouldn't depend
    on each user's TeX configuration.

## Out of scope for 1.0

An attacker with local access to the user's account (they can already read everything); a
compromised OS; encryption of the library at rest (the OS's disk encryption is the right layer,
and the README should say so).
