# Releasing Erti

How a version gets from `main` to a researcher's machine, at no cost to the project.
`release.yaml` implements the pipeline below (M7a-1), with its decisions in `scripts/release`.
Running it by hand is a dry run: every build and check, and no release.

## Principles

- **Free.** No paid certificates or services. The limits that come from that are handled by
  documentation and checksums rather than hidden.
- **A human publishes.** CI builds a draft. A person installs it on each platform and presses
  publish. The updater only ever sees published releases.
- **Nothing the release depends on floats.** Toolchains come from `rust-toolchain.toml` and
  `.nvmrc`, pnpm from `packageManager`, and third-party actions are pinned by commit SHA in any
  job that holds a write token or a signing key.
- **The updater is a network call** like any other, so it sits behind the consent gate and in the
  README's list. It's made from Rust, outside the webview CSP, which makes that listing the only
  thing that keeps it honest.

## Pipeline

```
tag vX.Y.Z pushed
  │
  ├─ 1. verify   version in package.json = tauri.conf.json = Cargo.toml = tag;
  │              tag is on main; CHANGELOG section for X.Y.Z exists
  ├─ 2. ci       the full ci.yaml (reused via workflow_call): lint, typecheck,
  │              vitest, corpus health, fmt, clippy, cargo test
  ├─ 3. build    matrix, fail-fast off:
  │                macos-14         aarch64-apple-darwin      .dmg + .app.tar.gz
  │                (Intel macOS)    x86_64-apple-darwin       .dmg + .app.tar.gz
  │                windows-latest   x86_64-pc-windows-msvc    NSIS .exe (+ .msi)
  │                ubuntu-22.04     x86_64-unknown-linux-gnu  AppImage + .deb
  │              macOS signed with a free self-signed identity (ad-hoc fallback)
  │              updater artefacts signed with TAURI_SIGNING_PRIVATE_KEY
  ├─ 4. smoke    Linux: launch the AppImage under xvfb for 30 s, fail if it exits;
  │              every platform: bundle contains resources/all-MiniLM-L6-v2/model.onnx
  │              and resources/csl/*.json
  ├─ 5. draft    GitHub release as DRAFT: artefacts, SHA256SUMS.txt, latest.json,
  │              notes = CHANGELOG section + link to the first-open guide
  └─ 6. human    install from the draft on macOS arm64, macOS Intel, Windows, Linux;
                 run the release checklist; publish  →  latest.json goes live
```

Why each gate:

- **ubuntu-22.04** for Linux: an AppImage runs on distributions whose glibc is at least as new as
  the build machine's, so the oldest supported runner covers the most researchers.
- **Separate macOS architectures** rather than a universal binary: `ort` links a native ONNX
  Runtime per architecture, and a universal build means lipo-ing two of them. Two downloads are
  simpler and each is half the size. Check the Intel runner label each release (GitHub has been
  retiring Intel images).
- **Smoke test on the built artefact:** unit tests pass against source. What breaks releases is
  packaging: a resource missing from the bundle, a dylib not found. The model is 23 MB of
  `resources/` that nothing in CI currently checks ships.
- **Draft + human:** unsigned binaries are about to be run by people who've been told to click
  past a warning. A human installing each one first is the minimum.

## Free distribution

| Platform | What we do                                                                                                                                                                                                                                                                | What the user sees                               | Guide covers                                                        |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ | ------------------------------------------------------------------- |
| macOS    | A free **self-signed** certificate with a stable identity (CI secret); ad-hoc as fallback. Apple Silicon refuses unsigned code outright, and a stable identity keeps privacy permissions (Documents access) across updates, where an ad-hoc signature changes every build | "Apple could not verify…". Blocked on first open | macOS 15+: System Settings → Privacy & Security → **Open Anyway**   |
| Windows  | Unsigned NSIS installer; apply to **SignPath Foundation** (free for OSS)                                                                                                                                                                                                  | SmartScreen "Windows protected your PC"          | **More info → Run anyway**; replaced by signing if SignPath accepts |
| Linux    | AppImage + .deb, no signing convention                                                                                                                                                                                                                                    | Nothing, or "not executable"                     | `chmod +x`; `sudo apt install ./erti.deb`                           |
| All      | `SHA256SUMS.txt` on every release                                                                                                                                                                                                                                         |                                                  | How to check a download against it, per OS                          |

The guide explains _why_ in the README's voice: a free project, what certificates cost, and what
the warning does and doesn't mean. It's linked from the README, the landing page and every
release's notes.

## Updates

- `tauri-plugin-updater`, `bundle.createUpdaterArtifacts: true`, and the public key in
  `plugins.updater.pubkey`. The endpoint is the latest release's `latest.json` on GitHub.
- The keypair is generated once with `pnpm tauri signer generate`. The private key and its
  password are repository secrets (`TAURI_SIGNING_PRIVATE_KEY`,
  `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`). The public key is committed. **The private key is also
  kept offline by the maintainer**: lose it and every installed copy can never update again.
- **Consent:** checking for updates is off until the user agrees, asked in the same first-run
  gate as lookups ("Check for new versions of Erti: sends your current version number to
  GitHub"). "Check now" in Settings always works on request. The README's list gains the entry.
- Updates are downloaded by the app, not a browser, so they carry no quarantine mark. **Verified
  in the 0.9 beta, not assumed:** a self-signed macOS app updating itself (and keeping its Documents access), and the Windows
  installer relaunching without a SmartScreen prompt.
- Pre-releases (0.9.x betas) are GitHub pre-releases. `latest.json` comes from the latest full
  release, so beta testers move to 1.0 by installing it once.

## Versioning and changelog

- SemVer. `pnpm release X.Y.Z` (a small script) bumps the three version files, runs
  `git-cliff` to prepend a `CHANGELOG.md` section from conventional commits (`feat`, `fix`,
  `perf`, and `BREAKING CHANGE` get sections; `chore`, `test`, `docs` are dropped), and creates
  the release commit and tag.
- A **manuscript or library format change** is called out in its own section, even when it's
  backward compatible, because it's what a co-author on an older version runs into.

## Defects in the old `release.yaml`, fixed in M7a-1

Kept as the record of why each part of the pipeline is the way it is.

1. The changelog is written to `$GITHUB_OUTPUT` with `echo`, which keeps one line. The checkout
   has no `fetch-depth: 0`, so there are no tags to diff from. `git tag --list | tail` sorts
   lexically (`v0.10` < `v0.9`).
2. `pnpm/action-setup` pins `version: 8` while `packageManager` says `pnpm@11.1.3`. The action
   refuses conflicting versions.
3. Node is set up twice (20, then `lts/*`); `.nvmrc` says 22.
4. `TAURI_PRIVATE_KEY` / `TAURI_KEY_PASSWORD` are Tauri 1 names. Tauri 2 reads
   `TAURI_SIGNING_PRIVATE_KEY` / `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`, so updater artefacts
   would be unsigned.
5. `releaseDraft: false` publishes the moment the build finishes, with no human gate.
6. `includeDebug: true` builds and uploads debug bundles next to release ones.
7. The matrix is Windows only.
8. No CI gate, no version check, no checksums, no smoke test.
9. Actions are pinned by tag, not SHA, in a job holding `contents: write` and signing secrets.
10. `rustup update` installs floating stable, where CI uses the pinned toolchain.
