import type { FaceFeatures } from './features';

/**
 * Face gestures as a switch.
 *
 * A "press" is a gesture held for a deliberate length of time: long enough that
 * ordinary blinking and talking never trigger it, short enough to be easy.
 * Holding the eyes closed for much longer is a second, separate signal that
 * always opens the hands-free menu, so there is a way to pause, recalibrate or
 * change method no matter how badly pointing is going.
 */

export type GestureKind = 'blink' | 'brows' | 'mouth' | 'smile';

export interface GestureConfig {
  kind: GestureKind;
  /** How strong the gesture must be, 0 to 1. Lower is more sensitive. */
  threshold: number;
  /** How long it must be held to count, in milliseconds. */
  holdMs: number;
  /** Held longer than this, it is not a press (the person is resting, or their eyes are simply closed). */
  maxMs: number;
  /** Presses closer together than this are ignored. */
  refractoryMs: number;
}

export const DEFAULT_GESTURE: GestureConfig = {
  kind: 'blink',
  threshold: 0.55,
  holdMs: 350,
  maxMs: 1400,
  refractoryMs: 500,
};

/** Eyes held shut this long opens the hands-free menu. */
export const LONG_CLOSE_MS = 2200;

export function gestureStrength(kind: GestureKind, features: FaceFeatures): number {
  switch (kind) {
    case 'blink':
      // Both eyes, so that a wink or a squint on one side does not count.
      return Math.min(features.blinkLeft, features.blinkRight);
    case 'brows':
      return features.browsUp;
    case 'mouth':
      return features.jawOpen;
    case 'smile':
      return features.smile;
  }
}

export type GestureEvent = 'press' | 'long-close' | null;

export class GestureSwitch {
  private since: number | null = null;
  private lastPress = -Infinity;
  private closedSince: number | null = null;
  private longFired = false;

  constructor(private config: GestureConfig = DEFAULT_GESTURE) {}

  configure(config: GestureConfig): void {
    if (config.kind !== this.config.kind) this.since = null;
    this.config = config;
  }

  reset(): void {
    this.since = null;
    this.closedSince = null;
    this.longFired = false;
  }

  /** How far through a press the current hold is, 0 to 1, for showing feedback. */
  progress(now: number): number {
    if (this.since === null) return 0;
    return Math.max(0, Math.min(1, (now - this.since) / this.config.holdMs));
  }

  /**
   * @param features this frame's measurements, or null when no face is visible
   * @returns 'press' once when a deliberate gesture ends, 'long-close' once when the eyes have been shut a long time
   */
  update(features: FaceFeatures | null, now: number): GestureEvent {
    if (!features) {
      // Losing the face mid-gesture must not produce a press.
      this.since = null;
      this.closedSince = null;
      this.longFired = false;
      return null;
    }

    // The long eye-close works whatever gesture is configured.
    const shut = Math.min(features.blinkLeft, features.blinkRight) > 0.6;
    if (shut) {
      this.closedSince ??= now;
      if (!this.longFired && now - this.closedSince >= LONG_CLOSE_MS) {
        this.longFired = true;
        this.since = null;
        return 'long-close';
      }
    } else {
      this.closedSince = null;
      this.longFired = false;
    }

    const strength = gestureStrength(this.config.kind, features);
    const active = this.since !== null;
    // A little slack on release so a wavering gesture is not split in two.
    const held = strength > (active ? this.config.threshold * 0.7 : this.config.threshold);

    if (held) {
      this.since ??= now;
      return null;
    }
    if (this.since === null) return null;

    const duration = now - this.since;
    this.since = null;
    if (this.longFired && this.config.kind === 'blink') return null;
    if (duration < this.config.holdMs || duration > this.config.maxMs) return null;
    if (now - this.lastPress < this.config.refractoryMs) return null;
    this.lastPress = now;
    return 'press';
  }
}
