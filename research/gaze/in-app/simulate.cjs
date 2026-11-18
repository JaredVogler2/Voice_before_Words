// A simulated person in front of the running app.
//
// Photographs of someone looking in known directions (from prepare_frames.cjs) are fed to the
// app as if they were its camera, and the "person" looks wherever this script tells them to:
// at each calibration dot, then at places on the board. It reports how far the app's pointer
// lands from where the person is really looking, and whether looking at something chooses it.
//
//   npm run build && npm run preview -- --port 4173 &
//   node research/gaze/in-app/simulate.cjs --frames <folder> [--width 1180 --height 820] [--span 15] [--dots 9]
//
// --span is the sideways gaze angle, in degrees, at the outermost calibration dots: 15 is a
// large tablet at 45 cm, 5 is a phone held upright at 30 cm. Up and down is always 10.
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
const option = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);
const frames = option('--frames');
const url = option('--url', 'http://127.0.0.1:4173/');
const width = Number(option('--width', 1180));
const height = Number(option('--height', 820));
const span = Number(option('--span', 15));
const dots = Number(option('--dots', 9));
if (!frames) {
  console.error('usage: node simulate.cjs --frames <folder from prepare_frames.cjs> [--width W --height H] [--span 15|5] [--dots 9|5]');
  process.exit(1);
}

const ACROSS = [-15, -10, -5, 0, 5, 10, 15].filter((angle) => Math.abs(angle) <= span);
const UP = [10, 0, -10];
// The outer calibration dots are a tenth of the way in from each edge.
const place = (across, up) => ({ x: (0.5 + (across / span) * 0.4) * width, y: (0.5 - (up / 10) * 0.4) * height });
const direction = (fx, fy) => ({
  across: Math.max(-span, Math.min(span, Math.round((((fx - 0.5) / 0.4) * span) / 5) * 5)) + 0,
  up: Math.max(-10, Math.min(10, Math.round(-(fy - 0.5) / 0.4) * 10)) + 0,
});
const pixelsPerDegree = ((0.8 * width) / (2 * span) + (0.8 * height) / 20) / 2;
const mean = (list) => list.reduce((sum, value) => sum + value, 0) / Math.max(1, list.length);

function accessSettings(dwellMs) {
  return {
    method: 'gaze', dwellMs, smoothing: 6, showPointer: true, scanIntervalMs: 1300, scanPattern: 'group', switchGesture: 'blink',
    gestureThreshold: 0.55, gestureHoldMs: 350, switchKeys: true, switchTap: false, longCloseMenu: true, menuBy: 'switch',
    learnFromUse: false, twoStep: 'auto', cueVolume: 0, calibrationPoints: dots,
  };
}

/** Runs in the page before the app: a camera whose picture is whichever photograph the test chooses. */
function installCamera() {
  const canvas = document.createElement('canvas');
  canvas.width = 640;
  canvas.height = 480;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  const images = new Map();
  let current = null;
  let away = false;
  setInterval(() => {
    context.fillStyle = '#555';
    context.fillRect(0, 0, 640, 480);
    if (!current || away) return;
    // No camera is perfectly still or perfectly clean: a little shake and sensor noise.
    context.drawImage(current, (Math.random() - 0.5) * 0.8, (Math.random() - 0.5) * 0.8);
    const image = context.getImageData(0, 0, 640, 480);
    for (let i = 0; i < image.data.length; i += 4) {
      const noise = (Math.random() - 0.5) * 16;
      image.data[i] += noise;
      image.data[i + 1] += noise;
      image.data[i + 2] += noise;
    }
    context.putImageData(image, 0, 0);
  }, 40);
  window.__person = {
    async load(keys) {
      for (const key of keys) {
        const image = new Image();
        image.src = `/__frames/${key}.jpg`;
        await image.decode();
        images.set(key, image);
      }
      return images.size;
    },
    look(key) {
      current = images.get(key) ?? null;
    },
    lookAway(flag) {
      away = flag;
    },
  };
  navigator.mediaDevices.getUserMedia = async () => canvas.captureStream(25);
  // Everything that gets chosen, by whatever means.
  window.__chosen = [];
  document.addEventListener('click', (event) => {
    const target = event.target && event.target.closest ? event.target.closest('[data-access]') : null;
    window.__chosen.push(target ? target.getAttribute('data-access') : '(nothing)');
  }, true);
}

(async () => {
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width, height }, serviceWorkers: 'block' });
  const page = await context.newPage();
  page.on('pageerror', (error) => console.log('page error:', String(error).slice(0, 300)));
  await page.route('**/__frames/*', (route) => route.fulfill({ status: 200, contentType: 'image/jpeg', body: fs.readFileSync(path.join(frames, path.basename(route.request().url()))) }));
  await page.addInitScript(installCamera);
  await page.addInitScript((access) => {
    if (sessionStorage.getItem('seeded')) return;
    sessionStorage.setItem('seeded', '1');
    localStorage.setItem('voice-before-words:settings', JSON.stringify({ state: { onboarded: true, access }, version: 1 }));
  }, accessSettings(3000)); // a long dwell at first, so measuring the pointer chooses nothing

  await page.goto(url);
  const keys = [];
  for (const head of [0, -15, 15]) for (const up of UP) for (const across of [-15, -10, -5, 0, 5, 10, 15]) keys.push(`${head}_${up}_${across}`);
  await page.evaluate((list) => window.__person.load(list), keys);
  const look = (across, up, head = 0) => page.evaluate((key) => window.__person.look(key), `${head}_${up}_${across}`);
  await look(0, 0);

  // ── calibration, with no touch after the first ─────────────────────────────
  await page.mouse.click(width / 2, height / 2);
  await page.waitForFunction(() => location.hash.includes('calibrate'), null, { timeout: 30000 });
  const started = Date.now();
  let lastDot = '';
  let outcome = null;
  while (Date.now() - started < 150000) {
    const state = await page.evaluate(() => {
      const dot = document.querySelector('.calibration .dot');
      const match = dot && /translate\(([-\d.]+)px,\s*([-\d.]+)px\)/.exec(dot.style.transform);
      return {
        dot: match ? [Number(match[1]) / innerWidth, Number(match[2]) / innerHeight] : null,
        checking: dot ? dot.getAttribute('data-checking') === 'true' : false,
        heading: document.querySelector('.calibration h1')?.textContent ?? '',
      };
    });
    if (state.dot) {
      const key = `${state.dot.map((value) => value.toFixed(3)).join(',')}${state.checking}`;
      if (key !== lastDot) {
        lastDot = key;
        await page.waitForTimeout(250); // eyes follow a quarter of a second behind
        // The accuracy-check dots sit between the directions the photographs cover, so the person
        // looks away and the app skips them, falling back on its cross-checked estimate.
        await page.evaluate((flag) => window.__person.lookAway(flag), state.checking);
        if (!state.checking) {
          const d = direction(state.dot[0], state.dot[1]);
          await look(d.across, d.up);
        }
      }
    } else if (/is set up$|didn’t work/.test(state.heading)) {
      outcome = state.heading;
      break;
    }
    await page.waitForTimeout(50);
  }
  await page.evaluate(() => window.__person.lookAway(false));
  await look(0, 0);
  console.log(`calibration: ${outcome} (${Math.round((Date.now() - started) / 1000)} s)`);
  await page.waitForFunction(() => location.hash === '#/' || location.hash === '', null, { timeout: 20000 });
  await page.waitForTimeout(1200);

  const saved = await page.evaluate(() => {
    const models = JSON.parse(localStorage.getItem('voice-before-words:settings')).state.models;
    return Object.values(models).map((model) => ({ errorPx: Math.round(model.errorPx), pxPerDegree: model.pxPerDegree ? Number(model.pxPerDegree.toFixed(1)) : null }));
  });
  const layout = await page.evaluate(() => {
    const size = (selector) => {
      const element = document.querySelector(selector);
      if (!element) return null;
      const box = element.getBoundingClientRect();
      return `${Math.round(box.width)}x${Math.round(box.height)}`;
    };
    return { wordTarget: size('.board > [data-access]'), sentence: size('.suggestion'), control: size('.navbtn'), groups: document.querySelectorAll('.board > .group').length, wordsOnPage: document.querySelectorAll('.board .tile:not(.empty)').length };
  });
  console.log(`the app's own estimate: ${JSON.stringify(saved)}; true pixels per degree here: ${pixelsPerDegree.toFixed(1)}`);
  console.log(`layout it chose: ${JSON.stringify(layout)}`);

  // ── how close is the pointer to where the person is looking? ───────────────
  const pointer = () => page.evaluate(() => {
    const element = document.querySelector('.access-pointer');
    const match = element && element.style.opacity !== '0' && /translate\(([-\d.]+)px,\s*([-\d.]+)px\)/.exec(element.style.transform);
    return match ? [Number(match[1]), Number(match[2])] : null;
  });
  const measure = async (head, onlyUnseen) => {
    const spots = [];
    for (const up of UP) for (const across of ACROSS) if (!onlyUnseen || span < 15 || (Math.abs(across) !== 15 && across !== 0)) spots.push({ across, up });
    // Far-apart order, so the pointer never rests anywhere long enough to choose it.
    spots.sort((a, b) => ((a.across * 7 + a.up * 3 + 100) % 11) - ((b.across * 7 + b.up * 3 + 100) % 11));
    const errors = [];
    for (const { across, up } of spots) {
      await look(across, up, head);
      await page.waitForTimeout(650);
      const samples = [];
      for (let i = 0; i < 8; i++) {
        const point = await pointer();
        if (point) samples.push(point);
        await page.waitForTimeout(50);
      }
      if (samples.length < 4) continue;
      const want = place(across, up);
      errors.push(Math.hypot(mean(samples.map((s) => s[0])) - want.x, mean(samples.map((s) => s[1])) - want.y) / pixelsPerDegree);
    }
    errors.sort((a, b) => a - b);
    return `${mean(errors).toFixed(1)} degrees typical, ${errors[Math.floor(errors.length / 2)].toFixed(1)} median, ${errors[errors.length - 1].toFixed(1)} worst, over ${errors.length} places`;
  };
  console.log(`pointer error at places ${dots === 9 && span === 15 ? 'that were not calibration dots' : '(including calibration dots)'}: ${await measure(0, dots === 9)}`);
  console.log(`after turning the head 15 degrees one way: ${await measure(-15, false)}`);
  console.log(`after turning it the other way: ${await measure(15, false)}`);

  // ── does looking at something choose it? ───────────────────────────────────
  // Ordinary dwell time now, after a reload: the calibration has to survive that.
  await page.evaluate((access) => {
    const key = 'voice-before-words:settings';
    const value = JSON.parse(localStorage.getItem(key));
    value.state.access = access;
    localStorage.setItem(key, JSON.stringify(value));
  }, accessSettings(1100));
  await page.reload();
  await page.waitForTimeout(600);
  await page.evaluate((list) => window.__person.load(list), keys.filter((key) => key.startsWith('0_')));
  await look(0, 0);
  await page.mouse.click(width / 2, height / 2);
  await page.waitForTimeout(2500);
  console.log(`after a reload the app is at ${await page.evaluate(() => location.hash || '#/')} (no new calibration needed)`);

  const SPOTS = [];
  for (const up of [0, -10, 10]) for (const across of [-15, -5, 5, 15, -10, 10, 0]) if (Math.abs(across) <= span) SPOTS.push({ across, up });
  const under = (across, up) => {
    const want = place(across, up);
    return page.evaluate(([x, y]) => {
      const element = document.elementFromPoint(x, y)?.closest('[data-access]');
      if (!element || element.disabled) return null;
      const box = element.getBoundingClientRect();
      // How far inside the target the person is aiming, as a share of its size (0.5 is dead centre).
      return { id: element.getAttribute('data-access'), inset: Math.min((x - box.left) / box.width, (box.right - x) / box.width, (y - box.top) / box.height, (box.bottom - y) / box.height) };
    }, [want.x, want.y]);
  };
  const lookUntilChosen = async (across, up) => {
    await look(across === 0 ? 5 : -across, up === 0 ? 10 : -up); // a glance somewhere else first
    await page.waitForTimeout(600);
    await page.evaluate(() => { window.__chosen.length = 0; });
    await look(across, up);
    const began = Date.now();
    let got = null;
    while (Date.now() - began < 5000 && !got) {
      await page.waitForTimeout(60);
      got = await page.evaluate(() => window.__chosen[0] ?? null);
    }
    return { got, seconds: (Date.now() - began) / 1000 };
  };
  const goHome = () => page.evaluate(() => {
    document.querySelector('[data-access="nav:unzoom"]')?.click();
    (document.querySelector('[data-access="nav:home"]') ?? document.querySelector('[data-access="nav:to-home"]'))?.click();
  });
  const tally = { aimedInside: { right: 0, wrong: 0, nothing: 0 }, aimedNearEdge: { right: 0, wrong: 0, nothing: 0 }, wordFromGroup: { right: 0, wrong: 0, nothing: 0 } };
  const count = (bucket, got, wanted) => { if (!got) bucket.nothing++; else if (got === wanted) bucket.right++; else bucket.wrong++; };
  const seconds = [];
  for (const { across, up } of SPOTS) {
    await goHome();
    await page.waitForTimeout(150);
    const aim = await under(across, up);
    if (!aim) continue;
    const first = await lookUntilChosen(across, up);
    count(aim.inset >= 0.25 ? tally.aimedInside : tally.aimedNearEdge, first.got, aim.id);
    if (first.got === aim.id) seconds.push(first.seconds);
    // If that opened a group of words, go on and choose one, aiming at the middle of it.
    if (first.got === aim.id && aim.id.startsWith('group:')) {
      await page.waitForTimeout(300);
      for (const spot of SPOTS) {
        const target = await under(spot.across, spot.up);
        if (!target || target.inset < 0.25 || !/^(tile|folder|letter):/.test(target.id) || (spot.across === across && spot.up === up)) continue;
        const second = await lookUntilChosen(spot.across, spot.up);
        count(tally.wordFromGroup, second.got, target.id);
        if (second.got === target.id) seconds.push(second.seconds);
        break;
      }
    }
  }
  console.log(`choosing by looking: ${JSON.stringify(tally)}; ${seconds.length ? mean(seconds).toFixed(1) : '-'} seconds per choice`);
  await browser.close();
})().catch((error) => {
  console.error('FAILED', error);
  process.exit(1);
});
