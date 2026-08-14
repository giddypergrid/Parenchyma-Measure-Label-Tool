const fs = require('fs');
const path = require('path');

// the name becomes a folder, so strip characters Windows rejects
const safeName = (n) =>
  (String(n).replace(/[\\/:*?"<>|]/g, '-').replace(/[. ]+$/, '').trim() || 'unnamed').slice(0, 80);

// only formats Chromium can actually draw — a TIFF would import but never display
const isStill = (f) => /\.(png|jpe?g|bmp|webp)$/i.test(f);

/**
 * Copy still images into the project, one folder per image so that deleting a
 * capture removes exactly its own files — the same layout a clip gets.
 */
function importImages({ files, baseDir }) {
  fs.mkdirSync(baseDir, { recursive: true });
  const taken = new Set(
    fs.readdirSync(baseDir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name)
  );
  return files.map((src) => {
    const base = safeName(path.basename(src).replace(/\.[^.]+$/, ''));
    let clip = base;
    for (let n = 2; taken.has(clip); n++) clip = `${base}-${n}`;
    taken.add(clip);
    const outDir = path.join(baseDir, clip);
    fs.mkdirSync(outDir, { recursive: true });
    const dest = path.join(outDir, path.basename(src));
    if (path.resolve(dest) !== path.resolve(src)) fs.copyFileSync(src, dest);
    return { clip, framesDir: outDir, imagePath: dest };
  });
}

/** Stills already sitting in a folder, in filename order. */
function listStills(dirPath) {
  if (!fs.existsSync(dirPath)) return [];
  return fs.readdirSync(dirPath).filter(isStill).sort().map((f) => path.join(dirPath, f));
}

module.exports = { safeName, isStill, importImages, listStills };
