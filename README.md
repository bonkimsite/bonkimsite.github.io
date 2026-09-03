# bon.kim — static rebuild

A static version of Bon Kim's portfolio, built to run on GitHub Pages instead of
a paid hosting plan. Plain HTML and CSS, no framework, no runtime JavaScript.

**Status: complete.** All 21 content pages are ported — home, works index, CV,
contact, exhibitions, every work linked from the works index, and the Mourning
Heat essays those works link to. Routes are discovered automatically (see below),
so there is no hand-maintained page list. There is an RSS feed at `/rss.xml`, and
Korean text is set in a vendored font rather than left to the reader's system.

## The two parts (read this first)

This repo has two separate halves, and keeping them straight avoids all the
confusion:

1. **`site/` is the website.** Plain HTML, CSS, images, fonts. This is the whole
   thing that gets hosted. It needs no server software to run — a browser just
   opens the files. **GitHub only ever serves this folder.**

2. **`build/` is the tool that makes `site/`.** It runs on your computer with
   Node, reads the content extracted from the old host, and writes out the pages.
   Think of it as a printing press: you run it to produce the pages, but you don't
   need it to *read* them afterwards. **GitHub never runs this.**

So: you only need Node/npm when you want to (re)generate the site — for example if
Bon adds a new work. To simply host what's already here, the `site/` folder is
enough on its own.

## Quick start

You need [Node.js](https://nodejs.org) (v18+) installed. Then, from this folder:

```bash
npm run build     # render site/ from build/data/
npm run media     # download the images the built pages reference
npm run fonts     # cut the CJK font subset the built pages need
npm run check     # validate the output
npm run serve     # preview at http://localhost:8899
```

`npm run all` does build + media + fonts + check.

`build` needs nothing but Node, and is deterministic — two runs produce byte-identical
output. `media` and `fonts` reach the network and only need re-running when images or
Korean text change; `fonts` also needs Python with `fonttools` (`pip install
"fonttools[woff]" brotli`) and skips itself with a warning if that is missing.

### Previewing

`npm run serve` is the closest match to the live deployment, but the site is
**also fully clickable straight off disk** — open `site/index.html` in a browser
and navigate. Both work because links name the file (`work/foo/index.html`) and
all paths are page-relative, so nothing depends on a server to resolve a
directory to its index. On the live site the clean URL still works too
(`bon.kim/work/foo/`), and `<link rel="canonical">` marks it as the authoritative
one for sharing and search.

## How it works

The old host rendered each page in the browser from a JSON model embedded in the
HTML. That model — every page, every image reference, all of Bon's text — was
extracted to `build/data/`:

| Path | What it is |
| --- | --- |
| `build/data/pages.json` | 71 pages: title, url, content HTML |
| `build/data/media.json` | 192 images: hash, filename, dimensions |
| `build/lib.js` | Content model + conversion of the old custom elements |
| `build/build.js` | Renders `site/` |
| `build/fetch-media.js` | Downloads images into `site/assets/media/`, transcoding PNG→WebP |
| `build/fetch-fonts.js` | Cuts the CJK font subset from the built pages |
| `build/font-coverage.json` | Which characters that subset contains, for `check.js` |
| `build/check.js` | Post-build validation |
| `src/styles.css` | The stylesheet (hand-written for this rebuild) |

Bon's content contains platform-specific custom elements (`<media-item>`,
`<gallery-columnized>`, `<column-set>`). `build/lib.js` rewrites them into plain
HTML: `<figure>`/`<img>`, flex column rows, and positioned masonry boxes. A
`<media-item>` that points at a video (all YouTube here) becomes a lazy,
responsive `<iframe>` to `youtube-nocookie.com` — see "runtime dependencies".

### The masonry

The old site packed thumbnails with a script that measured images in the
browser. Every aspect ratio is already known at build time, so `packMasonry()`
computes the same shortest-column packing during the build and emits each box in
container-query units (`1cqw` = 1% of the gallery's width). One packing scales
fluidly; breakpoints only change the column count (3 → 2 → 1). No JavaScript
ships.

Verified against the live original at 1440px: identical column positions
(26 / 497 / 968px), identical widths (917px feature, 446px columns) and heights.
Where two columns tie exactly, the original sometimes settles the other way, so
a pair of same-height neighbours can swap places. Density is unaffected.

## How routing works

`ROUTES` in `build/lib.js` is computed, not hand-written. Five fixed pages (home,
works, CV, contact, exhibitions) seed a breadth-first crawl that follows every
in-site link and adds a `/work/<slug>/` for each work page it reaches — including
works linked only from another work page. So a new work published on the original
appears here just by being linked; re-run `npm run build && npm run media`.
`npm run check` reports any internal link whose target isn't built.

**Exhibitions is a special case.** It is a public page on the original, but
nothing links to it — not the nav, not any page — so the crawl can never reach
it. It is seeded explicitly so the URL resolves, exactly as it does on the
original, and it is deliberately *not* in the nav, because the original's nav
(Works / CV / Contact) does not carry it either. Note that the page is a
work in progress: of its 16 gallery slots, 6 hold images and 10 are still empty
placeholders, which are dropped rather than rendered as gaps. If Bon would rather
it not be reachable at all, remove the `'exhibitions'` line from `FIXED_ROUTES`;
to put it in the nav instead, add it to `NAV` in `build/build.js`.

### The feed

`/rss.xml` lists the works in the order the works index shows them, which is Bon's
own ordering. It carries **no publication dates**, and that is deliberate: the
export has no date for any page, and the only timestamps anywhere are image upload
times that record the 2024–25 migration onto Cargo rather than when a work was
made or shown. They would date "A Chair for Co-responding, 2022" to December 2024
and the 2016 drawings to January 2025, and four of the essay pages have no images
to take a date from at all. `pubDate` is optional in RSS 2.0, so the feed omits it
rather than telling subscribers something untrue. If real dates matter later, they
need to come from Bon, not from the export.

Two details the router handles: Cargo urls are case-insensitive (a link to
`Water-in-the-(h)air-1` resolves to the lowercase page), and the old site kept
**hand-maintained mobile duplicates** of every page (`/works-2` + `/mobile-works`,
`/cv-` + `/cv-mobile-1`, …). This rebuild is responsive, so the duplicates
collapse into their desktop original — see `MOBILE_TWINS` in `build/lib.js`.

### Layout: column-sets

Beyond the masonry, work pages use Cargo `column-set`/`column-unit` rows. A unit
with `span=N` takes N of 12 columns; a unit with **no** span shares the row equally
with its siblings (the multi-column galleries). Those two cases are genuinely
different, so the build keeps them distinct in the markup — `span=1` and no-span
are not the same thing.

The span is not a flex-grow share. Cargo lays the row out as 12 columns with the
gutter *between* them, so a unit spanning N also swallows the N-1 gutters inside
it:

    col   = (W - 11g) / 12
    width = N*col + (N-1)*g   ==   N/12*W - g*(12-N)/12

Growing 9:3 instead leaves a span-9 unit 9.2px short at 1440px, and the error
scales with the gutter, so the width goes in as an explicit `flex-basis`. A full
row's bases sum to `W` minus one gutter, which the single `gap` puts back.

Images carrying `scale="50%"` take half their column so two sit side by side, and
they bottom-align the way the original does.

### Inline type scaling

Bon's markup sizes type with an inline `--font-scale`, and Cargo's editor emits
spans that nest and each repeat it — nine deep in the right-hand column of the
Kafka page. Two rules make this behave:

- **The scale multiplies a declared base (`--fs-base`), never the parent's
  already-scaled size.** Scaling from `1em` compounds a repeated factor: 0.85
  applied nine times rendered 11.57px text at 3.15px.
- **It inherits.** A scale on a wrapper applies to the text inside it — measured
  on the original, a `.bodyoftextlight` inside a span carrying 0.85 computes at
  1.05rem × 0.85.

Each text class declares the base it scales from; a nested span repeating the
same scale is then idempotent, while one declaring a different scale still
resizes. Note `--fs-base` is a plain custom property, not an `@property`: a
registered property's initial value must be computationally independent, and
`rem` is not, so registering it silently drops the declaration and takes every
untyped element's size with it.

Verified by comparing every text run against the original: **207 runs across all
21 pages agree exactly on font-size.**

### Layout: how the values were arrived at

The page chrome is not one set of numbers. Driving headless Chrome over the
original at a 1440px viewport and reading computed styles gives:

| page | reserved above | measure |
| --- | --- | --- |
| works index | 95.56px | full-bleed |
| work pages | 115.06px | 90% |
| CV | 95.56px | 73% |
| contact | 95.56px | 90% |

Work pages sit under a taller pinned header than everything else, and the CV runs
narrower — hence `body.kind-*` in the stylesheet. The measure is a share of the
*viewport*, padded inside; taking a share of an already-padded box shrinks it.

Checked the same way, the rebuild now matches the original to **0.3-1.1px on every
image width and x position**, and every text run agrees exactly on font-size,
line-height, weight and letter-spacing.

## Deploying to GitHub Pages

1. Create a repository on GitHub and push this project to it.
2. In the repo, go to **Settings → Pages → Source** and choose **GitHub Actions**.
3. That's it — `.github/workflows/pages.yml` publishes the site on every push to
   `main`, and gives you a live URL (`username.github.io/<repo>/`).

To use the real domain, add a file named `CNAME` containing just `bon.kim` to the
`site/` folder, then point the domain's DNS at GitHub Pages. Do the DNS switch
**after** the Pages site is live and you've checked it — a domain can only serve
one host at a time, so switching too early takes the current site down.

A note on the workflow: it re-runs the build on GitHub's servers, fails if the
result differs from what is committed in `site/`, then publishes. The build is
deterministic, so that comparison is meaningful — it catches content edited
without re-running the build. That is the only place Node runs in hosting, and it
isn't required: the committed `site/` folder is already complete. If you'd rather
have GitHub serve the folder with no build step at all, that's a small change; ask.

The images are committed to the repo, so the live site never calls the old host.
They total ~70MB (down from ~575MB of originals): each is pulled at display size,
and PNG screenshots are converted to WebP during `npm run media`. Both the clean
URL (`bon.kim/works/`) and the file URL (`bon.kim/works/index.html`) work, and the
site also runs from a project subpath (`username.github.io/repo/`) unchanged.

## Licensing and provenance

Bon's own work — her text, images, page structure and design — is hers, and
moving it to her own hosting is entirely hers to do. The rebuild is deliberately
scoped to that, and avoids anything belonging to the old platform:

- **No platform code.** The old frontend bundle (`build.cargo.site/…`) is
  proprietary and is not reused. `src/styles.css` is written from scratch for
  this rebuild; it reproduces the design's colours, type scale and spacing, but
  none of the platform's template CSS is copied.
- **No Diatype.** The original loads ABC Dinamo's Diatype from the platform's
  font CDN under *their* licence, which does not transfer to self-hosting. It is
  replaced by **IBM Plex Mono** (SIL Open Font License, `site/assets/fonts/OFL.txt`),
  which the original already used for nearly all visible text — only `.caption`
  was Diatype. If Bon wants Diatype specifically, it must be licensed directly
  from ABC Dinamo.
- **Korean is set in Noto Sans KR**, subset to the 637 CJK characters the site
  actually uses (77KB, from ~10MB upstream). It is SIL Open Font Licensed;
  `site/assets/fonts/OFL-NotoSansKR.txt` and `NOTICE.txt` record the licence and
  the fact that the file is a subset. IBM Plex Sans KR would have been the
  designed companion to Plex Mono, but it contains no Hanja at all — it would have
  split a title like 열곡(熱哭) across two typefaces mid-word.
- **No runtime calls to the old host.** Images are downloaded and served from
  this repo; `build/check.js` fails the build if any Cargo reference remains.

The one build-time dependency is `fetch-media.js`, which pulls Bon's own images
from the CDN they currently sit on. Run it once; after that the images are
self-contained. Keep the account alive until they are downloaded.

### Runtime dependencies

The pages are otherwise static and self-contained, with one exception: work
pages that embed a video load a **YouTube** player at runtime, since video can't
be self-hosted on Pages. These use `youtube-nocookie.com` (no tracking cookie
until play) and `loading="lazy"` (no request until scrolled into view). The
videos are Bon's own uploads. If she later wants zero third-party calls, the
alternative is a click-to-play poster image linking out to YouTube.

## Known gaps

- **Vertical position drifts by 12-27px** on long work pages — under 0.5% of page
  height, and image widths and x positions are exact. Body content sits ~11.7px
  higher than the original relative to the page title: the title is an
  inline-block whose line box the original makes taller by that much, and the
  cause has not been identified. Setting the title's `line-height` to 2.6 aligns
  every image to within 0.2px, but that inflates the title's own box from 38.5px
  to 50px — and it has a background colour, so the block behind it would visibly
  fatten. Not worth trading a correct metric for a coincidental fit.
- **The exhibitions page is unfinished upstream** — 10 of its 16 gallery slots are
  empty placeholders in Bon's own content. The rebuild drops them rather than
  rendering holes, so the page shows the 6 real images. Nothing to fix here; it
  fills in when Bon fills it in.
- **Adding Korean text needs `npm run fonts`.** The vendored font contains exactly
  the characters the pages used when it was last cut. `npm run check` fails and
  names any character that has outrun it, so this cannot ship unnoticed.
