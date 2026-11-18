// One-off: renders public/icons/icon.svg to the PNG sizes phones ask for.
// Needs Playwright with Chromium (`npx playwright install chromium`). The PNGs are committed.
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

(async () => {
  const dir = path.join(__dirname, '..', 'public', 'icons');
  const svg = fs.readFileSync(path.join(dir, 'icon.svg'), 'utf8');
  // "Maskable" icons are cropped to a circle or squircle by the phone, so the artwork sits inside a full-bleed square.
  const maskable = svg.replace('rx="112"', 'rx="0"').replace('<path d="M168', '<g transform="translate(51 51) scale(0.8)"><path d="M168').replace('</g></svg>', '</g></g></svg>');
  const browser = await chromium.launch();
  const jobs = [
    ['icon-192.png', 192, svg],
    ['icon-512.png', 512, svg],
    ['apple-touch-icon.png', 180, svg.replace('rx="112"', 'rx="0"')],
    ['icon-maskable-512.png', 512, maskable],
  ];
  for (const [name, size, source] of jobs) {
    const page = await browser.newPage({ viewport: { width: size, height: size }, deviceScaleFactor: 1 });
    await page.setContent(`<body style="margin:0;background:transparent">${source.replace('<svg ', `<svg width="${size}" height="${size}" `)}</body>`);
    await page.screenshot({ path: path.join(dir, name), omitBackground: true });
    await page.close();
  }
  await browser.close();
  console.log('icons written');
})();
