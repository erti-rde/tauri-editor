<!-- Title: `<ID>: <what it does>`, e.g. `M1a-8: write manuscripts in format 1`. No ID? Say why below. -->

Closes #

**Spec:** docs/specs/<milestone>.md#<id>

## Acceptance criteria

<!-- Every AC from the spec, ticked, each with where it's proven: a test name, a CI run, a screenshot or a probe. -->

- [ ] AC-1 … (proven by `…`)

## Verify

<!-- The evidence the spec's Verify line asks for. -->

## Not verified

<!-- Anything unproven, stated plainly. "Nothing" is a valid answer. -->

## Checklist

- [ ] `pnpm verify` passes locally
- [ ] UI built from `src/lib/ui` primitives; ratchet baseline lowered where a surface was touched
- [ ] No new network host, Tauri permission or runtime dependency, or the maintainer agreed (link)
- [ ] Shipped migrations untouched; a new migration is idempotent and fingerprinted
- [ ] Probe routes, spikes and throwaway files removed
