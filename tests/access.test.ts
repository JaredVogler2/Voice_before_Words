import { describe, expect, test } from 'vitest';
import fixture from './fixtures/gaze-features.json';
import { CalibrationSession, calibrationPlan, DEFAULT_TIMING } from '../src/access/calibration';
import { extractFeatures, eyesClosed, type FaceFeatures } from '../src/access/features';
import {
  buildModel,
  crossCheckedError,
  designRow,
  gazeAngles,
  gradeCalibration,
  pixelsPerDegree,
  planePoint,
  predict,
  recommendedTargetSize,
  withoutLastUseSample,
  withUseSample,
  type Sample,
} from '../src/access/gazeModel';
import { GAZE_PRIOR, PITCH_GAIN } from '../src/access/gazePrior';
import { DEFAULT_GESTURE, GestureSwitch, LONG_CLOSE_MS } from '../src/access/gestures';
import { median, ridgeSolve } from '../src/access/linalg';
import { PointFilter } from '../src/access/oneEuro';
import { DEFAULT_DWELL, DwellSelector, pickTarget, type Target } from '../src/access/pointer';
import { DEFAULT_SCAN, Scanner, type ScanItem } from '../src/access/scanner';

/** Small repeatable random numbers, so tests with noise never flake. */
function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}
function gaussian(random: () => number): number {
  return Math.sqrt(-2 * Math.log(random() + 1e-12)) * Math.cos(2 * Math.PI * random());
}

const NEUTRAL: FaceFeatures = {
  gh: GAZE_PRIOR.mean[0], gv: GAZE_PRIOR.mean[1], bsh: GAZE_PRIOR.mean[2], bsv: GAZE_PRIOR.mean[3],
  open: GAZE_PRIOR.mean[4], lid: GAZE_PRIOR.mean[5], yaw: GAZE_PRIOR.mean[6], pitch: 0, roll: 0,
  tx: 0, ty: 0, tz: -32, blinkLeft: 0, blinkRight: 0, jawOpen: 0, browsUp: 0, smile: 0,
};

describe('face measurements', () => {
  test('match the reference implementation used for the accuracy evaluation', () => {
    for (const item of fixture.cases) {
      const features = extractFeatures(item.landmarks.map(([x, y, z]) => ({ x, y, z })), item.blendshapes, item.matrix, item.width, item.height)!;
      expect(features).not.toBeNull();
      for (const name of ['gh', 'gv', 'open', 'lid', 'bsh', 'bsv', 'yaw', 'pitch', 'roll', 'tx', 'ty', 'tz'] as const) {
        expect(features[name], name).toBeCloseTo((item.expected as Record<string, number>)[name], 5);
      }
    }
  });

  test('an incomplete or broken frame gives nothing rather than nonsense', () => {
    const item = fixture.cases[0];
    const points = item.landmarks.map(([x, y, z]) => ({ x, y, z }));
    expect(extractFeatures(points.slice(0, 400), item.blendshapes, item.matrix, 640, 480)).toBeNull();
    expect(extractFeatures(points, item.blendshapes, item.matrix.slice(0, 8), 640, 480)).toBeNull();
    const broken = points.map((point, i) => (i === 468 ? { ...point, x: NaN } : point));
    expect(extractFeatures(broken, item.blendshapes, item.matrix, 640, 480)).toBeNull();
  });

  test('closed eyes are recognised', () => {
    expect(eyesClosed({ ...NEUTRAL, blinkLeft: 0.9, blinkRight: 0.8 })).toBe(true);
    expect(eyesClosed({ ...NEUTRAL, blinkLeft: 0.9, blinkRight: 0.1 })).toBe(false);
  });
});

describe('least squares', () => {
  test('recovers a known relationship', () => {
    const rows: number[][] = [];
    const targets: number[][] = [];
    for (let a = -2; a <= 2; a++) for (let b = -2; b <= 2; b++) {
      rows.push([a, b, 1]);
      targets.push([3 * a - 2 * b + 5, -a + 4 * b - 1]);
    }
    const weights = ridgeSolve(rows, targets, [0, 0, 0]);
    expect(weights[0][0]).toBeCloseTo(3, 8);
    expect(weights[1][0]).toBeCloseTo(-2, 8);
    expect(weights[2][0]).toBeCloseTo(5, 8);
    expect(weights[1][1]).toBeCloseTo(4, 8);
  });

  test('a penalty pulls a weight toward zero, and an input that never varies gets none', () => {
    const rows = [[1, 0, 1], [2, 0, 1], [3, 0, 1]];
    const targets = [[2], [4], [6]];
    expect(ridgeSolve(rows, targets, [0, 0, 0])[0][0]).toBeCloseTo(2, 8);
    expect(ridgeSolve(rows, targets, [50, 0, 0])[0][0]).toBeLessThan(1);
    expect(ridgeSolve(rows, targets, [0, 0, 0])[1][0]).toBe(0);
  });

  test('median', () => {
    expect(median([5, 1, 3])).toBe(3);
    expect(median([4, 1, 3, 2])).toBe(2.5);
  });
});

/**
 * A made-up person for testing the fitting code. Their eyes obey the same model
 * the app assumes, but with their own gain and offset, which is exactly what
 * calibration has to discover. This checks the maths is self-consistent; the
 * accuracy claims in the docs come from real photographs, not from this.
 */
function simulatedPerson(options: { gain?: number; offset?: number; noise?: number; seed?: number } = {}) {
  const { gain = 0.85, offset = 0.4, noise = 0, seed = 1 } = options;
  const random = seeded(seed);
  const pxPerCm = 40;
  const screen = { width: 400, height: 760 };
  const camera = { x: 200, y: -20 }; // lens just above the top edge, centred
  return {
    screen,
    /** The measurements this person would produce while looking at a point on the screen. */
    look(x: number, y: number, head: { tx?: number; ty?: number; yaw?: number; pitch?: number } = {}): FaceFeatures {
      const tx = head.tx ?? 0;
      const ty = head.ty ?? 0;
      const yaw = head.yaw ?? GAZE_PRIOR.mean[6];
      const pitch = head.pitch ?? 0;
      const distance = 32;
      const planeX = (x - camera.x) / pxPerCm;
      const planeY = -(y - camera.y) / pxPerCm;
      const h = (Math.atan((planeX - tx) / distance) * 180) / Math.PI;
      const v = (Math.atan((planeY - ty) / distance) * 180) / Math.PI;
      // Invert the population model for the two strongest inputs, leaving the rest at their averages.
      const zYaw = (yaw - GAZE_PRIOR.mean[6]) / GAZE_PRIOR.sd[6];
      const zGh = (h - zYaw * GAZE_PRIOR.weights[6][0]) / GAZE_PRIOR.weights[0][0];
      const zLid = (v - zGh * GAZE_PRIOR.weights[0][1] - zYaw * GAZE_PRIOR.weights[6][1] - PITCH_GAIN * pitch) / GAZE_PRIOR.weights[5][1];
      const personal = (z: number) => z * gain + offset + noise * gaussian(random);
      return {
        ...NEUTRAL,
        gh: GAZE_PRIOR.mean[0] + personal(zGh) * GAZE_PRIOR.sd[0],
        lid: GAZE_PRIOR.mean[5] + personal(zLid) * GAZE_PRIOR.sd[5],
        yaw, pitch, tx, ty, tz: -distance,
      };
    },
  };
}

function calibrate(person: ReturnType<typeof simulatedPerson>, count: 5 | 9, source: 'gaze' | 'head' = 'gaze') {
  const plan = calibrationPlan(count);
  const sample = (dot: { x: number; y: number }): Sample => {
    const x = dot.x * person.screen.width;
    const y = dot.y * person.screen.height;
    return { row: designRow(source, person.look(x, y)), x, y, origin: 'calibration' };
  };
  return buildModel(source, plan.fit.map(sample), person.screen, 0, plan.check.map(sample))!;
}

describe('the gaze model', () => {
  test('a neutral face looks roughly straight at the camera', () => {
    const [h, v] = gazeAngles(NEUTRAL);
    expect(Math.abs(h)).toBeLessThan(1);
    expect(Math.abs(v)).toBeLessThan(1);
    const [gx, gy] = planePoint(NEUTRAL);
    expect(Math.abs(gx)).toBeLessThan(1);
    expect(Math.abs(gy)).toBeLessThan(1);
  });

  test('the signs are the right way round', () => {
    const base = gazeAngles(NEUTRAL);
    // iris further toward the right of the image, or head turned that way: gaze goes right
    expect(gazeAngles({ ...NEUTRAL, gh: NEUTRAL.gh + 0.05 })[0]).toBeGreaterThan(base[0]);
    expect(gazeAngles({ ...NEUTRAL, yaw: NEUTRAL.yaw + 10 })[0]).toBeGreaterThan(base[0]);
    // upper lid lower in the image, or face tipped down: gaze goes down
    expect(gazeAngles({ ...NEUTRAL, lid: NEUTRAL.lid + 0.03 })[1]).toBeLessThan(base[1]);
    expect(gazeAngles({ ...NEUTRAL, pitch: 10 })[1]).toBeLessThan(base[1]);
    // moving the whole head moves the point it looks at by the same amount
    expect(planePoint({ ...NEUTRAL, tx: 3 })[0] - planePoint(NEUTRAL)[0]).toBeCloseTo(3, 6);
  });

  test.each([5, 9] as const)('%i calibration dots recover a person with their own gain and offset', (count) => {
    const person = simulatedPerson();
    const model = calibrate(person, count);
    for (const [x, y] of [[60, 90], [340, 120], [200, 400], [90, 650], [330, 700]]) {
      const [px, py] = predict(model.weights, designRow('gaze', person.look(x, y)));
      expect(Math.hypot(px - x, py - y)).toBeLessThan(12);
    }
    expect(model.errorPx).toBeLessThan(12);
  });

  test('moving the head after calibration does not throw the pointer off', () => {
    const person = simulatedPerson();
    const model = calibrate(person, 9);
    for (const head of [{ tx: 3 }, { ty: -2 }, { yaw: 8 }, { pitch: 6 }, { tx: -2, yaw: -6, pitch: -4 }]) {
      const [px, py] = predict(model.weights, designRow('gaze', person.look(260, 500, head)));
      expect(Math.hypot(px - 260, py - 500), JSON.stringify(head)).toBeLessThan(40);
    }
  });

  test('noisy calibration still lands close, and the reported error is honest about it', () => {
    const person = simulatedPerson({ noise: 0.06, seed: 9 });
    const model = calibrate(person, 9);
    let total = 0;
    const points = [[80, 150], [320, 150], [200, 380], [80, 620], [320, 620], [200, 200], [140, 500]];
    for (const [x, y] of points) {
      const [px, py] = predict(model.weights, designRow('gaze', person.look(x, y)));
      total += Math.hypot(px - x, py - y);
    }
    const actual = total / points.length;
    expect(actual).toBeLessThan(60);
    // The measured error should be the same order as the real one, not wildly optimistic.
    expect(model.errorPx).toBeGreaterThan(actual / 4);
    expect(model.errorPx).toBeLessThan(actual * 4 + 20);
  });

  test('too few dots gives no model rather than a bad one', () => {
    const person = simulatedPerson();
    const samples = calibrationPlan(5).fit.slice(0, 3).map((dot): Sample => {
      const x = dot.x * person.screen.width;
      const y = dot.y * person.screen.height;
      return { row: designRow('gaze', person.look(x, y)), x, y, origin: 'calibration' };
    });
    expect(buildModel('gaze', samples, person.screen, 0)).toBeNull();
    expect(crossCheckedError('gaze', samples)).toBe(Infinity);
  });

  test('head pointing fits where the nose points', () => {
    const screen = { width: 400, height: 760 };
    const look = (x: number, y: number): FaceFeatures => ({ ...NEUTRAL, yaw: (x - 200) / 14, pitch: (y - 380) / 20 });
    const sample = (dot: { x: number; y: number }): Sample => {
      const x = dot.x * screen.width;
      const y = dot.y * screen.height;
      return { row: designRow('head', look(x, y)), x, y, origin: 'calibration' };
    };
    const plan = calibrationPlan(5);
    const model = buildModel('head', plan.fit.map(sample), screen, 0, plan.check.map(sample))!;
    const [px, py] = predict(model.weights, designRow('head', look(120, 600)));
    expect(Math.hypot(px - 120, py - 600)).toBeLessThan(8);
    expect(model.errorPx).toBeLessThan(8);
  });

  test('learning from use adds evidence, keeps the calibration dots, and can be undone', () => {
    const person = simulatedPerson();
    let model = calibrate(person, 5);
    const dots = model.samples.length;
    for (let i = 0; i < 200; i++) model = withUseSample(model, designRow('gaze', person.look(200, 300)), 200, 300);
    expect(model.samples.filter((sample) => sample.origin === 'calibration')).toHaveLength(dots);
    expect(model.samples.length).toBeLessThanOrEqual(dots + 120);
    const before = model.samples.length;
    model = withoutLastUseSample(model);
    expect(model.samples.length).toBe(before - 1);
    const [px, py] = predict(model.weights, designRow('gaze', person.look(200, 300)));
    expect(Math.hypot(px - 200, py - 300)).toBeLessThan(15);
  });

  test('calibration works out how many pixels a degree of gaze covers, for eye pointing only', () => {
    const person = simulatedPerson();
    const model = calibrate(person, 9);
    // This made-up screen is 40 px per cm at 32 cm: about 22 px per degree. The estimate
    // leans halfway toward a typical device, so it lands a little above that.
    expect(model.pxPerDegree).toBeGreaterThan(20);
    expect(model.pxPerDegree).toBeLessThan(32);
    expect(pixelsPerDegree(model.samples)).toBeCloseTo(model.pxPerDegree!, 6);
    expect(pixelsPerDegree(model.samples.slice(0, 3))).toBeUndefined();
    expect(calibrate(person, 9, 'head').pxPerDegree).toBeUndefined();
  });

  test('eye-pointing targets are sized in degrees: the measured error plus a fixed allowance', () => {
    expect(recommendedTargetSize(60, 30)).toBe(225);
    expect(recommendedTargetSize(90, 30)).toBeGreaterThan(recommendedTargetSize(60, 30));
    expect(recommendedTargetSize(60, 40)).toBeGreaterThan(recommendedTargetSize(60, 30));
    // Even a perfect-looking calibration gets a generous target: a short calibration cannot prove that much.
    expect(recommendedTargetSize(5, 30)).toBeGreaterThan(130);
    expect(recommendedTargetSize(5000, 30)).toBe(440);
    const screen = { width: 400, height: 800 };
    expect(gradeCalibration(60, screen, 30)).toBe('good'); // 2 degrees
    expect(gradeCalibration(100, screen, 30)).toBe('fair'); // 3.3 degrees
    expect(gradeCalibration(150, screen, 30)).toBe('poor'); // 5 degrees
  });

  test('bigger error asks for bigger targets, within sensible limits', () => {
    expect(recommendedTargetSize(20)).toBe(88);
    expect(recommendedTargetSize(60)).toBeGreaterThan(recommendedTargetSize(40));
    expect(recommendedTargetSize(500)).toBe(260);
    expect(recommendedTargetSize(Infinity)).toBe(220);
    const screen = { width: 400, height: 800 };
    expect(gradeCalibration(30, screen)).toBe('good');
    expect(gradeCalibration(70, screen)).toBe('fair');
    expect(gradeCalibration(150, screen)).toBe('poor');
  });
});

describe('smoothing', () => {
  test('steadies a jittery pointer at rest', () => {
    const random = seeded(4);
    const filter = new PointFilter(6, 400);
    const raw: number[] = [];
    const smooth: number[] = [];
    for (let i = 0; i < 300; i++) {
      const x = 200 + 18 * gaussian(random);
      raw.push(x);
      smooth.push(filter.filter({ x, y: 300 }, i * 33).x);
    }
    const spread = (values: number[]) => {
      const tail = values.slice(60);
      const mean = tail.reduce((a, b) => a + b, 0) / tail.length;
      return Math.sqrt(tail.reduce((a, b) => a + (b - mean) ** 2, 0) / tail.length);
    };
    expect(spread(smooth)).toBeLessThan(spread(raw) * 0.4);
  });

  test('still follows a real glance quickly', () => {
    const filter = new PointFilter(6, 400);
    for (let i = 0; i < 30; i++) filter.filter({ x: 100, y: 100 }, i * 33);
    let arrived = -1;
    for (let i = 0; i < 40; i++) {
      const out = filter.filter({ x: 320, y: 100 }, (30 + i) * 33);
      if (arrived < 0 && Math.abs(out.x - 320) < 30) arrived = i;
    }
    expect(arrived).toBeGreaterThanOrEqual(0);
    expect(arrived * 33).toBeLessThan(700);
  });

  test('starts fresh after a gap instead of gliding across the screen', () => {
    const filter = new PointFilter(8, 400);
    for (let i = 0; i < 30; i++) filter.filter({ x: 50, y: 50 }, i * 33);
    const out = filter.filter({ x: 350, y: 700 }, 30 * 33 + 2000);
    expect(out).toEqual({ x: 350, y: 700 });
  });

  test('a higher smoothing setting is steadier', () => {
    const run = (level: number) => {
      const random = seeded(2);
      const filter = new PointFilter(level, 400);
      let last = 0;
      let moved = 0;
      for (let i = 0; i < 200; i++) {
        const x = filter.filter({ x: 200 + 15 * gaussian(random), y: 0 }, i * 33).x;
        if (i > 50) moved += Math.abs(x - last);
        last = x;
      }
      return moved;
    };
    expect(run(9)).toBeLessThan(run(2));
  });
});

const GRID: Target[] = [
  { id: 'a', x: 0, y: 0, width: 100, height: 100 },
  { id: 'b', x: 110, y: 0, width: 100, height: 100 },
  { id: 'c', x: 0, y: 110, width: 100, height: 100 },
];

describe('choosing a target', () => {
  test('inside, near, and nowhere', () => {
    expect(pickTarget(GRID, { x: 50, y: 50 }, 0.4)?.id).toBe('a');
    expect(pickTarget(GRID, { x: 230, y: 50 }, 0.4)?.id).toBe('b'); // 20 px past the edge: snaps
    expect(pickTarget(GRID, { x: 320, y: 50 }, 0.4)).toBeNull(); // too far
    expect(pickTarget(GRID, { x: 105, y: 50 }, 0.4)).not.toBeNull(); // in the gap: nearest wins
    expect(pickTarget([], { x: 1, y: 1 }, 0.4)).toBeNull();
  });

  test('overlapping targets: the nearer centre wins', () => {
    const overlapping: Target[] = [
      { id: 'big', x: 0, y: 0, width: 300, height: 300 },
      { id: 'small', x: 100, y: 100, width: 40, height: 40 },
    ];
    expect(pickTarget(overlapping, { x: 120, y: 120 }, 0.4)?.id).toBe('small');
    expect(pickTarget(overlapping, { x: 20, y: 20 }, 0.4)?.id).toBe('big');
  });
});

describe('dwell selection', () => {
  const config = { ...DEFAULT_DWELL, dwellMs: 1000, cooldownMs: 300, repeatMs: 1500, graceMs: 400 };

  function run(selector: DwellSelector, steps: [{ x: number; y: number } | null, number][], start = 0) {
    let now = start;
    const selected: string[] = [];
    let last = selector.update(null, GRID, now);
    for (const [point, ms] of steps) {
      for (let elapsed = 0; elapsed < ms; elapsed += 33) {
        now += 33;
        last = selector.update(point, GRID, now);
        if (last.selected) selected.push(last.selected);
      }
    }
    return { selected, last, now };
  }

  test('looking at something for the dwell time chooses it, once', () => {
    const selector = new DwellSelector(config);
    const early = run(selector, [[{ x: 50, y: 50 }, 600]]);
    expect(early.selected).toEqual([]);
    expect(early.last.hover).toBe('a');
    expect(early.last.progress).toBeGreaterThan(0.4);
    const done = run(selector, [[{ x: 50, y: 50 }, 600]], early.now);
    expect(done.selected).toEqual(['a']);
  });

  test('glancing away starts over', () => {
    const selector = new DwellSelector(config);
    const out = run(selector, [[{ x: 50, y: 50 }, 700], [{ x: 160, y: 50 }, 700], [{ x: 50, y: 50 }, 700]]);
    expect(out.selected).toEqual([]);
  });

  test('jitter across the edge does not restart the timer', () => {
    const selector = new DwellSelector(config);
    const steps: [{ x: number; y: number }, number][] = [];
    for (let i = 0; i < 20; i++) steps.push([{ x: i % 2 ? 108 : 96, y: 50 }, 66]); // wobbling over a's right edge
    expect(run(selector, steps).selected).toEqual(['a']);
  });

  test('a blink pauses the dwell; losing the face for longer cancels it', () => {
    const blink = new DwellSelector(config);
    expect(run(blink, [[{ x: 50, y: 50 }, 600], [null, 200], [{ x: 50, y: 50 }, 500]]).selected).toEqual(['a']);
    const lost = new DwellSelector(config);
    const out = run(lost, [[{ x: 50, y: 50 }, 700], [null, 900], [{ x: 50, y: 50 }, 500]]);
    expect(out.selected).toEqual([]);
  });

  test('staying on a chosen target does not choose it again straight away, but eventually does', () => {
    const selector = new DwellSelector(config);
    expect(run(selector, [[{ x: 50, y: 50 }, 2200]]).selected).toEqual(['a']);
    const later = new DwellSelector(config);
    expect(run(later, [[{ x: 50, y: 50 }, 4200]]).selected).toEqual(['a', 'a']);
  });

  test('after a choice there is a short pause before anything else can be chosen', () => {
    const selector = new DwellSelector({ ...config, cooldownMs: 800 });
    const out = run(selector, [[{ x: 50, y: 50 }, 1100], [{ x: 160, y: 50 }, 1500]]);
    expect(out.selected).toEqual(['a']);
    expect(run(selector, [[{ x: 160, y: 50 }, 600]], out.now).selected).toEqual(['b']);
  });

  test('some targets can be made slower to trigger', () => {
    const slow: Target[] = [{ id: 'clear', x: 0, y: 0, width: 100, height: 100, dwellScale: 2 }];
    const selector = new DwellSelector(config);
    let now = 0;
    let picked: string | null = null;
    for (; now < 1500 && !picked; now += 33) picked = selector.update({ x: 50, y: 50 }, slow, now).selected;
    expect(picked).toBeNull();
    for (; now < 2400 && !picked; now += 33) picked = selector.update({ x: 50, y: 50 }, slow, now).selected;
    expect(picked).toBe('clear');
  });

  test('a hold stops selection for a while, for example while the screen changes', () => {
    const selector = new DwellSelector(config);
    selector.hold(0, 2000);
    expect(run(selector, [[{ x: 50, y: 50 }, 1500]]).selected).toEqual([]);
  });

  test('something new that appears under a resting pointer cannot be chosen until the pointer has been elsewhere', () => {
    const selector = new DwellSelector(config);
    const first = run(selector, [[{ x: 50, y: 50 }, 1100]]);
    expect(first.selected).toEqual(['a']);
    // The screen changes: a different thing now sits exactly where the pointer is resting.
    const changed: Target[] = [{ id: 'new', x: 0, y: 0, width: 100, height: 100 }, GRID[1], GRID[2]];
    let now = first.now;
    const picked: string[] = [];
    const feed = (point: { x: number; y: number }, ms: number) => {
      for (let elapsed = 0; elapsed < ms; elapsed += 33) {
        now += 33;
        const state = selector.update(point, changed, now);
        if (state.selected) picked.push(state.selected);
      }
    };
    feed({ x: 50, y: 50 }, 6000);
    expect(picked).toEqual([]); // however long the pointer stays
    feed({ x: 160, y: 50 }, 200); // a glance at something else
    feed({ x: 50, y: 50 }, 1100);
    expect(picked).toEqual(['new']);
  });

  test('a neighbour can be chosen straight after a choice', () => {
    const selector = new DwellSelector(config);
    // The short pause after a choice, then an ordinary dwell: no need to look anywhere else first.
    const out = run(selector, [[{ x: 50, y: 50 }, 1100], [{ x: 160, y: 50 }, 1400]]);
    expect(out.selected).toEqual(['a', 'b']);
  });

  test('wobbling at the edge of a chosen target does not count as looking away', () => {
    const selector = new DwellSelector(config);
    const first = run(selector, [[{ x: 50, y: 50 }, 1100]]);
    const changed: Target[] = [{ id: 'new', x: 0, y: 0, width: 100, height: 100 }];
    let now = first.now;
    const picked: string[] = [];
    for (let i = 0; i < 120; i++) {
      now += 33;
      const state = selector.update({ x: i % 2 ? 112 : 92, y: 50 }, changed, now);
      if (state.selected) picked.push(state.selected);
    }
    expect(picked).toEqual([]);
  });

  test('a target that disappears is forgotten', () => {
    const selector = new DwellSelector(config);
    run(selector, [[{ x: 50, y: 50 }, 500]]);
    const state = selector.update({ x: 50, y: 50 }, [GRID[1]], 600);
    expect(state.hover).not.toBe('a');
  });
});

const ITEMS: ScanItem[] = [
  { id: 's1', group: 'suggestions' }, { id: 's2', group: 'suggestions' },
  { id: 'a', group: 'row1' }, { id: 'b', group: 'row1' }, { id: 'c', group: 'row1' },
  { id: 'd', group: 'row2' }, { id: 'e', group: 'row2' },
];

describe('scanning', () => {
  const config = { ...DEFAULT_SCAN, intervalMs: 1000, firstPause: 1.5, passes: 2 };

  test('steps through groups, then through the items of the chosen group', () => {
    const scanner = new Scanner(config);
    scanner.setItems(ITEMS);
    expect(scanner.tick(0)).toMatchObject({ level: 'group', group: 'suggestions', highlighted: ['s1', 's2'] });
    expect(scanner.tick(1400).group).toBe('suggestions'); // the first highlight lingers
    expect(scanner.tick(1500).group).toBe('row1');
    expect(scanner.tick(2500).group).toBe('row2');
    expect(scanner.tick(3500).group).toBe('suggestions'); // wraps round

    scanner.tick(5000); // row1
    expect(scanner.state().group).toBe('row1');
    expect(scanner.press(5100)).toBeNull(); // enters the row
    expect(scanner.state()).toMatchObject({ level: 'item', highlighted: ['a'] });
    scanner.tick(5100 + 1500);
    expect(scanner.state().highlighted).toEqual(['b']);
    expect(scanner.press(6700)).toBe('b');
    expect(scanner.state()).toMatchObject({ level: 'group', group: 'suggestions' });
  });

  test('steps back out of a group when nothing in it is chosen', () => {
    const scanner = new Scanner(config);
    scanner.setItems(ITEMS);
    scanner.tick(0);
    scanner.press(10); // into "suggestions"
    let now = 10;
    for (let i = 0; i < 12 && scanner.state().level === 'item'; i++) {
      now += 1600;
      scanner.tick(now);
    }
    expect(scanner.state()).toMatchObject({ level: 'group', group: 'row1' });
  });

  test('linear scanning visits every item in turn', () => {
    const scanner = new Scanner({ ...config, pattern: 'linear' });
    scanner.setItems(ITEMS);
    const seen: string[] = [];
    let now = 0;
    for (let i = 0; i < ITEMS.length; i++) {
      seen.push(scanner.tick(now).highlighted[0]);
      now += 1600;
    }
    expect(seen).toEqual(['s1', 's2', 'a', 'b', 'c', 'd', 'e']);
    expect(scanner.press(now)).toBe('e');
    expect(scanner.state().highlighted).toEqual(['s1']); // and starts again from the top
  });

  test('one group needs only one press', () => {
    const scanner = new Scanner(config);
    scanner.setItems([{ id: 'x', group: 'g' }, { id: 'y', group: 'g' }]);
    expect(scanner.tick(0)).toMatchObject({ level: 'item', highlighted: ['x'] });
    expect(scanner.press(100)).toBe('x');
  });

  test('a group with a single item is chosen with one press', () => {
    const scanner = new Scanner(config);
    scanner.setItems([{ id: 'only', group: 'g1' }, { id: 'p', group: 'g2' }, { id: 'q', group: 'g2' }]);
    scanner.tick(0);
    expect(scanner.press(50)).toBe('only');
  });

  test('keeps its place when the screen has not changed, and starts again when it has', () => {
    const scanner = new Scanner(config);
    scanner.setItems(ITEMS);
    scanner.tick(0);
    scanner.tick(1500);
    expect(scanner.state().group).toBe('row1');
    scanner.setItems([...ITEMS]);
    expect(scanner.state().group).toBe('row1');
    scanner.setItems(ITEMS.slice(2));
    expect(scanner.state().group).toBe('row1');
    expect(scanner.tick(9000).highlighted).toEqual(['a', 'b', 'c']);
  });

  test('nothing to scan is handled quietly', () => {
    const scanner = new Scanner(config);
    scanner.setItems([]);
    expect(scanner.tick(0).highlighted).toEqual([]);
    expect(scanner.press(0)).toBeNull();
  });
});

describe('face gestures as a switch', () => {
  const closed: FaceFeatures = { ...NEUTRAL, blinkLeft: 0.95, blinkRight: 0.95 };
  const open: FaceFeatures = NEUTRAL;

  function play(detector: GestureSwitch, steps: [FaceFeatures | null, number][]) {
    const events: string[] = [];
    let now = 0;
    for (const [features, ms] of steps) {
      for (let elapsed = 0; elapsed < ms; elapsed += 33) {
        now += 33;
        const event = detector.update(features, now);
        if (event) events.push(event);
      }
    }
    return events;
  }

  test('an ordinary blink is ignored', () => {
    expect(play(new GestureSwitch(), [[open, 500], [closed, 150], [open, 500]])).toEqual([]);
  });

  test('a deliberate blink is one press, when the eyes open again', () => {
    expect(play(new GestureSwitch(), [[open, 500], [closed, 600], [open, 300]])).toEqual(['press']);
  });

  test('eyes resting closed is not a press; a long close opens the menu, once', () => {
    expect(play(new GestureSwitch(), [[open, 300], [closed, 1800], [open, 300]])).toEqual([]);
    expect(play(new GestureSwitch(), [[open, 300], [closed, LONG_CLOSE_MS + 1500], [open, 300]])).toEqual(['long-close']);
  });

  test('one eye closing does not count as a blink', () => {
    const wink: FaceFeatures = { ...NEUTRAL, blinkLeft: 0.95, blinkRight: 0.05 };
    expect(play(new GestureSwitch(), [[open, 300], [wink, 600], [open, 300]])).toEqual([]);
  });

  test('losing the face mid-gesture never produces a press', () => {
    expect(play(new GestureSwitch(), [[open, 300], [closed, 500], [null, 300], [open, 300]])).toEqual([]);
  });

  test('presses too close together count once', () => {
    const detector = new GestureSwitch({ ...DEFAULT_GESTURE, refractoryMs: 1500 });
    expect(play(detector, [[open, 300], [closed, 500], [open, 200], [closed, 500], [open, 300]])).toEqual(['press']);
  });

  test('other gestures work the same way, and the long eye-close still works with them', () => {
    const mouth = new GestureSwitch({ ...DEFAULT_GESTURE, kind: 'mouth', threshold: 0.4 });
    const openMouth: FaceFeatures = { ...NEUTRAL, jawOpen: 0.8 };
    expect(play(mouth, [[open, 300], [openMouth, 600], [open, 300]])).toEqual(['press']);
    expect(play(mouth, [[open, 300], [closed, 600], [open, 300]])).toEqual([]);
    expect(play(mouth, [[open, 300], [closed, LONG_CLOSE_MS + 300], [open, 300]])).toEqual(['long-close']);
  });

  test('shows how far through a hold the person is', () => {
    const detector = new GestureSwitch();
    detector.update(open, 0);
    detector.update(closed, 100);
    expect(detector.progress(100 + DEFAULT_GESTURE.holdMs / 2)).toBeCloseTo(0.5, 1);
    expect(detector.progress(5000)).toBe(1);
  });
});

describe('the calibration procedure', () => {
  function runSession(person: ReturnType<typeof simulatedPerson>, options: { loseFaceAt?: number; count?: 5 | 9 } = {}) {
    const plan = calibrationPlan(options.count ?? 5);
    const session = new CalibrationSession('gaze', plan, person.screen, DEFAULT_TIMING);
    let now = 0;
    let sawChecking = false;
    let sawWaiting = false;
    let status = session.status(now);
    for (let guard = 0; guard < 4000 && !session.done; guard++) {
      now += 33;
      const dot = status.dot!;
      const hidden = options.loseFaceAt === status.index;
      status = session.frame(hidden ? null : person.look(dot.x * person.screen.width, dot.y * person.screen.height), now);
      sawChecking ||= status.checking;
      sawWaiting ||= status.waitingForFace;
    }
    return { session, result: session.result(now), now, sawChecking, sawWaiting, total: plan.fit.length + plan.check.length };
  }

  test('walks through every dot by itself and produces an accurate model', () => {
    const run = runSession(simulatedPerson({ noise: 0.02, seed: 3 }));
    expect(run.session.done).toBe(true);
    expect(run.sawChecking).toBe(true);
    expect(run.result.recorded).toBe(run.total);
    expect(run.result.model).not.toBeNull();
    expect(run.result.model!.errorPx).toBeLessThan(40);
    // about two seconds a dot
    expect(run.now / run.total).toBeGreaterThan(1500);
    expect(run.now / run.total).toBeLessThan(3000);
  });

  test('a dot that cannot be read is skipped instead of trapping the person', () => {
    const run = runSession(simulatedPerson(), { loseFaceAt: 2, count: 9 });
    expect(run.session.done).toBe(true);
    expect(run.sawWaiting).toBe(true);
    expect(run.result.recorded).toBe(run.total - 1);
    expect(run.result.model).not.toBeNull();
  });

  test('reports progress through each dot', () => {
    const person = simulatedPerson();
    const session = new CalibrationSession('gaze', calibrationPlan(5), person.screen, DEFAULT_TIMING);
    const features = person.look(200, 380);
    expect(session.frame(features, 0).phase).toBe('settling');
    expect(session.frame(features, DEFAULT_TIMING.settleMs + 10).phase).toBe('collecting');
    const mid = session.frame(features, DEFAULT_TIMING.settleMs + DEFAULT_TIMING.collectMs / 2);
    expect(mid.progress).toBeGreaterThan(0.3);
    expect(mid.progress).toBeLessThan(0.7);
    expect(mid.index).toBe(0);
  });

  test('plans put dots where they matter and check in places not used for fitting', () => {
    for (const count of [5, 9] as const) {
      const plan = calibrationPlan(count);
      expect(plan.fit).toHaveLength(count);
      const key = (p: { x: number; y: number }) => `${p.x},${p.y}`;
      const used = new Set(plan.fit.map(key));
      for (const dot of plan.check) expect(used.has(key(dot))).toBe(false);
      for (const dot of [...plan.fit, ...plan.check]) {
        expect(dot.x).toBeGreaterThan(0.05);
        expect(dot.x).toBeLessThan(0.95);
      }
    }
  });
});
