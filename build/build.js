'use strict';
// Renders the exported Cargo content to static HTML in site/.
// Nothing here reuses Cargo's frontend: only Bon's own text, images and layout
// intent are carried over, re-expressed in plain HTML + our own stylesheet.
const fs = require('fs');
const path = require('path');
const L = require('./lib');

const OUT = path.join(__dirname, '..', 'site');
const usedMedia = new Set();

// The site's authoritative origin, used for <link rel="canonical"> so the clean
// trailing-slash URL stays the one search engines and shares point at, even
// though the navigation links name index.html for offline browsing.
const SITE_ORIGIN = 'https://bon.kim';

// --- site furniture, taken from the pinned pages Cargo duplicated per set ----
const NAV = [
  { label: 'Works', purl: 'works-2' },
  { label: 'CV', purl: 'cv-' },
  { label: 'Contact', purl: 'contact' },
];

// Bon's own footer text, lifted from the corresponding pinned Cargo pages.
const FOOTER_HOME = L.convert(L.byPurl['footer-main'].content, { usedMedia });
const FOOTER_INNER = L.convert(L.byPurl['footer'].content, { usedMedia });

function nav(currentPurl) {
  const items = NAV.map(n => {
    const here = n.purl === currentPurl;
    return `<a href="${L.routeFor(n.purl)}"${here ? ' aria-current="page"' : ''}>${n.label}</a>`;
  });
  return `<nav class="site-nav">${items.join('<span class="sep">/</span>')}</nav>`;
}

function backdropFor(page) {
  const b = page.backdrops;
  if (!b || b.activeBackdrop !== 'wallpaper') return null;
  const w = b.backdropSettings && b.backdropSettings.wallpaper;
  if (!w || !w.activeImage) return null;
  const m = L.byHash[w.activeImage];
  if (!m) return null;
  usedMedia.add(m.hash);
  const align = (w.alignments && w.alignments[w.activeImage]) || { x: 50, y: 50 };
  return {
    url: L.mediaUrl(m),
    fit: w['image-fit'] === 'fill' ? 'cover' : 'contain',
    pos: `${align.x.toFixed(2)}% ${align.y.toFixed(2)}%`,
    alt: L.stripTags(m.name.replace(/\.[^.]+$/, '')),
  };
}

// Blocks IBM Plex Mono does not cover, so the CJK subset is what renders them.
const CJK_RE = /[ᄀ-ᇿ　-〿㄰-㆏㐀-䶿一-鿿가-힯豈-﫿＀-￯]/;

function layout({ title, purl, route, theme, backdrop, main, footer, description, hasCJK, kind }) {
  const bd = backdrop
    ? `<div class="backdrop"><img src="${backdrop.url}" alt="${L.escapeAttr(backdrop.alt)}" ` +
      `style="object-fit:${backdrop.fit};object-position:${backdrop.pos}" fetchpriority="high"></div>`
    : '';
  return `<!doctype html>
<html lang="en" class="theme-${theme}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${L.escapeAttr(title)}</title>
<meta name="description" content="${L.escapeAttr(description || '')}">
<link rel="canonical" href="${SITE_ORIGIN}${route}">
<link rel="alternate" type="application/rss+xml" title="Bon Kim — Works" href="/rss.xml">
<link rel="icon" href="/favicon.ico">
<link rel="preload" href="/assets/fonts/ibm-plex-mono-latin-600-normal.woff2" as="font" type="font/woff2" crossorigin>
${hasCJK ? `<link rel="preload" href="/assets/fonts/noto-sans-kr-cjk-subset.woff2" as="font" type="font/woff2" crossorigin>
` : ''}<link rel="stylesheet" href="/assets/styles.css">
</head>
<body class="kind-${kind}">
${bd}<header class="site-header">
<h1 class="site-title"><a href="/">Bon Kim</a></h1>
${nav(purl)}
</header>
<main class="site-main">
${main}
</main>
<footer class="site-footer">${footer}</footer>
</body>
</html>
`;
}

// Rewrite root-relative URLs to page-relative ones, and point page links at the
// actual index.html file. Two reasons:
//   1. Absolute paths only resolve at a domain root — they break on a Pages
//      project site (user.github.io/repo/) and when a file is opened off disk.
//   2. A link to a directory ("works/") needs a server to map it to the index;
//      naming the file ("works/index.html") also works over file://, so the
//      built pages can be clicked through by opening them directly. The clean
//      URL stays authoritative via <link rel="canonical">.
function relativize(html, route) {
  const depth = route === '/' ? 0 : route.replace(/^\/|\/$/g, '').split('/').length;
  const prefix = '../'.repeat(depth);
  return html.replace(/(src|href)="\/([^"]*)"/g, (full, attr, rest) => {
    // A page route is the root ("") or ends in "/"; assets carry a filename.
    const isPage = rest === '' || rest.endsWith('/');
    const target = prefix + rest + (isPage ? 'index.html' : '');
    return `${attr}="${target || 'index.html'}"`;
  });
}

function writePage(route, html) {
  const dir = path.join(OUT, route === '/' ? '' : route.replace(/^\/|\/$/g, ''));
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'index.html'), html);
  return path.relative(OUT, path.join(dir, 'index.html')).replace(/\\/g, '/');
}

// Cargo has separate copies of the work pages for small screens. Their lead
// titles use a dedicated mobile scale (with two intentional exceptions), while
// the rest of their content is substantially the same. Mark the corresponding
// heading in our single responsive page so CSS can reproduce that treatment.
function markWorkTitle(html, purl) {
  const modifier = purl === 'franz-kafka-ein-landarzt'
    ? ' work-title--compact'
    : purl === 'mourning-heat-(열곡(熱哭)),-2024'
      ? ' work-title--mourning'
      : '';

  return html
    .replace(/<h1(?=[\s>])/, `<h1 class="work-title${modifier}"`)
    .replace(/(<h1 class="work-title[^>]*>)[ \t]+\n/, '$1\n');
}

// ---------------------------------------------------------------------------
const built = [];
for (const [purl, route] of Object.entries(L.ROUTES)) {
  const page = L.byPurl[purl];
  if (!page) { console.warn('  !! no page for purl', purl); continue; }

  const isHome = route === '/';
  const backdrop = backdropFor(page);
  let body = L.convert(page.content, { usedMedia, title: L.stripTags(page.title) });
  if (route.startsWith('/work/')) body = markWorkTitle(body, purl);

  // A gallery index runs full-bleed; prose pages keep the narrower measure.
  const isGalleryIndex = /<div class="gallery gallery-masonry/.test(body) && !/<column-set/.test(body);

  const main = isHome
    ? ''                                  // the homepage is the wallpaper itself
    : `<article class="page${isGalleryIndex ? ' page-gallery' : ''}">${body}</article>`;

  const html = layout({
    title: isHome ? 'Bon Kim' : `${L.stripTags(page.title)} — Bon Kim`,
    purl,
    route,
    theme: backdrop ? 'dark' : 'light',   // white type over photo vs. black on grey
    backdrop,
    main,
    footer: isHome ? FOOTER_HOME : FOOTER_INNER,
    description: isHome ? 'Bon Kim — artist portfolio.' : L.stripTags(page.title),
    // Only where CJK actually appears: the stylesheet's unicode-range already
    // keeps the file off Latin-only pages, and preloading it there would pull
    // 77KB nothing renders with.
    hasCJK: CJK_RE.test(page.title || '') || CJK_RE.test(body),
    // The original does not give every page the same chrome: work pages sit
    // under a taller pinned header, and the CV runs to a narrower measure.
    // Measured on the original at 1440px -- see styles.css.
    kind: route === '/'              ? 'home'
        : route.startsWith('/work/') ? 'work'
        : route === '/cv/'           ? 'cv'
        : isGalleryIndex             ? 'gallery'
        : 'page',
  });

  built.push({
    file: writePage(route, relativize(html, route)),
    route,
    title: L.stripTags(page.title),
    // First bit of running text, for the feed's item summary.
    summary: L.stripTags(body).slice(0, 320).trim(),
  });
}

// --- rss --------------------------------------------------------------------
// A feed of the works, in the order the works index lists them — which is Bon's
// own ordering.
//
// Deliberately no <pubDate>. Cargo's export carries no publication date for any
// page; the only timestamps anywhere are media upload times, and those record
// the bulk migration onto Cargo rather than when a work was made or shown —
// "A Chair for Co-responding, 2022" uploaded in December 2024, the 2016 drawings
// in January 2025. Feeding those to a reader would date a 2016 series to last
// year and sort the whole feed by migration order. Four of the essay pages have
// no media at all, so they would have no date even then. pubDate is optional in
// RSS 2.0, so the honest feed simply omits it and keeps the artist's order.
const xml = s => String(s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;')
  .replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const feedItems = built
  .filter(b => b.route.startsWith('/work/'))
  .map(b => `  <item>
    <title>${xml(b.title)}</title>
    <link>${SITE_ORIGIN}${b.route}</link>
    <guid isPermaLink="true">${SITE_ORIGIN}${b.route}</guid>
    <description>${xml(b.summary)}</description>
  </item>
`)
  .join('');

fs.writeFileSync(path.join(OUT, 'rss.xml'),
`<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
<channel>
  <title>Bon Kim — Works</title>
  <link>${SITE_ORIGIN}/works/</link>
  <atom:link href="${SITE_ORIGIN}/rss.xml" rel="self" type="application/rss+xml"/>
  <description>Works by Bon Kim.</description>
  <language>en</language>
${feedItems}</channel>
</rss>
`);

fs.mkdirSync(path.join(OUT, 'assets'), { recursive: true });
fs.copyFileSync(path.join(__dirname, '..', 'src', 'styles.css'), path.join(OUT, 'assets', 'styles.css'));

fs.writeFileSync(
  path.join(__dirname, 'used-media.json'),
  JSON.stringify([...usedMedia], null, 1)
);

console.log('Built pages:');
for (const b of built) console.log(`  ${b.route.padEnd(26)} -> site/${b.file}`);
console.log(`\n${usedMedia.size} media referenced -> build/used-media.json`);
console.log(`${built.filter(b => b.route.startsWith('/work/')).length} works -> site/rss.xml`);
