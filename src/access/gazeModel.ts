import type { FaceFeatures } from './features';
import { GAZE_INPUTS, GAZE_PRIOR, PITCH_GAIN } from './gazePrior';
import { dot, ridgeSolve } from './linalg';

/**
 * From face measurements to a point on the screen.
 *
 * Two layers:
 *
 * 1. A fixed population model (gazePrior.ts) estimates the direction of gaze
 *    relative to the camera, then geometry turns that direction into a point on
 *    the camera's own plane. Because it combines eye and head, a moderate head
 *    movement shifts the estimate the right way without any personal data.
 *
 * 2. A personal model, fitted from this person's calibration, maps that point
 *    to their screen. It is mostly a shift and a scale, plus small corrections
 *    that are held close to zero until there is enough evidence for them.
 *
 * Head pointing uses the same machinery with head measurements only.
 */

export type PointerSource = 'gaze' | 'head';

export interface Sample {
  /** The model inputs for one moment of looking at a known place. */
  row: number[];
  /** Where on the screen the person was looking, in CSS pixels. */
  x: number;
  y: number;
  /** Calibration dots are kept; samples learned during use are replaced over time. */
  origin: 'calibration' | 'use';
}

export interface PersonalModel {
  source: PointerSource;
  /** [input][x|y] */
  weights: number[][];
  samples: Sample[];
  /** Cross-checked error in CSS pixels: how far off a point is when it is left out of the fit. */
  errorPx: number;
  /** The screen the calibration was made on. A different size or orientation needs a new one. */
  screen: { width: number; height: number };
  createdAt: number;
  /**
   * Eye pointing only: how many screen pixels one degree of gaze covers for
   * this person, device and distance, worked out from the calibration. It lets
   * target sizes be set in degrees, which is what accuracy is measured in.
   */
  pxPerDegree?: number;
}

const RADIANS = Math.PI / 180;

/** Direction of gaze relative to the camera, in degrees: [right, up]. */
export function gazeAngles(features: FaceFeatures): [number, number] {
  let h = 0;
  let v = 0;
  GAZE_INPUTS.forEach((name, i) => {
    const z = (features[name] - GAZE_PRIOR.mean[i]) / GAZE_PRIOR.sd[i];
    h += z * GAZE_PRIOR.weights[i][0];
    // Pitch is handled below from geometry rather than from the data.
    if (name !== 'pitch') v += z * GAZE_PRIOR.weights[i][1];
  });
  v += PITCH_GAIN * features.pitch;
  return [h, v];
}

/** The same direction, recovered from a row made by `designRow('gaze', …)`. */
function gazeAnglesOfRow(row: number[]): [number, number] {
  let h = 0;
  let v = 0;
  GAZE_INPUTS.forEach((name, i) => {
    const z = row[2 + i];
    h += z * GAZE_PRIOR.weights[i][0];
    if (name !== 'pitch') v += z * GAZE_PRIOR.weights[i][1];
    else v += PITCH_GAIN * (z * GAZE_PRIOR.sd[i] + GAZE_PRIOR.mean[i]);
  });
  return [h, v];
}

function slope(xs: number[], ys: number[]): number {
  const n = xs.length;
  const meanX = xs.reduce((sum, value) => sum + value, 0) / n;
  const meanY = ys.reduce((sum, value) => sum + value, 0) / n;
  let top = 0;
  let bottom = 0;
  for (let i = 0; i < n; i++) {
    top += (xs[i] - meanX) * (ys[i] - meanY);
    bottom += (xs[i] - meanX) ** 2;
  }
  return bottom > 1e-9 ? top / bottom : NaN;
}

/**
 * Phones, tablets and laptops at their usual distances all come out near this:
 * the closer a screen is held, the finer its pixels are made.
 */
const TYPICAL_PX_PER_DEGREE = 33;

/** The population model under-reads sideways eye travel by this much on average (evaluation data). */
const SIDEWAYS_GAIN = 1.12;

/**
 * Screen pixels per degree of gaze, from calibration dots: how far apart the
 * dots were on the screen against how far apart the eyes' directions were.
 *
 * Only sideways movement is used; the model's up-and-down reading differs too
 * much between people to serve as a ruler. Even so the measurement is off by
 * about a fifth for a given person, and so is the typical value for a given
 * device, so the two are averaged, which halves the error (to about a tenth on
 * the evaluation data).
 */
export function pixelsPerDegree(samples: Sample[]): number | undefined {
  if (!GAZE_PRIOR.enabled || samples.length < MIN_CALIBRATION_POINTS) return undefined;
  const sideways = samples.map((sample) => gazeAnglesOfRow(sample.row)[0]);
  const measured = Math.abs(slope(sideways, samples.map((sample) => sample.x))) / SIDEWAYS_GAIN;
  if (!Number.isFinite(measured) || measured <= 0) return TYPICAL_PX_PER_DEGREE;
  return Math.max(20, Math.min(55, Math.sqrt(measured * TYPICAL_PX_PER_DEGREE)));
}

/**
 * Where the line of sight meets the plane of the camera, in the camera's units
 * (roughly centimetres, right and up from the lens).
 */
export function planePoint(features: FaceFeatures): [number, number] {
  const [h, v] = gazeAngles(features);
  const distance = Math.max(5, -features.tz);
  const clamp = (degrees: number) => Math.max(-60, Math.min(60, degrees));
  return [features.tx + distance * Math.tan(clamp(h) * RADIANS), features.ty + distance * Math.tan(clamp(v) * RADIANS)];
}

/**
 * How firmly each input is held near zero.
 *
 * For gaze: the two plane coordinates carry almost no penalty, so even five
 * calibration points fit a clean shift-and-scale. The eight corrections are
 * penalised, so they stay small after a short calibration and only take over
 * as evidence builds up (more points, or calibration across head positions).
 * These values gave the lowest error on held-out people in the evaluation.
 */
const GAZE_PENALTY = [0.05, 0.05, 5, 5, 5, 5, 5, 5, 5, 5, 0];
const HEAD_PENALTY = [0.02, 0.02, 0.5, 0.5, 2, 0];

function penaltyFor(source: PointerSource): number[] {
  return source === 'gaze' ? GAZE_PENALTY : HEAD_PENALTY;
}

/** The inputs to the personal model for one frame. The last entry is the constant term. */
export function designRow(source: PointerSource, features: FaceFeatures): number[] {
  if (source === 'head') {
    // Head pointing: where the nose points, and where the head is.
    return [features.yaw / 10, features.pitch / 10, features.tx / 5, features.ty / 5, features.roll / 10, 1];
  }
  const corrections = GAZE_INPUTS.map((name, i) => (features[name] - GAZE_PRIOR.mean[i]) / GAZE_PRIOR.sd[i]);
  if (!GAZE_PRIOR.enabled) {
    // No population prior: fall back to fitting the raw inputs directly.
    return [0, 0, ...corrections, 1];
  }
  const [gx, gy] = planePoint(features);
  return [gx, gy, ...corrections, 1];
}

export function fitWeights(source: PointerSource, samples: Sample[]): number[][] {
  const penalty = penaltyFor(source).slice();
  if (source === 'gaze' && !GAZE_PRIOR.enabled) for (let i = 2; i < 10; i++) penalty[i] = 0.5;
  return ridgeSolve(
    samples.map((sample) => sample.row),
    samples.map((sample) => [sample.x, sample.y]),
    penalty,
  );
}

export function predict(weights: number[][], row: number[]): [number, number] {
  return [dot(row, weights, 0), dot(row, weights, 1)];
}

/**
 * Leave each calibration point out in turn, fit the rest, and see how far off
 * the missing one lands. This is an honest estimate of how accurate pointing
 * will be, and it is what the app uses to decide how big targets must be.
 */
export function crossCheckedError(source: PointerSource, samples: Sample[]): number {
  if (samples.length < 4) return Infinity;
  let total = 0;
  for (let i = 0; i < samples.length; i++) {
    const rest = samples.filter((_, index) => index !== i);
    const [x, y] = predict(fitWeights(source, rest), samples[i].row);
    total += Math.hypot(x - samples[i].x, y - samples[i].y);
  }
  return total / samples.length;
}

/** The fewest calibration points that give a usable fit. */
export const MIN_CALIBRATION_POINTS = 4;

/**
 * Leaving out a corner dot forces the fit to guess beyond the dots it has, so
 * the cross-check overstates the error. On the evaluation data the real error
 * was about 0.7 of it with nine dots and about half with five.
 */
function crossCheckFactor(points: number): number {
  return points >= 9 ? 0.7 : 0.55;
}

/**
 * @param calibration dots used to fit the model
 * @param checks      extra dots shown afterwards, used first to measure the real
 *                    error and then added to the fit
 */
export function buildModel(
  source: PointerSource,
  calibration: Sample[],
  screen: { width: number; height: number },
  now: number,
  checks: Sample[] = [],
): PersonalModel | null {
  if (calibration.length < MIN_CALIBRATION_POINTS) return null;
  const first = fitWeights(source, calibration);
  if (first.some((row) => row.some((value) => !Number.isFinite(value)))) return null;

  let errorPx: number;
  if (checks.length > 0) {
    // The honest way: fresh dots the fit has never seen.
    errorPx = checks.reduce((sum, check) => {
      const [x, y] = predict(first, check.row);
      return sum + Math.hypot(x - check.x, y - check.y);
    }, 0) / checks.length;
  } else {
    errorPx = crossCheckedError(source, calibration) * crossCheckFactor(calibration.length);
  }

  const samples = [...calibration, ...checks];
  const weights = checks.length > 0 ? fitWeights(source, samples) : first;
  const pxPerDegree = source === 'gaze' ? pixelsPerDegree(samples) : undefined;
  return { source, weights, samples, errorPx, screen, createdAt: now, ...(pxPerDegree ? { pxPerDegree } : {}) };
}

/** How many learned-in-use samples are kept alongside the calibration dots. */
const MAX_USE_SAMPLES = 120;

/**
 * Add what was learned from a confirmed selection: the person was looking at
 * that target. Over time this teaches the model the head positions they really
 * use, which a short calibration with the head still cannot.
 */
export function withUseSample(model: PersonalModel, row: number[], x: number, y: number): PersonalModel {
  const calibration = model.samples.filter((sample) => sample.origin === 'calibration');
  const use = model.samples.filter((sample) => sample.origin === 'use');
  use.push({ row, x, y, origin: 'use' });
  while (use.length > MAX_USE_SAMPLES) use.shift();
  const samples = [...calibration, ...use];
  const weights = fitWeights(model.source, samples);
  if (weights.some((r) => r.some((value) => !Number.isFinite(value)))) return model;
  return { ...model, samples, weights };
}

/** Drop the most recent learned sample, for when a selection is undone straight away. */
export function withoutLastUseSample(model: PersonalModel): PersonalModel {
  let index = -1;
  for (let i = model.samples.length - 1; i >= 0; i--) {
    if (model.samples[i].origin === 'use') {
      index = i;
      break;
    }
  }
  if (index < 0) return model;
  const samples = model.samples.filter((_, i) => i !== index);
  return { ...model, samples, weights: fitWeights(model.source, samples) };
}

/**
 * How large a target needs to be for pointing this accurate to hit it reliably.
 * A target wins when the estimate is nearer to it than to its neighbours, so
 * its width must comfortably exceed twice the typical error.
 *
 * For eye pointing the size is the person's own measured error plus a fixed
 * allowance in degrees, because a short calibration cannot measure a person's
 * error precisely. On the evaluation data (56 people, nine dots, head still)
 * this rule gave targets about 8 degrees across, and a first look landed on the
 * intended target 86 to 91% of the time; the simpler "2.6 times the error"
 * managed 69%, and left the people it underestimated with almost nothing they
 * could hit.
 *
 * @param pxPerDegree from the calibration, for eye pointing; omit for head pointing
 */
export function recommendedTargetSize(errorPx: number, pxPerDegree?: number): number {
  if (!Number.isFinite(errorPx)) return 220;
  if (pxPerDegree) return Math.round(Math.max(88, Math.min(440, 1.5 * errorPx + 4.5 * pxPerDegree)));
  return Math.round(Math.max(88, Math.min(260, errorPx * 2.6)));
}

export type CalibrationGrade = 'good' | 'fair' | 'poor';

/**
 * A plain-language grade. For eye pointing it is in degrees (under 2.5 is as
 * good as a camera gets); otherwise relative to the size of the screen.
 */
export function gradeCalibration(errorPx: number, screen: { width: number; height: number }, pxPerDegree?: number): CalibrationGrade {
  if (pxPerDegree) {
    const degrees = errorPx / pxPerDegree;
    if (degrees < 2.5) return 'good';
    if (degrees < 4) return 'fair';
    return 'poor';
  }
  const relative = errorPx / Math.min(screen.width, screen.height);
  if (relative < 0.12) return 'good';
  if (relative < 0.22) return 'fair';
  return 'poor';
}
