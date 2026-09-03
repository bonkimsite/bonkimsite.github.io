'use strict';
// Sanity checks over the built site: no platform leftovers, no invalid nesting,
// no dead internal links, no unresolved images.
const fs = require('fs');
const path = require('path');

const OUT = path.join(__dirname, '..', 'site');
let failures = 0;

const fail = (msg) => { console.log('  FAIL  ' + msg); failures++; };
const pass = (msg) => console.log('  ok    ' + msg);

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

const files = walk(OUT);
const htmlFiles = files.filter(f => f.endsWith('.html'));
const rel = f => '/' + path.relative(OUT, f).replace(/\\/g, '/');

console.log(`Checking ${htmlFiles.length} pages\n`);

for (const f of htmlFiles) {
  const html = fs.readFileSync(f, 'utf8');
  const name = rel(f);

  const custom = html.match(/<(media-item|gallery-[a-z]+|column-set|column-unit|text-icon)\b/g);
  if (custom) fail(`${name}: unconverted elements ${[...new Set(custom)].join(', ')}`);

  // nested anchors: any <a> opened before the previous one closed
  const anchors = [...html.matchAll(/<a\b[^>]*>|<\/a>/g)].map(m => m[0]);
  let depth = 0, nested = false;
  for (const t of anchors) {
    if (t === '</a>') depth--;
    else { depth++; if (depth > 1) nested = true; }
  }
  if (nested) fail(`${name}: nested <a> tags`);
  if (depth !== 0) fail(`${name}: unbalanced <a> tags (depth ${depth})`);

  if (/freight\.cargo\.site|build\.cargo\.site|type\.cargo\.site|static\.cargo\.site/.test(html))
    fail(`${name}: still references the old host at runtime`);
}
if (!failures) pass('no unconverted elements, no nested anchors, no platform references');

// Assets and links must be page-relative, and must resolve on disk. A path
// starting with "/" is the bug that breaks file:// and Pages project sites.
const missing = new Set();
const internalLinks = new Set();
for (const f of htmlFiles) {
  const html = fs.readFileSync(f, 'utf8');
  const pageDir = path.dirname(f);

  for (const m of html.matchAll(/(?:src|href)="([^"]+)"/g)) {
    const target = m[1];
    if (/^(https?:|mailto:|data:|#)/.test(target)) continue;
    if (target.startsWith('/')) { fail(`${rel(f)}: root-relative path "${target}"`); continue; }

    const resolved = path.resolve(pageDir, target);
    if (/\.(css|woff2|jpg|jpeg|png|webp|svg|ico|xml|txt)$/.test(target)) {
      if (!fs.existsSync(resolved)) missing.add(`${rel(f)} -> ${target}`);
    } else {
      // an internal page link — now naming index.html directly, but tolerate a
      // bare directory too — reduced to its clean "/works/" form for comparison.
      const file = /\.html$/.test(target) ? resolved : path.join(resolved, 'index.html');
      internalLinks.add('/' + path.relative(OUT, file).replace(/\\/g, '/').replace(/index\.html$/, ''));
    }
  }
}
if (missing.size) { for (const m of missing) fail('missing asset ' + m); }
else pass('every referenced asset resolves on disk');

// CSS-referenced assets (fonts) resolve relative to the stylesheet itself
const cssPath = path.join(OUT, 'assets', 'styles.css');
if (fs.existsSync(cssPath)) {
  const css = fs.readFileSync(cssPath, 'utf8');
  let cssBad = 0;
  for (const m of css.matchAll(/url\(['"]?([^'")]+)['"]?\)/g)) {
    const u = m[1];
    if (/^(https?:|data:)/.test(u)) continue;
    if (u.startsWith('/')) { fail(`styles.css: root-relative url("${u}")`); cssBad++; continue; }
    if (!fs.existsSync(path.resolve(path.dirname(cssPath), u))) { fail(`styles.css: missing ${u}`); cssBad++; }
  }
  if (!cssBad) pass('stylesheet asset urls are relative and resolve');
}

// Every CJK character on a page must be in the vendored subset, or it renders in
// whatever face the reader happens to have — the gap the font was built to close.
// build/font-coverage.json is written by fetch-fonts.js, so this catches Korean
// text added since the font was last cut, and needs no Python to run in CI.
const COVERAGE = path.join(__dirname, 'font-coverage.json');
const CJK_BLOCKS = [
  [0x1100, 0x11ff], [0x3000, 0x303f], [0x3130, 0x318f], [0x3400, 0x4dbf],
  [0x4e00, 0x9fff], [0xac00, 0xd7af], [0xf900, 0xfaff], [0xff00, 0xffef],
];
const isCJK = c => CJK_BLOCKS.some(([a, b]) => c >= a && c <= b);

if (fs.existsSync(COVERAGE)) {
  const { font, codepoints } = JSON.parse(fs.readFileSync(COVERAGE, 'utf8'));
  const covered = new Set(codepoints);
  const uncovered = new Map();          // char -> first page it appears on

  for (const f of htmlFiles) {
    for (const ch of fs.readFileSync(f, 'utf8')) {
      const c = ch.codePointAt(0);
      if (isCJK(c) && !covered.has(c) && !uncovered.has(ch)) uncovered.set(ch, rel(f));
    }
  }

  if (!fs.existsSync(path.join(OUT, 'assets', 'fonts', font))) {
    fail(`font-coverage.json describes ${font}, which is not in site/assets/fonts/`);
  } else if (uncovered.size) {
    fail(`${uncovered.size} CJK character(s) are not in ${font} — run "npm run fonts"`);
    for (const [ch, where] of [...uncovered].slice(0, 12)) {
      console.log(`          ${ch}  U+${ch.codePointAt(0).toString(16).toUpperCase()}  first seen ${where}`);
    }
  } else {
    pass(`all CJK on the pages is covered by ${font} (${codepoints.length} characters)`);
  }
}

// internal page links that have no built page (expected while only part of the
// site is ported — reported, not fatal)
const built = new Set(htmlFiles.map(f => rel(f).replace(/index\.html$/, '')));
const dead = [...internalLinks].filter(l => !built.has(l.endsWith('/') ? l : l + '/'));
if (dead.length) {
  console.log(`\n  note  ${dead.length} link(s) point at pages not yet ported:`);
  for (const d of dead.sort()) console.log('          ' + d);
}

console.log(failures ? `\n${failures} FAILURE(S)` : '\nAll checks passed.');
process.exit(failures ? 1 : 0);
