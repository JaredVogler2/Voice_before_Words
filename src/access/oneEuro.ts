/**
 * One Euro filter (Casiez, Roussel & Vogel, CHI 2012).
 *
 * Camera-based gaze jitters by about a degree from frame to frame. A plain
 * average would steady it but make the pointer lag behind every glance. This
 * filter smooths heavily while the eyes rest on something and lightly while
 * they are moving, which is exactly what dwell selection needs.
 */
class Axis {
  private value: number | null = null;
  private speed = 0;
  private lastRaw: number | null = null;

  constructor(
    private minCutoff: number,
    private beta: number,
    private readonly speedCutoff = 1,
  ) {}

  tune(minCutoff: number, beta: number): void {
    this.minCutoff = minCutoff;
    this.beta = beta;
  }

  reset(): void {
    this.value = null;
    this.speed = 0;
    this.lastRaw = null;
  }

  private static alpha(cutoff: number, dt: number): number {
    const r = 2 * Math.PI * cutoff * dt;
    return r / (r + 1);
  }

  filter(raw: number, dt: number): number {
    const step = Math.max(dt, 1 / 240);
    const rawSpeed = this.lastRaw === null ? 0 : (raw - this.lastRaw) / step;
    this.lastRaw = raw;
    const a = Axis.alpha(this.speedCutoff, step);
    this.speed = a * rawSpeed + (1 - a) * this.speed;
    const cutoff = this.minCutoff + this.beta * Math.abs(this.speed);
    const b = Axis.alpha(cutoff, step);
    this.value = this.value === null ? raw : b * raw + (1 - b) * this.value;
    return this.value;
  }
}

export interface Point {
  x: number;
  y: number;
}

export class PointFilter {
  private readonly x: Axis;
  private readonly y: Axis;
  private last: number | null = null;

  /**
   * @param smoothing 1 (responsive) to 10 (very steady)
   * @param scale     a typical distance in pixels (the screen's shorter side), so the
   *                  same setting feels the same on a phone and a tablet
   */
  constructor(smoothing = 5, scale = 400) {
    const [minCutoff, beta] = PointFilter.parameters(smoothing, scale);
    this.x = new Axis(minCutoff, beta);
    this.y = new Axis(minCutoff, beta);
  }

  private static parameters(smoothing: number, scale: number): [number, number] {
    const level = Math.max(1, Math.min(10, smoothing));
    // Resting cut-off from 2.2 Hz (level 1) down to 0.25 Hz (level 10).
    const minCutoff = 2.2 * Math.pow(0.25 / 2.2, (level - 1) / 9);
    // Speed is in pixels per second, so the speed term is scaled by the screen size.
    const beta = 2.4 / Math.max(120, scale);
    return [minCutoff, beta];
  }

  tune(smoothing: number, scale: number): void {
    const [minCutoff, beta] = PointFilter.parameters(smoothing, scale);
    this.x.tune(minCutoff, beta);
    this.y.tune(minCutoff, beta);
  }

  reset(): void {
    this.x.reset();
    this.y.reset();
    this.last = null;
  }

  /** @param now timestamp in milliseconds */
  filter(point: Point, now: number): Point {
    const elapsed = this.last === null ? 1 / 30 : (now - this.last) / 1000;
    this.last = now;
    // After a long gap (blink, face lost) start fresh instead of gliding across the screen.
    if (elapsed > 0.6) {
      this.x.reset();
      this.y.reset();
    }
    const dt = elapsed > 0 && elapsed <= 0.6 ? elapsed : 1 / 30;
    return { x: this.x.filter(point.x, dt), y: this.y.filter(point.y, dt) };
  }
}
