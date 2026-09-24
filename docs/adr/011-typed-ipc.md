# ADR 011 — One typed contract between Rust and the webview, generated from Rust

**Status:** Accepted, 2026-09-24. Implemented by M1a-10, after a spike on three commands.

## Context

Measured on `main`:

- **42 commands** are called as `invoke('command_name', { args })`: command names and argument
  names are strings, and the result type is whatever the call site claims. Most go through
  `stores/db.ts`, but four more files call `invoke` directly.
- **7 Rust structs** (`Source`, `ScoredChunk`, `Annotation`, …) are **mirrored by hand** as TS
  interfaces. A field added in Rust compiles cleanly on both sides and arrives as `undefined`.
- **Errors are strings:** 68 `map_err(|e| e.to_string())`. The interface can't tell "permission
  denied" from "not found" from "database locked" except by matching text. That works against
  docs/ux.md principle 3 ("say what happened").
- The planned fake backend (M1a-1) would be a **third** hand-kept copy of the same contract.

Every new feature crosses this boundary. It should be checked by the compiler, not by a user
hitting the bug.

## Decision

- **Generate the contract from Rust** with `tauri-specta` + `specta` + `specta-typescript`.
  Each command gets `#[specta::specta]`, and each type crossing IPC derives `specta::Type`.
  Debug builds export `src/lib/ipc/bindings.ts`: typed `commands.*` functions and the types.
- **Pin exact versions.** tauri-specta for Tauri 2 is still a release candidate
  (`2.0.0-rc.25`, about 1.3M downloads). Erti already pins `ort` the same way.
- **One way to call Rust.** The frontend imports `commands` from `lib/ipc`. An ESLint
  `no-restricted-imports` rule forbids `invoke` from `@tauri-apps/api/core` outside `lib/ipc`.
  `stores/db.ts` becomes thin re-exports, then disappears as call sites move.
- **Typed errors.** Commands return `Result<T, AppError>`, where `AppError { kind, message }`
  and `kind` is one of `NotFound`, `PermissionDenied`, `InvalidInput`, `Conflict`, `Io`,
  `Database`, `Model`, `Network` and `Internal`. `fs_errors.rs` supplies the human message for
  file errors, as today. The UI branches on `kind`, never on text.
- **Drift is a CI failure.** CI regenerates the bindings and fails on any difference
  (`git diff --exit-code`).
- **The fake backend implements the generated types** (M1a-1), so a harness that disagrees with
  Rust fails to type-check.

## Alternatives

- **A hand-written contract map plus a drift test** that compares command names with
  `generate_handler!`. No dependency, but argument and result types stay mirrored by hand,
  which is where the real bugs are.
- **`ts-rs`.** It generates the types but not the commands, so names and arguments stay strings.
- **Leave it.** Every feature in the plan adds commands; the cost grows with each one.

## Spike and implementation result (2026-09-24)

The spike worked on Tauri 2.11.5 with tauri-specta, specta 2.0.0-rc.25 and specta-typescript
0.0.12, exact-pinned. `collect_commands!` expands to Tauri's own `generate_handler!`, so runtime
dispatch is unchanged. What the implementation learned:

- **64-bit integers.** specta-typescript 0.0.12 refuses `i64`/`u64`/`usize` (precision) and has
  no global switch. Each such field says `#[specta(type = Number)]`: an explicit, reviewable
  claim that it fits. Command parameters and counts became `u32`.
- **Floats** are `number | null`, because JSON writes NaN as null. `db.ts` narrows `similarity`
  with the reason stated.
- **Results.** Generated commands resolve to `{ status, data | error }`. `call()` and `run()` in
  `lib/ipc` turn that back into a value or an `IpcError` with its `kind`.
- **A bug only the running app showed.** The first version relabelled a missing file as
  `Database` on its way out of a command. Each piece was correct, but the path through the
  command wasn't. `Classify` now applies only to errors that have no kind yet (strings, task
  panics), so relabelling is a compile error. `tests/ipc_errors.rs` goes through the commands,
  and a probe in the built app confirmed `NotFound`, `Conflict` and `InvalidInput` arrive intact.

## Consequences

- New dependencies: `specta`, `tauri-specta`, `specta-typescript` (build and dev time, MIT),
  exact-pinned. If a Tauri upgrade ever breaks them, `bindings.ts` is plain TS that can be
  frozen and kept by hand. There's an exit, just not a free one.
- Every command's error type changes, which touches all 42. It's mechanical, and done in one
  item, not spread across features.
- The recipe "Add a backend command" (docs/architecture.md) loses its hand-written step.
