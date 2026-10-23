# Network capture

What the release build of Erti sent over the network, journey by journey (M6-4): the
real-app journeys, run behind a logging proxy and under `strace`. `docs/testing.md` says how
to run it again.

- **Build:** release, commit `f8385182b132`, 2026-10-23
- **Run:** https://github.com/erti-rde/tauri-editor/actions/runs/39969523356
- **Listed hosts:** `doi.org`, `api.crossref.org`, `data.crosscite.org`, `raw.githubusercontent.com`

| Journey          | Consent  | Hosts reached, through the proxy                                                                     | Around the proxy | DNS lookups | Local plumbing |
| ---------------- | -------- | ---------------------------------------------------------------------------------------------------- | ---------------- | ----------- | -------------- |
| consent-declined | declined | none                                                                                                 | 0                | 0           | 304            |
| consent-granted  | granted  | doi.org:443 ×3, api.crossref.org:443 ×2, data.crosscite.org:443 ×1, raw.githubusercontent.com:443 ×1 | 0                | 0           | 303            |
| csp (probe)      | declined | doi.org:443 ×1, api.crossref.org:443 ×1, data.crosscite.org:443 ×1, raw.githubusercontent.com:443 ×1 | 0                | 0           | 304            |
| marks            | declined | none                                                                                                 | 0                | 0           | 530            |
| writing          | granted  | doi.org:443 ×3, api.crossref.org:443 ×2, data.crosscite.org:443 ×1                                   | 0                | 0           | 303            |

"Local plumbing" counts loopback connections other than to the proxy, such as the test
harness reaching WebKit's driver. None of it leaves the machine.

- **csp** is a probe: it fetches each listed host from the page itself to test the CSP, whatever consent says; its hosts are still checked against the list.

Every host reached is on the list, nothing went around the proxy, and no journey without consent sent anything.
