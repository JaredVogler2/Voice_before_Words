// Turn the data set's photographs of one person into camera-like frames for simulate.cjs:
// 640x480 with the face about 200 px wide, one fixed crop per head position (the head was on
// a chin rest, so it does not move between photographs).
//
//   node research/gaze/in-app/prepare_frames.cjs --data <folder of dataset .jpg files> --out <folder> --person 0003
//
// The frames are photographs of a person. Keep them out of the repository.
const { chromium } = require('playwright');
const http = require('http');
const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
const option = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);
const data = option('--data');
const out = option('--out');
const person = option('--person');
if (!data || !out || !person) {
  console.error('usage: node prepare_frames.cjs --data <folder> --out <folder> --person <id, e.g. 0003>');
  process.exit(1);
}

const root = path.join(__dirname, '..', '..', '..');
const vision = path.join(root, 'node_modules', '@mediapipe', 'tasks-vision');
const model = path.join(root, 'public', 'mediapipe', 'face_landmarker.task');
const types = { '.mjs': 'text/javascript', '.js': 'text/javascript', '.wasm': 'application/wasm', '.jpg': 'image/jpeg' };

const PAGE = `<!doctype html><html><body><canvas id="c"></canvas><script type="module">
import { FaceLandmarker, FilesetResolver } from '/vision/vision_bundle.mjs';
const fileset = await FilesetResolver.forVisionTasks('/vision/wasm');
const landmarker = await FaceLandmarker.createFromOptions(fileset, { baseOptions: { modelAssetPath: '/model/face_landmarker.task', delegate: 'CPU' }, runningMode: 'IMAGE', numFaces: 1 });
const load = async (url) => createImageBitmap(await (await fetch(url)).blob());
const canvas = document.getElementById('c');
const context = canvas.getContext('2d');
// Where the face is in the straight-ahead photograph for a head position.
window.locate = async (url) => {
  const bitmap = await load(url);
  const scale = 1280 / bitmap.width;
  canvas.width = 1280;
  canvas.height = Math.round(bitmap.height * scale);
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  const found = landmarker.detect(canvas);
  if (!found.faceLandmarks.length) return null;
  const lm = found.faceLandmarks[0];
  const left = lm[234].x * bitmap.width;
  const right = lm[454].x * bitmap.width;
  return { faceWidth: Math.abs(right - left), cx: (left + right) / 2, cy: ((lm[10].y + lm[152].y) / 2) * bitmap.height };
};
window.render = async (url, crop) => {
  const bitmap = await load(url);
  const scale = 200 / crop.faceWidth;
  canvas.width = 640;
  canvas.height = 480;
  context.fillStyle = '#000';
  context.fillRect(0, 0, 640, 480);
  context.imageSmoothingQuality = 'high';
  context.drawImage(bitmap, 320 - crop.cx * scale, 480 * 0.45 - crop.cy * scale, bitmap.width * scale, bitmap.height * scale);
  return canvas.toDataURL('image/jpeg', 0.92);
};
window.ready = true;
</script></body></html>`;

const server = http.createServer((request, response) => {
  const url = decodeURIComponent(request.url.split('?')[0]);
  if (url === '/page.html') {
    response.writeHead(200, { 'content-type': 'text/html' });
    response.end(PAGE);
    return;
  }
  let file;
  if (url === '/model/face_landmarker.task') file = model;
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
  await page.goto(`http://127.0.0.1:${server.address().port}/page.html`);
  await page.waitForFunction(() => window.ready === true, null, { timeout: 60000 });
  fs.mkdirSync(out, { recursive: true });
  let written = 0;
  for (const head of [-15, 0, 15]) {
    const crop = await page.evaluate((url) => window.locate(url), `/data/${person}_2m_${head}P_0V_0H.jpg`);
    if (!crop) {
      console.log(`no face found for head position ${head}`);
      continue;
    }
    for (const up of [-10, 0, 10]) {
      for (const across of [-15, -10, -5, 0, 5, 10, 15]) {
        const name = `${person}_2m_${head}P_${up}V_${across}H.jpg`;
        if (!fs.existsSync(path.join(data, name))) continue;
        const url = await page.evaluate(([u, c]) => window.render(u, c), [`/data/${name}`, crop]);
        fs.writeFileSync(path.join(out, `${head}_${up}_${across}.jpg`), Buffer.from(url.split(',')[1], 'base64'));
        written++;
      }
    }
  }
  console.log(`${written} frames written to ${out}`);
  await browser.close();
  server.close();
})().catch((error) => {
  console.error('FAILED', error);
  process.exit(1);
});
