# Citation styles and locales that ship with Erti

So that a fresh install can cite with no network at all. Listed in `bundled.json`, which is
what the app reads.

| From | Commit |
| --- | --- |
| [citation-style-language/styles](https://github.com/citation-style-language/styles) | `2e9355847feffe53d0e9f82cd8ee119c4a0ff2db` |
| [citation-style-language/locales](https://github.com/citation-style-language/locales) | `a89adece41013402236e2c9020972d7e931fbab8` |

All files are unmodified and carry their original licence headers: Creative Commons
Attribution-ShareAlike 3.0 (CC BY-SA 3.0).

**Vancouver.** Upstream no longer has a generic `vancouver.csl`; every NLM/Vancouver style
belongs to a publisher. Elsevier's citation-sequence variant is the most widely used
general-purpose one, so it ships under the label "Vancouver (NLM)".

**Updating.** Download the same file names at a newer commit, update the two commits above,
and run `pnpm test`: `bundled.test.ts` renders a citation with every bundled style and
locale.
