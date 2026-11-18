// Face landmarks for every photograph in the Columbia Gaze Data Set, using the app's own model.
//
//   node research/gaze/extract_all.cjs --data <folder of dataset .jpg files> [--out landmarks_all.json] [--limit N]
//
// File names carry the labels: <person>_2m_<head>P_<vertical>V_<horizontal>H.jpg
const { chromium } = require('playwright');
const http = require('http');
const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
const option = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);
const data = option('--data');
const outFile = option('--out', 'landmarks_all.json');
const limit = Number(option('--limit', Infinity));
if (!data) {
  console.error('usage: node extract_all.cjs --data <folder> [--out file] [--limit N]');
  process.exit(1);
}

const root = path.join(__dirname, '..', '..');
const vision = path.join(root, 'node_modules', '@mediapipe', 'tasks-vision');
const model = path.join(root, 'public', 'mediapipe', 'face_landmarker.task');
const types = { '.html': 'text/html', '.mjs': 'text/javascript', '.js': 'text/javascript', '.wasm': 'application/wasm', '.jpg': 'image/jpeg' };

const server = http.createServer((request, response) => {
  const url = decodeURIComponent(request.url.split('?')[0]);
  let file;
  if (url === '/extract.html') file = path.join(__dirname, 'extract.html');
  else if (url === '/model/face_landmarker.task') file = model;
  else if (url.startsWith('/vision/')) file = path.join(vision, path.normalize(url.slice('/vision/'.length)).replace(/^(\.\.[/\\])+/, ''));
  else if (url.startsWith('/data/')) file = path.join(data, path.basename(url));
  if (!file || !fs.existsSync(file)) {
    response.writeHead(404);
    response.end();
    return;
  }
  response.writeHead(200, { 'content-type': types[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(response);
});

(async () => {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch();
  const page = await browser.newPage();
  page.on('pageerror', (error) => console.log('page error:', String(error).slice(0, 300)));
  await page.goto(`http://127.0.0.1:${server.address().port}/extract.html`);
  await page.waitForFunction(() => window.ready === true, null, { timeout: 60000 });
  const files = fs.readdirSync(data).filter((file) => file.endsWith('.jpg')).sort().slice(0, limit);
  // w200: as a front camera sees it. w200n: the same with sensor-like noise, for the jitter estimate.
  const variants = [
    { name: 'w200', W: 640, H: 480, faceW: 200 },
    { name: 'w200n', W: 640, H: 480, faceW: 200, noise: 10 },
  ];
  const out = [];
  const started = Date.now();
  for (let i = 0; i < files.length; i++) {
    const match = files[i].match(/^(\d+)_2m_(-?\d+)P_(-?\d+)V_(-?\d+)H\.jpg$/);
    if (!match) continue;
    const result = await page.evaluate(([url, v]) => window.extract(url, v), [`/data/${files[i]}`, variants]);
    out.push({ file: files[i], subj: match[1], P: +match[2], V: +match[3], H: +match[4], ...result });
    if (i % 200 === 0) console.log(i, '/', files.length, `${((Date.now() - started) / 1000).toFixed(0)}s`);
  }
  fs.writeFileSync(outFile, JSON.stringify(out));
  console.log('done:', out.length, 'photographs,', out.filter((item) => item.error).length, 'without a face');
  await browser.close();
  server.close();
})().catch((error) => {
  console.error('FAILED', error);
  process.exit(1);
});
