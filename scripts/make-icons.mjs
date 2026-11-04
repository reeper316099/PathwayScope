// Generates build/icon.png (1024), build/icon.ico and build/icon.icns from build/icon.svg.
// The .icns step needs macOS (`iconutil`); on Linux/Windows it is skipped with a message (see README for the documented workaround).
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import electronPath from 'electron';

const root = path.resolve(import.meta.dirname, '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ps-icons-'));
execFileSync(electronPath, [path.join(root, 'scripts', 'render-icon.cjs'), tmp], {
  stdio: 'inherit',
});
const png = (size) => fs.readFileSync(path.join(tmp, `icon-${size}.png`));

fs.copyFileSync(path.join(tmp, 'icon-1024.png'), path.join(root, 'build', 'icon.png'));

// Builds a Windows .ico that embeds PNG frames (supported since Windows Vista).
function buildIco(sizes) {
  const images = sizes.map(png);
  const header = Buffer.alloc(6);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);
  let offset = 6 + images.length * 16;
  const entries = images.map((data, i) => {
    const entry = Buffer.alloc(16);
    entry.writeUInt8(sizes[i] >= 256 ? 0 : sizes[i], 0);
    entry.writeUInt8(sizes[i] >= 256 ? 0 : sizes[i], 1);
    entry.writeUInt16LE(1, 4);
    entry.writeUInt16LE(32, 6);
    entry.writeUInt32LE(data.length, 8);
    entry.writeUInt32LE(offset, 12);
    offset += data.length;
    return entry;
  });
  return Buffer.concat([header, ...entries, ...images]);
}
fs.writeFileSync(path.join(root, 'build', 'icon.ico'), buildIco([16, 32, 48, 64, 128, 256]));

// macOS .icns via an .iconset folder and Apple's iconutil.
if (process.platform === 'darwin') {
  const set = path.join(tmp, 'icon.iconset');
  fs.mkdirSync(set);
  const map = {
    'icon_16x16.png': 16,
    'icon_16x16@2x.png': 32,
    'icon_32x32.png': 32,
    'icon_32x32@2x.png': 64,
    'icon_128x128.png': 128,
    'icon_128x128@2x.png': 256,
    'icon_256x256.png': 256,
    'icon_256x256@2x.png': 512,
    'icon_512x512.png': 512,
    'icon_512x512@2x.png': 1024,
  };
  for (const [name, size] of Object.entries(map)) fs.writeFileSync(path.join(set, name), png(size));
  const result = spawnSync(
    'iconutil',
    ['-c', 'icns', set, '-o', path.join(root, 'build', 'icon.icns')],
    { stdio: 'inherit' },
  );
  if (result.status !== 0) console.warn('iconutil failed; icon.icns was not generated.');
} else {
  console.warn(
    'Skipping icon.icns: iconutil is macOS-only. Generate it on a Mac, or use a tool such as png2icns / electron-icon-builder from build/icon.png.',
  );
}
console.log('Icons written to build/.');
