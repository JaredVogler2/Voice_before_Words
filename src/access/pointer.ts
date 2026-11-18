import type { Point } from './oneEuro';

/**
 * Dwell selection: look at (or point your head at) something for a moment and it
 * is chosen. This file is the decision logic only: given a pointer position and
 * the rectangles on screen, which target is being looked at, how far through its
 * dwell is it, and has it just been chosen. It knows nothing about the camera or
 * the page, which is what makes it testable.
 *
 * Camera pointing is imprecise, so three things make it usable:
 *  - Snapping: a pointer that lands near a target, but not on it, counts for
 *    the nearest one.
 *  - Stickiness: once a target has the pointer it keeps it until the pointer
 *    clearly leaves, so jitter at a border does not restart the timer.
 *  - Forgiveness: a blink or a lost frame pauses the dwell instead of cancelling it.
 *
 * And one thing keeps it safe. After a choice the screen often changes: a new
 * board opens, the next-word row fills with different words. Whatever now sits
 * under a pointer that has not moved was not chosen by the person, so it cannot
 * be selected until the pointer has been somewhere else. The same thing in the
 * same place (a letter typed twice, the next-page button) can be chosen again by
 * simply staying on it for longer.
 */

export interface Target {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  /** Multiplies the dwell time. Above 1 for things that should be harder to trigger by accident. */
  dwellScale?: number;
}

export interface DwellConfig {
  /** How long to look at something to choose it, in milliseconds. */
  dwellMs: number;
  /** How far outside a target the pointer may be and still count for it, as a share of the target's size. */
  snap: number;
  /**
   * How far past the edge the pointer must go to let go of a target, as a share
   * of its size. Small on purpose: it only has to absorb jitter at a border. A
   * pointer that is clearly inside the next target belongs to the next target.
   */
  stick: number;
  /** After choosing, nothing can be chosen for this long (lets the screen change and the eyes move on). */
  cooldownMs: number;
  /** Staying on the target that was just chosen starts a new dwell only after this long. */
  repeatMs: number;
  /** A dwell survives the pointer disappearing for up to this long (a blink). */
  graceMs: number;
}

export const DEFAULT_DWELL: DwellConfig = {
  dwellMs: 1000,
  snap: 0.45,
  stick: 0.15,
  cooldownMs: 350,
  repeatMs: 1600,
  graceMs: 450,
};

export interface DwellState {
  /** The target that currently has the pointer. */
  hover: string | null;
  /** 0 to 1 through its dwell. */
  progress: number;
  /** Set for exactly one update when a target is chosen. */
  selected: string | null;
}

function distanceOutside(target: Target, point: Point): number {
  const dx = Math.max(target.x - point.x, 0, point.x - (target.x + target.width));
  const dy = Math.max(target.y - point.y, 0, point.y - (target.y + target.height));
  return Math.hypot(dx, dy);
}

function inside(target: Target, point: Point, margin: number): boolean {
  const mx = target.width * margin;
  const my = target.height * margin;
  return (
    point.x >= target.x - mx &&
    point.x <= target.x + target.width + mx &&
    point.y >= target.y - my &&
    point.y <= target.y + target.height + my
  );
}

/** How much of the smaller of two rectangles lies inside the other, 0 to 1. */
function overlap(a: Target, b: Target): number {
  const width = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
  const height = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
  if (width <= 0 || height <= 0) return 0;
  const smaller = Math.min(a.width * a.height, b.width * b.height);
  return smaller > 0 ? (width * height) / smaller : 0;
}

/** The target a point belongs to: the one it is inside, else the nearest within snapping distance. */
export function pickTarget(targets: Target[], point: Point, snap: number): Target | null {
  let containing: Target | null = null;
  let containingCentre = Infinity;
  let near: Target | null = null;
  let nearDistance = Infinity;
  for (const target of targets) {
    const distance = distanceOutside(target, point);
    if (distance === 0) {
      // Inside more than one (overlap): the one whose centre is nearer wins.
      const centre = Math.hypot(point.x - (target.x + target.width / 2), point.y - (target.y + target.height / 2));
      if (centre < containingCentre) {
        containing = target;
        containingCentre = centre;
      }
    } else if (distance <= Math.min(target.width, target.height) * snap && distance < nearDistance) {
      near = target;
      nearDistance = distance;
    }
  }
  return containing ?? near;
}

export class DwellSelector {
  private hover: string | null = null;
  /** Dwell time accumulated on the hovered target, in milliseconds. */
  private elapsed = 0;
  private lastUpdate: number | null = null;
  private lastSeen = 0;
  private cooldownUntil = 0;
  /**
   * The last choice: what it was, where it was on the screen, and when staying
   * on it may start another dwell. Cleared once the pointer goes somewhere else.
   */
  private rest: { id: string; area: Target; until: number } | null = null;

  constructor(private config: DwellConfig = DEFAULT_DWELL) {}

  configure(config: DwellConfig): void {
    this.config = config;
  }

  reset(): void {
    this.hover = null;
    this.elapsed = 0;
    this.lastUpdate = null;
    this.rest = null;
  }

  /** Start a pause during which nothing can be chosen (for example after the screen changes). */
  hold(now: number, ms = this.config.cooldownMs): void {
    this.cooldownUntil = Math.max(this.cooldownUntil, now + ms);
    this.elapsed = 0;
  }

  /**
   * @param point   where the pointer is, or null when it is unknown (blink, face out of view)
   * @param targets what can be chosen right now
   * @param now     timestamp in milliseconds
   */
  update(point: Point | null, targets: Target[], now: number): DwellState {
    const step = this.lastUpdate === null ? 0 : Math.max(0, Math.min(now - this.lastUpdate, 250));
    this.lastUpdate = now;

    if (!point) {
      // Hold what we have through a blink; let go after a longer gap.
      if (this.hover && now - this.lastSeen > this.config.graceMs) {
        this.hover = null;
        this.elapsed = 0;
      }
      return this.snapshot(targets, null);
    }
    this.lastSeen = now;

    const current = this.hover ? targets.find((target) => target.id === this.hover) : undefined;
    let next: Target | null;
    if (current && inside(current, point, this.config.stick)) next = current;
    else next = pickTarget(targets, point, this.config.snap);

    // Has the pointer left the place where the last choice was made? Being on a
    // different target only counts if that target is somewhere else: something
    // new that appeared in the same spot does not.
    if (this.rest) {
      const stillThere = next ? next.id === this.rest.id || overlap(next, this.rest.area) > 0.5 : inside(this.rest.area, point, this.config.stick);
      if (!stillThere) this.rest = null;
    }

    if ((next?.id ?? null) !== this.hover) {
      this.hover = next?.id ?? null;
      this.elapsed = 0;
      return this.snapshot(targets, null);
    }
    if (!next) return this.snapshot(targets, null);

    if (now < this.cooldownUntil) return this.snapshot(targets, null);
    if (this.rest) {
      // Something else is now where the pointer was resting: look away first.
      if (this.rest.id !== next.id) return this.snapshot(targets, null);
      if (now < this.rest.until) return this.snapshot(targets, null);
      this.rest = null;
    }

    this.elapsed += step;
    const needed = this.config.dwellMs * (next.dwellScale ?? 1);
    if (this.elapsed >= needed) {
      this.elapsed = 0;
      this.cooldownUntil = now + this.config.cooldownMs;
      this.rest = { id: next.id, area: { ...next }, until: now + this.config.repeatMs };
      return this.snapshot(targets, next.id);
    }
    return this.snapshot(targets, null);
  }

  private snapshot(targets: Target[], selected: string | null): DwellState {
    const target = this.hover ? targets.find((item) => item.id === this.hover) : undefined;
    const needed = this.config.dwellMs * (target?.dwellScale ?? 1);
    return {
      hover: this.hover,
      progress: this.hover ? Math.max(0, Math.min(1, this.elapsed / needed)) : 0,
      selected,
    };
  }
}
