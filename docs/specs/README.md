# Specs: acceptance criteria for every 1.0 item

One file per milestone. Every item in [plan-v1.md](../../plan-v1.md) §3 has an entry here with:

- **ID** (`M1a-4`): used in the GitHub issue title, the branch name and the PR title.
- **Refs**: the ADR, `SEC-n`, `UX-n` or TEST section it implements.
- **Depends on**: items that must merge first.
- **AC**: numbered acceptance criteria. Each becomes at least one test, which names it
  (`// M1a-4 AC-2`). A criterion that can't be automated says how it's checked instead.
- **Verify**: the evidence the PR must show: test names, a harness result, a screenshot from the
  app-in-browser harness, or an in-app probe.

An item is done when every AC holds on `main` and its Verify evidence is in the merged PR.
Changing an AC is a plan change: note it in the PR and in plan-v1.md §6.

| File          | Milestone                       |
| ------------- | ------------------------------- |
| [M0](M0.md)   | Land what exists, fix first-run |
| [M1a](M1a.md) | Safety net and file format      |
| [M1b](M1b.md) | Sources, notes and import       |
| [M2](M2.md)   | Retrieval index                 |
| [M3](M3.md)   | Writing companion               |
| [M4](M4.md)   | Attribution check               |
| [M5](M5.md)   | Writing essentials              |
| [M6](M6.md)   | Scale and quality gates         |
| [M7](M7.md)   | Release pipeline, beta, 1.0     |
