'use strict';
// Shared model: loads the exported content, maps pages to clean URLs, and
// rewrites Cargo's custom elements into plain semantic HTML.
const fs = require('fs');
const path = require('path');

const DATA = path.join(__dirname, 'data');
const pages = JSON.parse(fs.readFileSync(path.join(DATA, 'pages.json'), 'utf8'));
const media = JSON.parse(fs.readFileSync(path.join(DATA, 'media.json'), 'utf8'));

const byPurl = Object.fromEntries(pages.filter(p => p.purl).map(p => [p.purl, p]));
const byHash = Object.fromEntries(media.map(m => [m.hash, m]));

// Cargo urls are case-insensitive; this maps a lowercased purl back to its exact
// form so links that differ only in case (e.g. Water-in-the-(h)air-1) resolve.
const purlByLower = {};
for (const p of pages) if (p.purl) purlByLower[p.purl.toLowerCase()] = p.purl;

// Cargo keeps hand-maintained mobile twins of each page; the rebuild is
// responsive, so the twins collapse into their desktop original.
const MOBILE_TWINS = {
  'mobile-works': 'works-2',
  'weathered-buddha-1': 'weathered-buddha',
  'mourning-heat-(열곡(熱哭)),-2024-1': 'mourning-heat-(열곡(熱哭)),-2024',
  'index-mobile': 'index',
  'cv-mobile-1': 'cv-',
  'contact-mobile-1': 'contact',
};

function slugify(s) {
  return String(s).toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'page';
}

// Any incoming link -> the exact purl of the page it addresses: strip slashes,
// url-decode, fix case, then collapse a mobile twin onto its desktop original.
function canonicalPurl(raw) {
  let key = decodeURIComponent(String(raw)).replace(/^\/+|\/+$/g, '');
  key = purlByLower[key.toLowerCase()] || key;
  return MOBILE_TWINS[key] || key;
}

// The fixed pages plus a clean slug for two works already published under a
// shorter URL; every other work slug is derived from its purl.
// `exhibitions` is public on the original but linked from nothing — not the nav,
// not any page — so the crawl below can never reach it. It is seeded here so the
// URL resolves, exactly as it does on the original. It is deliberately absent
// from NAV in build.js, because the original's nav does not carry it either.
const FIXED_ROUTES = {
  'index': '/',
  'works-2': '/works/',
  'cv-': '/cv/',
  'contact': '/contact/',
  'exhibitions': '/exhibitions/',
};
const WORK_SLUG_OVERRIDES = {
  'mourning-heat-(열곡(熱哭)),-2024': 'mourning-heat',
};

function historyLinks(html) {
  const out = [];
  const re = /href="([^"]+)"[^>]*rel="history"/g;
  let m;
  while ((m = re.exec(html || ''))) out.push(m[1]);
  return out;
}

// Route table, computed once: the fixed pages, then a /work/<slug>/ for every
// work page reachable from them by following in-site links (breadth-first, so
// works linked only from another work page — e.g. the Mourning Heat essays —
// are included too). Slugs are made unique and stored, so routeFor is a lookup
// and every caller agrees on the same URL.
const ROUTES = { ...FIXED_ROUTES };
{
  const usedSlugs = new Set(['', 'works', 'cv', 'contact', 'exhibitions', 'work', 'assets']);
  const seen = new Set(Object.keys(FIXED_ROUTES));
  const queue = Object.keys(FIXED_ROUTES).filter(p => byPurl[p]);

  while (queue.length) {
    const page = byPurl[queue.shift()];
    for (const href of historyLinks(page.content)) {
      const cp = canonicalPurl(href);
      if (seen.has(cp) || !byPurl[cp]) continue;
      seen.add(cp);
      let slug = WORK_SLUG_OVERRIDES[cp] || slugify(cp);
      for (let base = slug, i = 2; usedSlugs.has(slug); i++) slug = `${base}-${i}`;
      usedSlugs.add(slug);
      ROUTES[cp] = `/work/${slug}/`;
      queue.push(cp);
    }
  }
}

// purl (or any internal link) -> output URL.
function routeFor(raw) {
  const cp = canonicalPurl(raw);
  if (ROUTES[cp]) return ROUTES[cp];
  // A linked page outside the built set (e.g. exhibitions): best-effort slug.
  return '/work/' + (WORK_SLUG_OVERRIDES[cp] || slugify(cp)) + '/';
}

// Output format for a media item. Cargo's resizer won't transcode, so PNGs —
// which here are all photographic screenshots — are converted to WebP locally
// at fetch time; they shrink several-fold and WebP is universally supported.
// JPEG stays JPEG, SVG stays vector.
function outputExt(m) {
  const ext = (m.file_type || 'jpg').toLowerCase().replace('jpeg', 'jpg');
  return ext === 'png' ? 'webp' : ext;
}

// Local filename for a media item; hash prefix keeps it unique and stable.
// Some items carry no name at all (Cargo stores it as a bare ".jpg"), which
// strips to nothing — name those 'image' rather than letting slugify's generic
// 'page' fallback through.
function mediaFile(m) {
  const base = slugify(String(m.name || '').replace(/\.[^.]+$/, '') || 'image').slice(0, 40);
  return `${m.hash.slice(0, 10).toLowerCase()}-${base}.${outputExt(m)}`;
}
const mediaUrl = m => '/assets/media/' + mediaFile(m);

function parseAttrs(tag) {
  const attrs = {};
  const re = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*=\s*"([^"]*)"/g;
  let m;
  while ((m = re.exec(tag))) attrs[m[1]] = m[2];
  return attrs;
}

const escapeAttr = s => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
const stripTags = s => String(s).replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();

// Cargo captions carry their own <a> to the same target as the thumbnail. Once
// the figure is wrapped in a link those become nested anchors, which is invalid
// and which browsers unnest — so demote them to styled spans and keep the wrap.
function anchorsToSpans(html) {
  return html
    .replace(/<a\b([^>]*)>/g, (full, attrs) => {
      const style = (attrs.match(/\sstyle="([^"]*)"/) || [])[1];
      return style ? `<span style="${style}">` : '<span>';
    })
    .replace(/<\/a>/g, '</span>');
}

// A freight.cargo.site URL points at one of Bon's own images; resolve it to the
// local copy so the built site never calls out to Cargo at runtime.
function localizeFreight(href, usedMedia) {
  const m = /freight\.cargo\.site\/[^"]*?\/i\/([A-Za-z0-9]+)\//.exec(href || '');
  if (!m) return null;
  const item = byHash[m[1]];
  if (!item) return null;
  if (usedMedia) usedMedia.add(item.hash);
  return mediaUrl(item);
}

// Rewrite in-site links (Cargo marks them rel="history") to clean URLs, and
// point any lightbox/quick-view link at the local image.
function rewriteLinks(html, usedMedia) {
  return html
    .replace(/href="([^"]*)"([^>]*?)\srel="history"/g, (full, href, rest) =>
      `href="${escapeAttr(routeFor(href))}"${rest}`)
    .replace(/href="(https:\/\/freight\.cargo\.site\/[^"]*)"/g, (full, href) => {
      const local = localizeFreight(href, usedMedia);
      return local ? `href="${escapeAttr(local)}"` : full;
    });
}

// --- galleries -------------------------------------------------------------
// The original packs thumbnails into columns with a scripted masonry: each item
// drops into the shortest column, and a featured item may span two. Aspect
// ratios are all known here, so the same packing is computed at build time and
// written out as container-query units — identical layout, no runtime script.
const GALLERY_COLS = [3, 2, 1];   // desktop, tablet, phone
const GAP_CQW = 1.8;              // gutter as a share of gallery width (~26/1388)

// Geometry is emitted in cqw: 1cqw == 1% of the gallery's own width, so a single
// packing scales fluidly and only the column count changes at a breakpoint.
function packMasonry(items, cols) {
  const gap = GAP_CQW;
  const colW = (100 - gap * (cols - 1)) / cols;
  const colY = new Array(cols).fill(0);
  const boxes = [];

  for (const it of items) {
    const span = Math.min(it.span, cols);
    let start = 0, top = Infinity;
    for (let s = 0; s + span <= cols; s++) {
      const y = Math.max(...colY.slice(s, s + span));   // shortest run of columns
      // Leftmost of equally short runs. Where two columns tie the original
      // sometimes settles the other way, so same-height neighbours can swap
      // places; column geometry and packing density are unaffected.
      if (y < top - 1e-9) { top = y; start = s; }
    }
    const w = colW * span + gap * (span - 1);
    const h = w / it.ar;
    boxes.push({ x: start * (colW + gap), y: top, w });
    for (let s = start; s < start + span; s++) colY[s] = top + h + gap;
  }
  return { boxes, height: Math.max(0, Math.max(...colY, 0) - gap) };
}

// A media-item renders if it is an image or an embedded video url; anything
// else (placeholder, stray reference) is dropped.
const isRenderable = m => m && (m.is_image || m.is_url);

function parseGalleryItems(inner, usedMedia) {
  const items = [];
  const re = /<media-item([^>]*)>([\s\S]*?)<\/media-item>/g;
  let m;
  while ((m = re.exec(inner))) {
    const a = parseAttrs(m[1]);
    const media = byHash[a.hash];
    if (!isRenderable(media)) continue;
    if (media.is_image) usedMedia.add(media.hash);   // url embeds have no local file
    items.push({
      attrs: a,
      inner: m[2],
      media,
      span: Math.max(1, parseInt(a['columnized-span'], 10) || 1),
      ar: (media.width || 16) / (media.height || 9),
    });
  }
  return items;
}

// An embedded video url -> a lazy, responsive iframe. Only YouTube appears in
// this dataset; the shape generalizes to Vimeo if it ever does. The player is
// the one intentional third-party runtime dependency — video can't be self-hosted.
function videoEmbed(m) {
  if (m.url_type === 'youtube' && m.url_id) {
    const src = `https://www.youtube-nocookie.com/embed/${encodeURIComponent(m.url_id)}`;
    return `<iframe class="video" src="${src}" title="${escapeAttr(stripTags(m.name))}" ` +
      `loading="lazy" allow="accelerometer; autoplay; clipboard-write; encrypted-media; ` +
      `gyroscope; picture-in-picture" allowfullscreen></iframe>`;
  }
  if (m.url_type === 'vimeo' && m.url_id) {
    const src = `https://player.vimeo.com/video/${encodeURIComponent(m.url_id)}`;
    return `<iframe class="video" src="${src}" title="${escapeAttr(stripTags(m.name))}" ` +
      `loading="lazy" allow="autoplay; fullscreen; picture-in-picture" allowfullscreen></iframe>`;
  }
  // Unknown provider: a plain link out rather than a broken frame.
  return `<a class="video-link" href="${escapeAttr(m.url || '#')}" target="_blank" rel="noopener">${escapeAttr(stripTags(m.name))}</a>`;
}

// One <figure>. `vars` carries per-breakpoint geometry when inside a masonry;
// `pageTitle` is the last-resort alt text.
function figureFor(it, usedMedia, vars, pageTitle) {
  const m = it.media;
  const a = it.attrs;

  const capMatch = it.inner.match(/<figcaption[^>]*>([\s\S]*?)<\/figcaption>/);
  const caption = capMatch ? rewriteLinks(capMatch[1], usedMedia) : '';
  // Best available description: the caption, else the image's own name, else the
  // title of the page it sits on. Both of the first two can reduce to nothing —
  // some media are unnamed, and some captions are markup with no text — and an
  // empty alt would announce a portfolio photograph as decorative.
  const alt = stripTags(caption) ||
              stripTags(String(m.name || '').replace(/\.[^.]+$/, '')) ||
              pageTitle || '';

  const styleParts = [`--ar:${(m.width || 16)}/${(m.height || 9)}`];
  // scale="50%" makes an image take half its column, so two sit side by side.
  if (/^[\d.]+%$/.test(a.scale || '')) styleParts.push(`--scale:${a.scale}`);
  styleParts.push(...(vars || []));
  const style = styleParts.join(';');

  // A video embed fills its figure like an image, but is never link-wrapped —
  // the player is interactive on its own.
  if (m.is_url) {
    const cap = caption ? `<figcaption class="caption">${caption}</figcaption>` : '';
    return `<figure class="media-item video-item" style="${style}">${videoEmbed(m)}${cap}</figure>`;
  }

  const img = `<img src="${mediaUrl(m)}" width="${m.width}" height="${m.height}" ` +
              `alt="${escapeAttr(alt)}" loading="lazy" decoding="async">`;

  if (a.href) {
    const local = localizeFreight(a.href, usedMedia);      // quick-view -> local file
    const external = !local && /^https?:|^mailto:/.test(a.href);
    const href = local || (external ? a.href : routeFor(a.href));
    const target = external ? ' target="_blank" rel="noopener"' : '';
    const body = caption
      ? `${img}<figcaption class="caption">${anchorsToSpans(caption)}</figcaption>`
      : img;
    return `<figure class="media-item linked" style="${style}">` +
           `<a href="${escapeAttr(href)}"${target}>${body}</a></figure>`;
  }

  const body = caption ? `${img}<figcaption class="caption">${caption}</figcaption>` : img;
  return `<figure class="media-item" style="${style}">${body}</figure>`;
}

function renderGalleries(html, { usedMedia, title }) {
  return html.replace(
    /<gallery-(columnized|grid)([^>]*)>([\s\S]*?)<\/gallery-\1>/g,
    (full, kind, attrStr, inner) => {
      const a = parseAttrs(attrStr);
      const items = parseGalleryItems(inner, usedMedia);
      if (!items.length) return '';

      const packs = GALLERY_COLS.map(c => packMasonry(items, c));

      const figures = items.map((it, i) => {
        const vars = [];
        packs.forEach((p, k) => {
          const b = p.boxes[i];
          const n = GALLERY_COLS[k];
          vars.push(`--x${n}:${b.x.toFixed(3)}`, `--y${n}:${b.y.toFixed(3)}`, `--w${n}:${b.w.toFixed(3)}`);
        });
        return figureFor(it, usedMedia, vars, title);
      });

      const heights = packs
        .map((p, k) => `--h${GALLERY_COLS[k]}:${p.height.toFixed(3)}`)
        .join(';');
      const extra = (a.class || '').trim();
      return `<div class="gallery gallery-masonry ${extra}" style="${heights}">${figures.join('')}</div>`;
    }
  );
}

// media-items outside any gallery: plain figures in normal flow.
function renderLooseMediaItems(html, { usedMedia, title }) {
  return html.replace(/<media-item([^>]*)>([\s\S]*?)<\/media-item>/g, (full, attrStr, inner) => {
    const a = parseAttrs(attrStr);
    const media = byHash[a.hash];
    if (!isRenderable(media)) return '';
    if (media.is_image) usedMedia.add(media.hash);
    return figureFor({ attrs: a, inner, media, span: 1, ar: (media.width || 16) / (media.height || 9) }, usedMedia, null, title);
  });
}

// Cargo's layout elements -> divs my own stylesheet knows how to lay out.
function renderLayout(html) {
  return html
    .replace(/<column-set([^>]*)>/g, (f, at) => {
      const a = parseAttrs(at);
      // Cargo writes gutter either as a bare number (rem) or an explicit length.
      const g = a.gutter && (/^[\d.]+$/.test(a.gutter) ? a.gutter + 'rem' : a.gutter);
      return `<div class="column-set"${g ? ` style="--gutter:${escapeAttr(g)}"` : ''}>`;
    })
    .replace(/<\/column-set>/g, '</div>')
    .replace(/<column-unit([^>]*)>/g, (f, at) => {
      const a = parseAttrs(at);
      // span is a unit's share of the row (of 12). A unit with no span shares
      // the row equally with its siblings, so it flexes as 1 rather than filling.
      const raw = parseInt(a.span, 10);
      const span = raw ? Math.min(12, Math.max(1, raw)) : 1;
      return `<div class="column-unit" style="--span:${span}">`;
    })
    .replace(/<\/column-unit>/g, '</div>')
    .replace(/<text-icon[^>]*>([\s\S]*?)<\/text-icon>/g, '<span class="text-icon">$1</span>');
}

function convert(html, opts) {
  const usedMedia = opts.usedMedia;
  const title = opts.title || '';   // last-resort alt text for images
  let out = String(html || '');
  out = renderGalleries(out, { usedMedia, title });  // galleries first: they own their items
  out = renderLooseMediaItems(out, { usedMedia, title });
  out = renderLayout(out);
  out = rewriteLinks(out, usedMedia);
  return out;
}

// Only what the build scripts consume; the rest are internal helpers.
module.exports = {
  byPurl, byHash, ROUTES,
  routeFor, mediaFile, mediaUrl, outputExt, convert, stripTags, escapeAttr,
};
