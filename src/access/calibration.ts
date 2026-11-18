import type { FaceFeatures } from './features';
import { eyesClosed } from './features';
import { buildModel, designRow, type PersonalModel, type PointerSource, type Sample } from './gazeModel';
import { median } from './linalg';
import type { Point } from './oneEuro';

/**
 * Calibration: show a dot, wait for the eyes (or head) to arrive and settle,
 * record where they are, move on. Afterwards a few extra dots are shown in new
 * places purely to measure how accurate the result is, so the app can size its
 * targets honestly instead of assuming.
 *
 * Nothing here needs hands: the dots advance on their own.
 */

export interface CalibrationPlan {
  /** Dots used to fit the model, as fractions of the screen (0 to 1). */
  fit: Point[];
  /** Dots used afterwards to check it. */
  check: Point[];
}

const EDGE = 0.1;
const MID = 0.5;
const FAR = 1 - EDGE;

/**
 * Dot positions. Corners and edges matter most (they pin down the scale); the
 * order makes a smooth path so the eyes never have to jump across the screen.
 */
export function calibrationPlan(points: 5 | 9): CalibrationPlan {
  const five: Point[] = [
    { x: MID, y: MID },
    { x: EDGE, y: EDGE },
    { x: FAR, y: EDGE },
    { x: FAR, y: FAR },
    { x: EDGE, y: FAR },
  ];
  const nine: Point[] = [
    { x: MID, y: MID },
    { x: EDGE, y: EDGE },
    { x: MID, y: EDGE },
    { x: FAR, y: EDGE },
    { x: FAR, y: MID },
    { x: FAR, y: FAR },
    { x: MID, y: FAR },
    { x: EDGE, y: FAR },
    { x: EDGE, y: MID },
  ];
  // Check dots sit between the fitting dots, where no dot has been shown.
  const check: Point[] = [
    { x: 0.3, y: 0.3 },
    { x: 0.7, y: 0.7 },
    { x: 0.7, y: 0.3 },
    { x: 0.3, y: 0.7 },
  ];
  return points === 5 ? { fit: five, check: check.slice(0, 3) } : { fit: nine, check };
}

export interface CalibrationTiming {
  /** Time allowed for the eyes to travel to a new dot before anything is recorded. */
  settleMs: number;
  /** How long to record at each dot. */
  collectMs: number;
  /** Frames needed at a dot for it to count. */
  minFrames: number;
  /** Give up on a dot after this long (face out of view, eyes closed) and move on. */
  skipMs: number;
}

export const DEFAULT_TIMING: CalibrationTiming = { settleMs: 900, collectMs: 1100, minFrames: 8, skipMs: 6000 };

export type CalibrationPhase = 'settling' | 'collecting' | 'done';

export interface CalibrationStatus {
  phase: CalibrationPhase;
  /** Index of the current dot among all dots (fit then check). */
  index: number;
  total: number;
  /** The dot to show, as a fraction of the screen. Null when finished. */
  dot: Point | null;
  /** Whether the current dot is one of the accuracy checks. */
  checking: boolean;
  /** 0 to 1 through recording the current dot. */
  progress: number;
  /** No face, or eyes closed, right now. */
  waitingForFace: boolean;
}

export interface CalibrationResult {
  model: PersonalModel | null;
  /** Dots that were recorded, out of those shown. */
  recorded: number;
  shown: number;
}

/** Combine the frames recorded at one dot into a single steady reading. */
function summarise(rows: number[][]): number[] {
  const width = rows[0].length;
  const out: number[] = [];
  // The median of each input shrugs off the odd frame caught mid-blink or mid-glance.
  for (let i = 0; i < width; i++) out.push(median(rows.map((row) => row[i])));
  return out;
}

export class CalibrationSession {
  private readonly dots: Point[];
  private readonly fitCount: number;
  private index = 0;
  private dotStarted: number | null = null;
  private collectStarted: number | null = null;
  private rows: number[][] = [];
  private readonly fitSamples: Sample[] = [];
  private readonly checkSamples: Sample[] = [];
  private waiting = false;

  /**
   * @param source whether this is calibrating the eyes or head pointing
   * @param plan   where the dots go
   * @param screen the area the dots are placed in, in CSS pixels
   */
  constructor(
    private readonly source: PointerSource,
    plan: CalibrationPlan,
    private readonly screen: { width: number; height: number },
    private readonly timing: CalibrationTiming = DEFAULT_TIMING,
  ) {
    this.dots = [...plan.fit, ...plan.check];
    this.fitCount = plan.fit.length;
  }

  get done(): boolean {
    return this.index >= this.dots.length;
  }

  private next(now: number): void {
    this.index++;
    this.dotStarted = now;
    this.collectStarted = null;
    this.rows = [];
  }

  /** Feed one camera frame. */
  frame(features: FaceFeatures | null, now: number): CalibrationStatus {
    if (this.done) return this.status(now);
    this.dotStarted ??= now;

    const usable = !!features && !(this.source === 'gaze' && eyesClosed(features));
    this.waiting = !usable;

    const sinceDot = now - this.dotStarted;
    if (sinceDot >= this.timing.settleMs) {
      if (usable && features) {
        this.collectStarted ??= now;
        this.rows.push(designRow(this.source, features));
      }
      const collected = this.collectStarted === null ? 0 : now - this.collectStarted;
      if (collected >= this.timing.collectMs && this.rows.length >= this.timing.minFrames) {
        const dot = this.dots[this.index];
        const sample: Sample = {
          row: summarise(this.rows),
          x: dot.x * this.screen.width,
          y: dot.y * this.screen.height,
          origin: 'calibration',
        };
        if (this.index < this.fitCount) this.fitSamples.push(sample);
        else this.checkSamples.push(sample);
        this.next(now);
      } else if (sinceDot >= this.timing.skipMs) {
        // Could not get a reading here. Move on rather than trap the person on one dot.
        this.next(now);
      }
    }
    return this.status(now);
  }

  status(now: number): CalibrationStatus {
    if (this.done) {
      return { phase: 'done', index: this.dots.length, total: this.dots.length, dot: null, checking: false, progress: 1, waitingForFace: false };
    }
    const collected = this.collectStarted === null ? 0 : now - this.collectStarted;
    return {
      phase: this.collectStarted === null ? 'settling' : 'collecting',
      index: this.index,
      total: this.dots.length,
      dot: this.dots[this.index],
      checking: this.index >= this.fitCount,
      progress: Math.max(0, Math.min(1, collected / this.timing.collectMs)),
      waitingForFace: this.waiting,
    };
  }

  result(now: number): CalibrationResult {
    return {
      model: buildModel(this.source, this.fitSamples, this.screen, now, this.checkSamples),
      recorded: this.fitSamples.length + this.checkSamples.length,
      shown: this.dots.length,
    };
  }
}
