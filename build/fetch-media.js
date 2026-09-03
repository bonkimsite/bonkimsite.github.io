'use strict';
// Downloads the images referenced by the built pages into site/assets/media/.
// Run once after build.js. The originals total ~723MB (one is 13,153px wide),
// which is absurd to serve and awkward to keep in git, so each is pulled at a
// sane display width. Output is plain files: the built site never calls the old
// host at runtime.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const L = require('./lib');

const OUT = path.join(__dirname, '..', 'site', 'assets', 'media');
const MAX_W = 1800;      // ample for a 2x retina thumbnail column
const QUALITY = 82;
const UA = 'bon-kim-site-build/1.0';

const used = JSON.parse(fs.readFileSync(path.join(__dirname, 'used-media.json'), 'utf8'));

// Bon's images live on the old host's CDN. Vector art has nothing to resize.
function sourceUrl(m) {
  const name = encodeURIComponent(m.name);
  if (m.file_type === 'svg' || m.width <= MAX_W) {
    return `https://freight.cargo.site/t/original/i/${m.hash}/${name}`;
  }
  return `https://freight.cargo.site/w/${MAX_W}/q/${QUALITY}/i/${m.hash}/${name}`;
}

// PNGs are transcoded to WebP with ImageMagick (see lib.outputExt). Detected
// once so the fetch degrades gracefully to keeping PNGs if it is absent.
function magickCmd() {
  for (const c of ['magick', 'convert']) {
    try { execFileSync(c, ['-version'], { stdio: 'ignore' }); return c; }
    catch { /* try next */ }
  }
  return null;
}
const MAGICK = magickCmd();

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  let downloaded = 0, skipped = 0, bytes = 0, originals = 0, converted = 0;
  let warnedNoMagick = false;

  for (const hash of used) {
    const m = L.byHash[hash];
    if (!m) { console.warn('  !! unknown media hash', hash); continue; }

    const dest = path.join(OUT, L.mediaFile(m));
    originals += m.file_size || 0;

    if (fs.existsSync(dest)) {
      bytes += fs.statSync(dest).size;
      skipped++;
      continue;
    }

    const res = await fetch(sourceUrl(m), { headers: { 'User-Agent': UA } });
    if (!res.ok) { console.error(`  !! ${m.name} -> HTTP ${res.status}`); continue; }
    const buf = Buffer.from(await res.arrayBuffer());

    const toWebp = L.outputExt(m) === 'webp';
    let out;
    if (toWebp && MAGICK) {
      const tmp = path.join(os.tmpdir(), `bk-${m.hash.slice(0, 10)}.png`);
      fs.writeFileSync(tmp, buf);
      execFileSync(MAGICK, [tmp, '-quality', String(QUALITY), dest]);
      fs.unlinkSync(tmp);
      out = fs.readFileSync(dest);
      converted++;
    } else {
      if (toWebp && !warnedNoMagick) {
        console.warn('  !! ImageMagick not found: keeping PNGs uncompressed');
        warnedNoMagick = true;
      }
      fs.writeFileSync(dest, buf);
      out = buf;
    }

    bytes += out.length;
    downloaded++;
    const from = m.file_size ? `${(m.file_size / 1e6).toFixed(1)}MB` : '?';
    console.log(`  ${L.mediaFile(m)} (${from} -> ${(out.length / 1e6).toFixed(2)}MB${toWebp && MAGICK ? ', webp' : ''})`);
  }

  console.log(`\n${downloaded} downloaded (${converted} transcoded to webp), ${skipped} already present`);
  console.log(`originals ${(originals / 1e6).toFixed(1)}MB -> local ${(bytes / 1e6).toFixed(1)}MB`);
})();
