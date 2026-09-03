# Handoff — bon.kim static rebuild

Session `546f895a-7ccd-4576-947d-46e047386442` (`claude --resume 546f895a-7ccd-4576-947d-46e047386442`).

## Goal

Replace Bon Kim's Cargo-hosted portfolio (https://bon.kim) with a static site on
GitHub Pages that is visually and functionally identical, while reusing none of
Cargo's frontend code, template CSS, or licensed fonts. `build/` renders `site/`
from content extracted to `build/data/`; only `site/` is served.

## Current state

Working tree **clean**. Branch `main`, 3 commits, all pushed.

- **Live**: https://bonkimsite.github.io — repo `bonkimsite/bonkimsite.github.io`, public.
- 21 pages build; `node build/check.js` passes all four checks.
- Build is **deterministic** — two runs are byte-identical. CI depends on this:
  `.github/workflows/pages.yml` rebuilds and fails if committed `site/` differs.
- **Text fidelity: exact.** 207 text runs across all 21 pages agree with the
  original on font-size (verified against the live site, not just local files).
- **Image fidelity: 0.3–1.1px** on width, ≤0.4px on x position.

Known-imperfect, all documented in README "Known gaps":

- **~11.7px constant vertical offset** on work pages: body content sits that much
  higher than the original relative to the page title. Cause not identified.
- **`/work/a-man-with-three-legs/` drifts 26.5px and *accumulates*** (11.7 → 26.5
  down the page), unlike the constant offset elsewhere. Not diagnosed — there is
  a block-height difference on that page that was never isolated.
- **Works index**: 5 of 13 thumbnails sit in a different column than the original,
  at the same y with matching density. Pre-existing masonry tie-break, documented.
- `/exhibitions/` is 10/16 empty placeholders **upstream**, in Bon's own content.

Nothing is left half-finished or broken.

## Files touched (all committed)

| File | Change |
| --- | --- |
| `build/lib.js` | Seeded `exhibitions` in `FIXED_ROUTES`; `column-unit` now distinguishes `span=N` from no-span (emits `.column-unit-auto`); `mediaFile()` falls back to `image` not slugify's `page`; alt text falls through caption → filename → page title |
| `build/build.js` | `kind-*` class on `<body>`; conditional CJK font preload; RSS feed generation; threads page title into `convert()` |
| `build/check.js` | CJK coverage check against `font-coverage.json`; treats `.xml`/`.txt` as file assets |
| `build/fetch-fonts.js` | **New.** Subsets Noto Sans KR to the CJK actually used |
| `build/font-coverage.json` | **New, generated.** 637 codepoints; committed so CI checks without Python |
| `build/rename-font.py` | **Created then deleted** — see Dead ends |
| `src/styles.css` | 12-column grid math; per-page-kind chrome; `vertical-align: bottom` on media; removed body `letter-spacing`; `.bodyoftextlight` → block; `--fs-base` scale model |
| `.github/workflows/pages.yml` | Real staleness check (`git diff --quiet -- site`) |
| `.gitattributes` | **New.** LF pinning so the Windows→Linux staleness diff is meaningful |
| `.gitignore` | Added `build/.cache/` |
| `package.json` | Added `npm run fonts`; `all` = build + media + fonts + check |
| `README.md` | Documented all of the above |
| `site/**` | Regenerated |

## Decisions

- **Noto Sans KR, not IBM Plex Sans KR**, for CJK. 10MB upstream → 77KB subset,
  variable weight axis kept so one file serves 400 and 600. Cut from the built
  pages, so it regenerates as content changes.
- **RSS carries no `pubDate`.** The export has no page dates; the only timestamps
  are media upload times recording the 2024–25 Cargo migration. They would date
  "A Chair for Co-responding, 2022" to Dec 2024 and the 2016 drawings to Jan 2025.
  Four essay pages have no media at all. `pubDate` is optional in RSS 2.0.
- **`/exhibitions/` is built but deliberately absent from the nav**, because the
  original's nav (Works/CV/Contact) does not carry it and nothing links to it.
- **One repo, named `bonkimsite.github.io`** so the site serves at the root with
  no `/subpath`. A second "hosting" repo was proposed and argued against.
- **Git identity is set `--local` only.** The **global** config is
  `arbitraryurl <65641358+arbitraryurl@users.noreply.github.com>`, which is a
  *different, stale account*. Any new repo on this machine will inherit it.

Constraints discovered, not chosen:

- **IBM Plex Sans KR contains no Hanja at all** — covers 592/637 codepoints used.
- **Cargo's column math**: a unit spanning N of 12 columns also takes the N−1
  gutters inside it — `N/12*W − g*(12−N)/12`, not a flex-grow share.
- **The original uses two different top chromes**: 95.56px above most pages,
  115.06px above work pages; CV runs to 73%, works index full-bleed.
- **`pyftsubset` keeps only name IDs 0–6 by default**, silently dropping the OFL
  licence records. `--name-IDs=*` is required.
- **A registered `@property` initial value must be computationally independent** —
  `rem` is not.
- **Cargo puts its `<img>` inside `<media-item>`'s open shadow root.** Any probe
  must recurse into `shadowRoot` or it sees zero images.

## Dead ends

- **IBM Plex Sans KR as the CJK face.** The designed companion to Plex Mono, and
  what the README originally proposed, but it has no Hanja — it would have split
  the title 열곡(熱哭) across two typefaces mid-word.
- **Fontsource's `noto-sans-kr-korean-*.woff2`.** 11,541 glyphs but Hangul only;
  missing all 37 Hanja and 8 CJK brackets. Fontsource slices by unicode-range.
  Use the full variable TTF from `google/fonts` instead.
- **`build/rename-font.py`.** A whole OFL Reserved-Font-Name renaming pipeline was
  built because IBM Plex reserves the name "Plex" and subsetting is a modification.
  Became unnecessary on switching to Noto, whose reserved name is "Source", not
  "Noto" — the subset keeps its real name. File deleted; do not rebuild it.
- **`h1 { line-height: 2.6 }`** to close the 11.7px offset. Aligns every image to
  within 0.2px, but inflates the title's own box from 38.5px to 50px, and that h1
  carries a white background — the block behind the title would visibly fatten.
  Rejected: do not trade a verified-correct metric for a coincidental fit.
- **`@property --fs-base { initial-value: 1.3rem }`.** Silently dropped, taking
  every untyped element's font-size with it. It is a plain custom property now.
- **`vertical-align: baseline` on `.media-item`.** Leaves the parent's descender
  space under every image; accumulated to 31.5px adrift by the last image.
  `bottom` still bottom-aligns scaled pairs, which is why baseline was chosen.
- **`<lastBuildDate>` in the RSS feed.** Made the build non-deterministic, which
  would have made the CI staleness check fail on every run. Removed.
- **Letting GitHub auto-enable Pages.** It enabled `build_type: legacy` and its
  Jekyll build raced ours and won — the live site served the rendered README while
  both workflow runs reported success. Fixed with
  `gh api repos/OWNER/REPO/pages -X PUT -f build_type=workflow`. **A green
  Actions run does not prove the right bytes are live**; fetch the URLs.
- **Python heredocs patching JS.** `\\n` inside a replacement string lands as a
  real newline and breaks JS string literals. Use `chr(10)` explicitly, or put the
  newline inside a template literal, where it is legal.

## Open questions

- **The 11.7px offset.** The h1 and its parent have identical computed metrics on
  both sites, yet the original's line box is ~12.5px taller. Options: leave it
  (current, documented); find the real cause; or accept the `line-height` hack and
  its fatter title background.
- **`a-man-with-three-legs` accumulating drift** — undiagnosed, above.
- **Node 20 deprecation warnings** on `actions/checkout@v4`,
  `configure-pages@v5`, `setup-node@v4`, `upload-artifact@v4`,
  `deploy-pages@v4`. Warnings only; nothing is broken.
- **Custom domain `bon.kim` is not set up.** Needs `site/CNAME` + DNS. Do the DNS
  switch *after* checking the Pages site — a domain serves one host at a time.
- **The measurement harness is not in the repo.** It lived in this session's
  scratchpad (puppeteer-core driving the installed Chrome at
  `C:/Program Files/Google/Chrome/Application/chrome.exe`) and **is gone** for a
  fresh session: `probe2.js`, `unit.js`, `textdiff.js`, `sweep.js`, `batch.js`,
  `resp.js`. Recreating it is ~30 minutes. Worth moving into the repo if any
  further fidelity work is planned — say so and I will.

## Next step

Diagnose the accumulating drift on `/work/a-man-with-three-legs/` — the only
known defect that is *not* the understood 11.7px constant. Recreate a probe that
walks the `column-unit` children on both sites and diffs block heights (this is
exactly what isolated the `.bodyoftextlight` bug), then compare:

```
https://bon.kim/a-man-with-three-legs
https://bonkimsite.github.io/work/a-man-with-three-legs/
```

Remember to recurse into `shadowRoot` or the original reports zero images.

---

**For `CLAUDE.md`, not here:** two rules from this session are durable and will
still apply in a month — (1) this machine's **global** git identity is the wrong
account, so every repo here needs `git config --local user.email` set explicitly;
(2) verify a Pages deploy by fetching the live URLs, because a green Actions run
does not prove the right bytes are being served. Say the word and I will move them.
