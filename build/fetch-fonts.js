'use strict';
// Builds the CJK webfont the site needs, and nothing more.
//
// IBM Plex Mono carries no Hangul or Han, so Korean titles and the Korean essay
// pages fall through to whatever the reader happens to have installed — the one
// place the rebuild's typography is out of our hands, and the only "known gap"
// that shows up as visibly different text.
//
// Noto Sans KR covers all of it: Hangul, the Hanja that appear in titles such as
// 열곡(熱哭), and CJK punctuation. IBM Plex Sans KR was tried first, as the
// designed companion to Plex Mono, but it has no Hanja at all — it would have
// split 열곡(熱哭) across two typefaces mid-word. Noto is also the closest match
// to the system Korean face the original site actually falls back to today.
//
// The subset is derived from the built pages, not a fixed list: whatever CJK
// appears in site/ is what gets embedded, and build/font-coverage.json records
// it so `npm run check` fails if new Korean text outruns the font.
//
// Licensing: Noto Sans KR is OFL-1.1 (© Adobe, Reserved Font Name "Source" —
// the name "Noto Sans KR" is not reserved, so the subset keeps its real name).
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const SITE = path.join(ROOT, 'site');
const OUT = path.join(SITE, 'assets', 'fonts');
const CACHE = path.join(__dirname, '.cache');

const UPSTREAM = 'https://raw.githubusercontent.com/google/fonts/main/ofl/notosanskr';
const FONT_URL = `${UPSTREAM}/NotoSansKR%5Bwght%5D.ttf`;
const LICENSE_URL = `${UPSTREAM}/OFL.txt`;
const OUT_FONT = 'noto-sans-kr-cjk-subset.woff2';

// The blocks IBM Plex Mono leaves uncovered. Only codepoints actually found in
// the built pages are embedded; these ranges just decide what counts as CJK.
const CJK_BLOCKS = [
  [0x1100, 0x11ff], [0x3000, 0x303f], [0x3130, 0x318f], [0x3400, 0x4dbf],
  [0x4e00, 0x9fff], [0xac00, 0xd7af], [0xf900, 0xfaff], [0xff00, 0xffef],
];
const isCJK = c => CJK_BLOCKS.some(([a, b]) => c >= a && c <= b);

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out); else out.push(p);
  }
  return out;
}

// Scan the built HTML verbatim — tags included — so CJK sitting in an alt or a
// title attribute is covered as well as CJK in the visible text.
function usedCodepoints() {
  const set = new Set();
  for (const f of walk(SITE).filter(f => f.endsWith('.html'))) {
    for (const ch of fs.readFileSync(f, 'utf8')) {
      const c = ch.codePointAt(0);
      if (isCJK(c)) set.add(c);
    }
  }
  return [...set].sort((a, b) => a - b);
}

function pyftsubset() {
  for (const n of ['pyftsubset']) {
    try { execFileSync(n, ['--help'], { stdio: 'ignore' }); return n; } catch { /* next */ }
  }
  return null;
}

async function cached(url, file) {
  const p = path.join(CACHE, file);
  if (fs.existsSync(p)) return p;
  fs.mkdirSync(CACHE, { recursive: true });
  const res = await fetch(url, { headers: { 'User-Agent': 'bon-kim-site-build/1.0' } });
  if (!res.ok) throw new Error(`${url} -> HTTP ${res.status}`);
  fs.writeFileSync(p, Buffer.from(await res.arrayBuffer()));
  return p;
}

(async () => {
  const cps = usedCodepoints();
  if (!cps.length) { console.log('No CJK in the built pages; nothing to build.'); return; }
  console.log(`${cps.length} distinct CJK characters across the built pages`);

  const tool = pyftsubset();
  if (!tool) {
    console.warn('  !! pyftsubset not found — keeping the existing font, if any.');
    console.warn('     Install with:  pip install "fonttools[woff]" brotli');
    return;                       // not fatal: the committed subset stays valid
  }

  fs.mkdirSync(OUT, { recursive: true });
  const raw = await cached(FONT_URL, 'NotoSansKR-VF.ttf');
  const dest = path.join(OUT, OUT_FONT);

  // The upstream is a variable font; keeping the wght axis means one file serves
  // both the 400 and 600 the stylesheet asks for.
  execFileSync(tool, [
    raw,
    `--unicodes=${cps.map(c => 'U+' + c.toString(16).toUpperCase()).join(',')}`,
    '--flavor=woff2',
    '--layout-features=',    // precomposed Hangul and Han need no shaping features
    '--no-hinting',
    `--output-file=${dest}`,
  ], { stdio: ['ignore', 'ignore', 'inherit'] });

  // Ship the upstream licence next to the font, as the OFL requires.
  fs.copyFileSync(await cached(LICENSE_URL, 'OFL-NotoSansKR.txt'),
                  path.join(OUT, 'OFL-NotoSansKR.txt'));

  // What the font actually contains, for check.js to verify against the pages.
  fs.writeFileSync(path.join(__dirname, 'font-coverage.json'),
    JSON.stringify({ font: OUT_FONT, codepoints: cps }, null, 1) + '\n');

  fs.writeFileSync(path.join(OUT, 'NOTICE.txt'),
`${OUT_FONT}
${'='.repeat(OUT_FONT.length)}

A subset of Noto Sans KR, copyright 2014-2021 Adobe, licensed under the SIL Open
Font License 1.1 with Reserved Font Name "Source". The full licence is in
OFL-NotoSansKR.txt; the name "Noto Sans KR" is not a reserved name, so this
subset keeps it.

The only modification is subsetting: of the font's 23,000-odd glyphs, the
${cps.length} CJK characters that appear in this site's pages are retained, and
the variable weight axis is kept so one file serves every weight the stylesheet
uses. Regenerated by build/fetch-fonts.js; run "npm run fonts" after adding
Korean text.

It is used only for Hangul, Han and CJK punctuation. The site's Latin text is set
in IBM Plex Mono (see OFL.txt), which is unmodified.
`);

  const kb = (fs.statSync(dest).size / 1024).toFixed(0);
  const src = (fs.statSync(raw).size / 1024 / 1024).toFixed(1);
  console.log(`  ${OUT_FONT}  ${src}MB -> ${kb}KB  (+ OFL-NotoSansKR.txt, NOTICE.txt)`);
  console.log(`  coverage recorded in build/font-coverage.json`);
})();
