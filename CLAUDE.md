# Working on Erti

Read this first in every session. The maintainer hands work off and merges; they shouldn't need
to watch it happen.

## Where things are

- **What to build:** [plan-v1.md](plan-v1.md). The route to 1.0: criteria, milestones, risks and
  the decisions table (§6).
- **What done means:** [docs/specs/](docs/specs/README.md). Every plan item has an ID
  (`M1a-4`), acceptance criteria and a Verify.
- **Why it's built this way:** [docs/adr/](docs/adr/README.md). Supersede with a new ADR; don't
  edit an accepted one, except to append an amendment before it's implemented.
- **How it should look and read:** [docs/ux.md](docs/ux.md), and the mockups in
  [docs/ux/mockups.html](docs/ux/mockups.html) (published privately at
  https://claude.ai/artifact/5zy4rbSw5DZ7fEmYAiUKAN).
- **Security, testing and release:** [docs/security.md](docs/security.md),
  [docs/testing.md](docs/testing.md), [docs/release.md](docs/release.md).
- **How the code fits together, and recipes for common changes:** [docs/architecture.md](docs/architecture.md). Read the recipe before adding a command, migration, setting, panel or network host.
- **History:** [plan.md](plan.md), the hardening record from before 1.0 planning.

## Picking up work

1. `git fetch`, then check open PRs (`gh pr list`). Don't start work that an open PR already
   covers.
2. Take the **first unticked item** in plan-v1.md §3 whose dependencies (spec "Depends on") are
   merged. Its GitHub issue carries the same ID.
3. Branch from `main`: `<type>/<ID>-<slug>`, e.g. `feat/M1a-8-manuscript-format`.
4. Write the tests for the acceptance criteria first. They name the criterion: `// M1a-8 AC-5`.
5. Build, then run everything CI runs: `pnpm verify`.
6. Produce the item's **Verify** evidence (see "Seeing the app" below).
7. Check `git diff --stat origin/main...HEAD` lists only files the item meant to touch. A
   squash built on a stale tree once reverted a merged Dependabot bump without a trace in the
   PR's description (#195, restored by the next PR).
8. Open a PR titled `<ID>: <what it does>`, whose body has:
   - a checklist of every AC, ticked, each with where it's proven (test name, run link, or
     screenshot);
   - anything left unverified, stated plainly;
   - `Closes #<issue>`.
9. **Open the PR only when the branch is complete.** The maintainer may merge the moment it
   appears, and twice a PR merged with only its first commit while follow-ups were still being
   pushed (#107, #110). If something must change after opening, push it and say so in a PR
   comment, then check the merged result with `git cherry origin/main <branch>`.
10. **The maintainer merges.** Never merge, force-push to `main`, or enable auto-merge. When a
    PR merges, tick the item in plan-v1.md in the next PR (not in its own PR). PRs are
    rebase-merged, so hashes change: refer to PR numbers, never commit hashes.

One item per PR, unless two items can't be separated. Small, reviewable, self-verifying.

## Stop and ask when

- A spike fails, or an AC turns out wrong or impossible. Changing an AC is a plan change.
- The work needs the maintainer's identity or secrets: signing keys and certificates, the
  SignPath application, repository secrets, recruiting beta testers. Prepare everything else,
  then hand over the exact steps.
- Something would add a network host, a Tauri permission, a runtime dependency, or a new
  kind of data leaving the machine that the spec doesn't already name.
- Scope creeps: a good idea not in the plan goes to plan-v1.md §5 in a PR, not into the code.

Everything else: decide, follow the docs above, and record non-obvious choices in the PR body.

## Seeing the app

- **Browser (fake backend):** the harness (M1a-1) runs the real `+page.svelte` on an
  in-memory backend at `/harness`, in `--mode harness` only. `pnpm e2e:shots` writes
  screenshots of the main screens to `e2e/shots/` for a PR. To look around by hand, start Vite
  with `--mode harness` and open `/harness` (`?consent=unasked` and `?recents=none` pick a
  world). A new command or plugin call needs a handler in `src/lib/harness/`, or journeys fail.
- **Starting Vite:** `preview_start` fails in this sandbox (`EPERM: uv_cwd`). Run
  `node node_modules/vite/bin/vite.js dev --mode harness --port 1421 --strictPort` in the
  background, then `preview_start` with the URL.
- **The real app, no clicking:** build with a temporary probe that runs in the webview on
  startup and writes results to `BaseDirectory.AppData`, then run
  `pnpm exec tauri build --debug --no-bundle` and `src-tauri/target/debug/Erti`, and read the
  file. `--config '{"app":{"security":{"csp":"…"}}}'` swaps config without editing it. Remove
  the probe and its output afterwards, and state in the PR that it was used.
- **Worktrees:** pnpm refuses symlinked `node_modules`; call `./node_modules/.bin/<tool>`
  directly. Vite also refuses files outside the worktree, so two suites fail there for that
  reason alone.

## Conventions

- Conventional commits (commitlint enforces them). Prose bodies explain why. End with the
  `Co-Authored-By` line from the session.
- Comments explain why, in the voice of the surrounding code. British spelling in UI strings.
- UI is built from the primitives in `src/lib/ui` ([docs/design-system.md](docs/design-system.md)).
  A missing primitive is added there, with a catalogue entry, first. No numbers in class names,
  no colours, no shadows outside overlays: the ratchet test fails otherwise. Touching a
  surface means migrating it and lowering its baseline. Colour is never the only channel.
  Nothing new speaks unasked (docs/ux.md principles).
- Privacy: every network host is in the README list **and** the CSP `connect-src`
  (`networkAllowlist.test.ts` enforces this). Rust-side traffic is listed too.
- Shipped migrations are frozen. Every migration is idempotent, and a library backup is taken
  before one runs (ADR 008).
- Manuscripts keep `type: "doc"` at the root (ADR 002 amendment). Never write a shape an older
  Erti would load as empty.
- CodeRabbit reviews one PR an hour. Address its findings in the same PR before the maintainer
  merges, checking each one against the code.
