// Runs inside Electron (no window shown): renders build/icon.svg to PNG files of several sizes into the folder given as argv[2].
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

const SIZES = [16, 32, 48, 64, 128, 256, 512, 1024];
const outDir = process.argv[2];
const svg = fs.readFileSync(path.join(__dirname, '..', 'build', 'icon.svg'), 'utf8');

// Renders the SVG at one pixel size in the shared hidden window and writes icon-<size>.png.
async function renderSize(win, size) {
  win.setContentSize(size, size);
  const html = `<html><body style="margin:0;background:transparent;overflow:hidden">${svg.replace('<svg ', `<svg width="${size}" height="${size}" `)}</body></html>`;
  const page = path.join(outDir, `page-${size}.html`);
  fs.writeFileSync(page, html);
  await win.loadFile(page);
  await new Promise((resolve) => setTimeout(resolve, 200));
  const image = await win.webContents.capturePage({ x: 0, y: 0, width: size, height: size });
  // Retina displays capture at 2x pixels, so resize to the exact target size.
  const exact =
    image.getSize().width === size
      ? image
      : image.resize({ width: size, height: size, quality: 'best' });
  fs.writeFileSync(path.join(outDir, `icon-${size}.png`), exact.toPNG());
}

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    show: false,
    width: 1024,
    height: 1024,
    useContentSize: true,
    transparent: true,
    frame: false,
  });
  for (const size of SIZES) await renderSize(win, size);
  app.quit();
});
