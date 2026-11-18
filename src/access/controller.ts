import { playCue } from '../speech/sounds';
import { CalibrationSession, calibrationPlan, type CalibrationResult, type CalibrationStatus } from './calibration';
import { FaceTracker, type TrackerError, type TrackerState } from './faceTracker';
import { eyesClosed, type FaceFeatures } from './features';
import { designRow, predict, withoutLastUseSample, withUseSample, type PersonalModel, type PointerSource } from './gazeModel';
import { GestureSwitch, type GestureKind } from './gestures';
import { median } from './linalg';
import { PointFilter, type Point } from './oneEuro';
import { DEFAULT_DWELL, DwellSelector } from './pointer';
import { DEFAULT_SCAN, Scanner } from './scanner';
import { collectTargets, type DomTarget } from './targets';

/**
 * The conductor for every way of using the app without touching it.
 *
 *   touch  nothing to do here; the browser handles taps
 *   gaze   front camera -> where the eyes are looking -> dwell to choose
 *   head   front camera -> where the nose is pointing -> dwell to choose
 *   dwell  any pointer the device already has (head mouse, eye tracker in
 *          mouse mode, trackball) -> dwell to choose
 *   scan   choices are highlighted in turn; one switch picks the highlighted one
 *
 * Whatever the method, choosing something ends in a click on the same element a
 * finger would tap.
 */

export type AccessMethod = 'touch' | 'gaze' | 'head' | 'dwell' | 'scan';

export interface AccessSettings {
  method: AccessMethod;
  /** How long to rest on something to choose it. */
  dwellMs: number;
  /** 1 (quick) to 10 (steady). */
  smoothing: number;
  showPointer: boolean;
  scanIntervalMs: number;
  scanPattern: 'group' | 'linear';
  /** A face gesture that acts as the switch when scanning. */
  switchGesture: GestureKind | 'none';
  /** 0.3 (very sensitive) to 0.8. */
  gestureThreshold: number;
  gestureHoldMs: number;
  /** Space, Enter and Bluetooth switches (which send those keys) act as the switch. */
  switchKeys: boolean;
  /** A tap anywhere on the screen acts as the switch. */
  switchTap: boolean;
  /** Holding the eyes closed opens the hands-free menu. */
  longCloseMenu: boolean;
  /**
   * How the menu is worked when pointing with eyes or head. 'switch' (scanning
   * and a face gesture) needs no pointing accuracy, so it still works when the
   * calibration has gone wrong; 'point' is for people who cannot make a gesture.
   */
  menuBy: 'switch' | 'point';
  /** Keep refining the gaze model from confirmed choices. */
  learnFromUse: boolean;
  /**
   * Choosing a word in two steps when pointing with eyes or head: first a group
   * of four, then the word. 'auto' uses it whenever the targets pointing needs
   * are so large that only a few words would otherwise fit on a page.
   */
  twoStep: 'auto' | 'on' | 'off';
  /** Volume of the small feedback sounds, 0 to 1. */
  cueVolume: number;
  calibrationPoints: 5 | 9;
}

export const DEFAULT_ACCESS: AccessSettings = {
  method: 'touch',
  dwellMs: 1100,
  smoothing: 6,
  showPointer: true,
  scanIntervalMs: 1300,
  scanPattern: 'group',
  switchGesture: 'blink',
  gestureThreshold: 0.55,
  gestureHoldMs: 350,
  switchKeys: true,
  switchTap: false,
  longCloseMenu: true,
  menuBy: 'switch',
  learnFromUse: false,
  twoStep: 'auto',
  cueVolume: 0.6,
  calibrationPoints: 9,
};

export interface AccessStatus {
  method: AccessMethod;
  /** Whether hands-free access is switched on right now. */
  active: boolean;
  camera: TrackerState;
  cameraError: TrackerError | null;
  /** A face is in view. */
  face: boolean;
  /** Selection is paused (the person is resting, or a caregiver is using the screen). */
  paused: boolean;
  /** There is a calibration for this method and this screen. */
  calibrated: boolean;
  /** Typical pointing error in CSS pixels, when known. */
  errorPx: number | null;
  /** Screen pixels per degree of gaze, when calibration could tell (eye pointing). */
  pxPerDegree: number | null;
  calibrating: boolean;
  fps: number;
}

export type AccessEvent =
  | { type: 'menu' }
  | { type: 'calibration'; status: CalibrationStatus }
  | { type: 'calibrated'; source: PointerSource; result: CalibrationResult }
  | { type: 'model'; key: string; model: PersonalModel };

export function usesCamera(method: AccessMethod, settings: Pick<AccessSettings, 'switchGesture' | 'longCloseMenu'>): boolean {
  if (method === 'gaze' || method === 'head') return true;
  if (method === 'scan') return settings.switchGesture !== 'none';
  return false;
}

export function viewportSize(): { width: number; height: number } {
  return { width: window.innerWidth, height: window.innerHeight };
}

/** Calibrations are kept per method and per screen orientation. */
export function modelKey(source: PointerSource, screen: { width: number; height: number }): string {
  return `${source}:${screen.width >= screen.height ? 'landscape' : 'portrait'}`;
}

/** A calibration only fits the screen it was made on. */
export function modelFits(model: PersonalModel | undefined, screen: { width: number; height: number }): model is PersonalModel {
  if (!model) return false;
  return Math.abs(model.screen.width - screen.width) / screen.width < 0.08 && Math.abs(model.screen.height - screen.height) / screen.height < 0.14;
}

export class AccessController {
  readonly tracker = new FaceTracker();
  private settings: AccessSettings = DEFAULT_ACCESS;
  private models: Record<string, PersonalModel> = {};
  private readonly dwell = new DwellSelector(DEFAULT_DWELL);
  private readonly scanner = new Scanner(DEFAULT_SCAN);
  private readonly gesture = new GestureSwitch();
  private readonly filter = new PointFilter();
  private readonly statusListeners = new Set<(status: AccessStatus) => void>();
  private readonly eventListeners = new Set<(event: AccessEvent) => void>();
  private calibration: { session: CalibrationSession; source: PointerSource } | null = null;
  private active = false;
  private paused = false;
  private face = false;
  private mouse: Point | null = null;
  private loop: number | null = null;
  private pointerElement: HTMLElement | null = null;
  private hovered: HTMLElement | null = null;
  private scanned: HTMLElement[] = [];
  /** A slowly adapting correction for small shifts in posture since calibration. */
  private drift: Point = { x: 0, y: 0 };
  /** Measurements gathered while resting on the current target. */
  private resting: { id: string; rows: number[][]; points: Point[] } | null = null;
  private lastLearnedKey: string | null = null;
  /** The last adjustment to `drift`, so it can be taken back if the choice is undone. */
  private lastDriftStep: Point | null = null;
  private wakeLock: { release(): Promise<void> } | null = null;
  private lastStatus = '';
  private cleanup: (() => void)[] = [];
  /** While the hands-free menu is open it is always worked by scanning. */
  private menuOpen = false;

  /**
   * The method in force right now. With a camera method, the menu switches to
   * scanning with a blink: that needs no pointing accuracy at all, so there is
   * always a way to pause, recalibrate or change method, even when the pointer
   * is badly off.
   */
  private get menuScanning(): boolean {
    const chosen = this.settings.method;
    return this.menuOpen && (chosen === 'gaze' || chosen === 'head') && this.settings.menuBy !== 'point';
  }

  private get method(): AccessMethod {
    return this.menuScanning ? 'scan' : this.settings.method;
  }

  private get switchGesture(): GestureKind | 'none' {
    if (this.menuScanning && this.settings.switchGesture === 'none') return 'blink';
    return this.settings.switchGesture;
  }

  /** Tell the controller the hands-free menu opened or closed. */
  setMenuOpen(open: boolean): void {
    if (this.menuOpen === open) return;
    this.menuOpen = open;
    this.clearFeedback();
    this.dwell.reset();
    this.scanner.restart();
    this.dwell.hold(performance.now(), 600);
  }

  constructor() {
    this.tracker.onFrame((features, info) => {
      this.fpsValue = info.fps;
      this.onFrame(features, info.time);
    });
    this.tracker.onState(() => {
      this.publish();
      this.retryCameraLater();
    });
  }

  private cameraRetry: ReturnType<typeof setTimeout> | null = null;

  /**
   * If the camera failed for a reason that may pass (another app has it, the
   * engine did not load), keep trying quietly while hands-free access is on.
   * The person may have no other way to ask for it.
   */
  private retryCameraLater(): void {
    if (this.cameraRetry !== null) clearTimeout(this.cameraRetry);
    this.cameraRetry = null;
    const kind = this.tracker.error?.kind;
    const mayPass = kind === 'busy' || kind === 'unknown' || kind === 'model';
    const wanted = this.active && (usesCamera(this.settings.method, this.settings) || !!this.calibration);
    if (this.tracker.state !== 'error' || !mayPass || !wanted) return;
    this.cameraRetry = setTimeout(() => {
      this.cameraRetry = null;
      if (!this.active) return;
      if (document.hidden) this.retryCameraLater();
      else void this.tracker.start();
    }, 8000);
  }

  // ── wiring ────────────────────────────────────────────────────────────────

  subscribe(listener: (status: AccessStatus) => void): () => void {
    this.statusListeners.add(listener);
    listener(this.status());
    return () => this.statusListeners.delete(listener);
  }

  on(listener: (event: AccessEvent) => void): () => void {
    this.eventListeners.add(listener);
    return () => this.eventListeners.delete(listener);
  }

  private emit(event: AccessEvent): void {
    for (const listener of this.eventListeners) listener(event);
  }

  private currentModel(): PersonalModel | undefined {
    const method = this.settings.method;
    if (method !== 'gaze' && method !== 'head') return undefined;
    const screen = viewportSize();
    const model = this.models[modelKey(method, screen)];
    return modelFits(model, screen) ? model : undefined;
  }

  status(): AccessStatus {
    const model = this.currentModel();
    const method = this.settings.method;
    return {
      method,
      active: this.active,
      camera: this.tracker.state,
      cameraError: this.tracker.error,
      face: this.face,
      paused: this.paused,
      calibrated: method === 'gaze' || method === 'head' ? !!model : true,
      errorPx: model ? model.errorPx : null,
      pxPerDegree: model?.pxPerDegree ?? null,
      calibrating: !!this.calibration,
      fps: Math.round(this.tracker.state === 'running' ? this.fpsValue : 0),
    };
  }

  private fpsValue = 0;

  private publish(): void {
    const status = this.status();
    const signature = JSON.stringify(status);
    if (signature === this.lastStatus) return;
    this.lastStatus = signature;
    for (const listener of this.statusListeners) listener(status);
  }

  /** Apply settings and saved calibrations. Call whenever either changes. */
  configure(settings: AccessSettings, models: Record<string, PersonalModel>): void {
    const methodChanged = settings.method !== this.settings.method;
    this.settings = settings;
    this.models = models;
    this.dwell.configure({ ...DEFAULT_DWELL, dwellMs: settings.dwellMs });
    this.scanner.configure({ ...DEFAULT_SCAN, intervalMs: settings.scanIntervalMs, pattern: settings.scanPattern });
    {
      this.gesture.configure({
        kind: settings.switchGesture === 'none' ? 'blink' : settings.switchGesture,
        threshold: settings.gestureThreshold,
        holdMs: settings.gestureHoldMs,
        maxMs: 1400,
        refractoryMs: 500,
      });
    }
    const size = viewportSize();
    this.filter.tune(settings.smoothing, Math.min(size.width, size.height));
    if (methodChanged) {
      this.clearFeedback();
      this.dwell.reset();
      this.scanner.restart();
      this.filter.reset();
      this.drift = { x: 0, y: 0 };
      if (this.active) void this.enable();
    }
    this.publish();
  }

  // ── switching on and off ──────────────────────────────────────────────────

  /**
   * Switch hands-free access on. The first call must come from a real touch or
   * key press: browsers only grant the camera, and only allow speech, after one.
   */
  async enable(): Promise<void> {
    this.active = true;
    this.paused = false;
    this.attach();
    const method = this.settings.method;
    if (usesCamera(method, this.settings)) await this.tracker.start();
    else this.tracker.stop();
    if (method !== 'touch') void this.keepAwake();
    this.startLoop();
    this.publish();
  }

  disable(): void {
    this.active = false;
    if (this.cameraRetry !== null) clearTimeout(this.cameraRetry);
    this.cameraRetry = null;
    this.calibration = null;
    this.tracker.stop();
    this.stopLoop();
    this.detach();
    this.clearFeedback();
    void this.wakeLock?.release().catch(() => undefined);
    this.wakeLock = null;
    this.publish();
  }

  setPaused(paused: boolean): void {
    this.paused = paused;
    this.dwell.reset();
    this.scanner.restart();
    this.clearFeedback();
    this.publish();
  }

  /** The screen changed (new page of tiles, a dialog opened): give the eyes a moment before anything can be chosen. */
  layoutChanged(): void {
    this.dwell.hold(performance.now(), 450);
    this.resting = null;
  }

  /** The last choice was undone straight away, so do not learn from it. */
  undoLearning(): void {
    if (this.lastDriftStep) {
      this.drift = { x: this.drift.x - this.lastDriftStep.x, y: this.drift.y - this.lastDriftStep.y };
      this.lastDriftStep = null;
    }
    if (!this.lastLearnedKey) return;
    const model = this.models[this.lastLearnedKey];
    if (model) this.emit({ type: 'model', key: this.lastLearnedKey, model: withoutLastUseSample(model) });
    this.lastLearnedKey = null;
  }

  private async keepAwake(): Promise<void> {
    try {
      const lock = (navigator as Navigator & { wakeLock?: { request(type: 'screen'): Promise<{ release(): Promise<void> }> } }).wakeLock;
      if (lock && !this.wakeLock && !document.hidden) this.wakeLock = await lock.request('screen');
    } catch {
      // Not available, or refused (low battery). The screen may dim; nothing else breaks.
    }
  }

  private attach(): void {
    if (this.cleanup.length > 0) return;
    const listen = <K extends keyof DocumentEventMap>(type: K, handler: (event: DocumentEventMap[K]) => void, options?: AddEventListenerOptions) => {
      document.addEventListener(type, handler as EventListener, options);
      this.cleanup.push(() => document.removeEventListener(type, handler as EventListener, options));
    };
    listen('mousemove', (event) => {
      this.mouse = { x: event.clientX, y: event.clientY };
    });
    listen('mouseleave', () => {
      this.mouse = null;
    });
    listen('keydown', (event) => this.onKey(event), { capture: true });
    listen('pointerdown', (event) => this.onTap(event), { capture: true });
    listen('click', (event) => this.swallowIfSwitchTap(event), { capture: true });
    listen('visibilitychange', () => {
      if (document.hidden) {
        this.wakeLock = null;
        this.dwell.reset();
        this.clearFeedback();
      } else if (this.active && this.settings.method !== 'touch') void this.keepAwake();
    });
    const onResize = () => {
      this.filter.reset();
      this.publish();
    };
    window.addEventListener('resize', onResize);
    this.cleanup.push(() => window.removeEventListener('resize', onResize));
  }

  private detach(): void {
    for (const remove of this.cleanup) remove();
    this.cleanup = [];
  }

  // ── switches for scanning ─────────────────────────────────────────────────

  private scanning(): boolean {
    return this.active && !this.calibration && this.method === 'scan' && (!this.paused || this.menuOpen);
  }

  private onKey(event: KeyboardEvent): void {
    if (!this.scanning() || !this.settings.switchKeys || event.repeat) return;
    if (event.key !== ' ' && event.key !== 'Enter') return;
    const typing = (event.target as HTMLElement | null)?.closest('input, textarea, select, [contenteditable]');
    if (typing) return;
    event.preventDefault();
    event.stopPropagation();
    this.pressSwitch();
  }

  private isDirect(target: EventTarget | null): boolean {
    return !!(target as HTMLElement | null)?.closest?.('[data-direct]');
  }

  private onTap(event: PointerEvent): void {
    if (!this.scanning() || !this.settings.switchTap || this.isDirect(event.target)) return;
    event.preventDefault();
    event.stopPropagation();
    this.pressSwitch();
  }

  /** While a tap anywhere is the switch, the tap must not also press whatever is under the finger. */
  private swallowIfSwitchTap(event: MouseEvent): void {
    if (!event.isTrusted) return; // clicks this controller makes itself must go through
    if (!this.scanning() || !this.settings.switchTap || this.isDirect(event.target)) return;
    event.preventDefault();
    event.stopPropagation();
  }

  private pressSwitch(): void {
    const targets = collectTargets();
    this.scanner.setItems(targets);
    const id = this.scanner.press(performance.now());
    if (id) {
      const target = targets.find((candidate) => candidate.id === id);
      if (target) this.activate(target);
    } else {
      playCue('step', this.settings.cueVolume);
    }
    this.renderScan(targets);
  }

  // ── the frame loop (dwell with a pointer device, and scanning) ────────────

  private startLoop(): void {
    if (this.loop !== null) return;
    const step = () => {
      this.loop = requestAnimationFrame(step);
      if (!this.active || this.calibration || document.hidden) return;
      if (this.paused && !this.menuOpen) return;
      const now = performance.now();
      if (this.method === 'dwell') this.point(this.mouse, now, null);
      else if (this.method === 'scan') {
        const targets = collectTargets();
        this.scanner.setItems(targets);
        const before = this.scanner.state().highlighted[0];
        this.scanner.tick(now);
        if (this.scanner.state().highlighted[0] !== before) playCue('step', this.settings.cueVolume * 0.5);
        this.renderScan(targets);
      }
    };
    this.loop = requestAnimationFrame(step);
  }

  private stopLoop(): void {
    if (this.loop !== null) cancelAnimationFrame(this.loop);
    this.loop = null;
  }

  // ── camera frames ─────────────────────────────────────────────────────────

  private onFrame(features: FaceFeatures | null, now: number): void {
    const hadFace = this.face;
    this.face = !!features;

    const gesture = this.switchGesture !== 'none' || this.settings.longCloseMenu ? this.gesture.update(features, now) : null;
    if (gesture === 'long-close' && this.settings.longCloseMenu && !this.calibration) {
      playCue('done', this.settings.cueVolume);
      this.emit({ type: 'menu' });
    }

    if (this.calibration) {
      const { session, source } = this.calibration;
      const before = session.status(now).index;
      const status = session.frame(features, now);
      if (status.index !== before) playCue(status.phase === 'done' ? 'done' : 'select', this.settings.cueVolume);
      this.emit({ type: 'calibration', status });
      if (session.done) {
        this.calibration = null;
        this.emit({ type: 'calibrated', source, result: session.result(now) });
        this.dwell.hold(performance.now(), 1200);
      }
      this.publish();
      return;
    }

    if (hadFace !== this.face) this.publish();
    if (!this.active || (this.paused && !this.menuOpen)) return;

    const method = this.method;
    if (method === 'scan') {
      if (gesture === 'press' && this.switchGesture !== 'none') this.pressSwitch();
      return;
    }
    if (method !== 'gaze' && method !== 'head') return;

    const model = this.currentModel();
    if (!model) {
      this.clearFeedback();
      return;
    }
    // Eyes closed: the iris cannot be seen, so hold still rather than guess.
    if (!features || (method === 'gaze' && eyesClosed(features))) {
      this.point(null, now, null);
      return;
    }
    const row = designRow(method, features);
    const [x, y] = predict(model.weights, row);
    const size = viewportSize();
    // Keep the pointer on the screen: an estimate that overshoots an edge then
    // lands on whatever sits along that edge, which is what the person meant.
    const clamp = (value: number, max: number) => Math.max(0, Math.min(max - 1, value));
    const raw = { x: clamp(x + this.drift.x, size.width), y: clamp(y + this.drift.y, size.height) };
    this.point(this.filter.filter(raw, now), now, row);
  }

  // ── pointing and dwelling ─────────────────────────────────────────────────

  private point(point: Point | null, now: number, row: number[] | null): void {
    const targets = collectTargets();
    const state = this.dwell.update(point, targets, now);
    this.renderPointer(point);

    const hover = state.hover ? targets.find((target) => target.id === state.hover) : undefined;
    if (hover?.element !== this.hovered) {
      this.hovered?.removeAttribute('data-hover');
      this.hovered?.style.removeProperty('--dwell');
      this.hovered = hover?.element ?? null;
      this.hovered?.setAttribute('data-hover', 'true');
    }
    this.hovered?.style.setProperty('--dwell', state.progress.toFixed(3));

    // Remember what the measurements looked like while resting here, for learning.
    if (hover && point && row) {
      if (this.resting?.id !== hover.id) this.resting = { id: hover.id, rows: [], points: [] };
      this.resting.rows.push(row);
      this.resting.points.push(point);
    } else if (!hover) this.resting = null;

    if (state.selected) {
      const target = targets.find((candidate) => candidate.id === state.selected);
      if (target) {
        this.learn(target);
        this.activate(target);
      }
    }
  }

  /** A choice was made, so the person was looking at that target: use it to stay calibrated. */
  private learn(target: DomTarget): void {
    const resting = this.resting;
    this.resting = null;
    this.lastDriftStep = null;
    const method = this.settings.method;
    if (!resting || resting.id !== target.id || resting.rows.length < 4 || (method !== 'gaze' && method !== 'head')) return;
    const centre = { x: target.x + target.width / 2, y: target.y + target.height / 2 };
    const seen = { x: median(resting.points.map((p) => p.x)), y: median(resting.points.map((p) => p.y)) };
    // Only a choice made with the pointer on the target says anything about
    // where the person was looking. One that was reached from outside (snapped
    // from a gap, or held on to at a border) does not, and learning from those
    // would push the pointer further off each time.
    const onTarget = seen.x >= target.x && seen.x <= target.x + target.width && seen.y >= target.y && seen.y <= target.y + target.height;
    if (!onTarget) return;
    // Nudge the whole pointer a little toward where choices actually land.
    const limit = 0.12 * Math.min(window.innerWidth, window.innerHeight);
    const bound = (value: number) => Math.max(-limit, Math.min(limit, value));
    const next = { x: bound(this.drift.x + 0.15 * (centre.x - seen.x)), y: bound(this.drift.y + 0.15 * (centre.y - seen.y)) };
    this.lastDriftStep = { x: next.x - this.drift.x, y: next.y - this.drift.y };
    this.drift = next;

    if (!this.settings.learnFromUse) return;
    const key = modelKey(method, viewportSize());
    const model = this.models[key];
    if (!model) return;
    const width = resting.rows[0].length;
    const row = Array.from({ length: width }, (_, i) => median(resting.rows.map((r) => r[i])));
    this.lastLearnedKey = key;
    this.emit({ type: 'model', key, model: withUseSample(model, row, centre.x, centre.y) });
  }

  private activate(target: DomTarget): void {
    playCue('select', this.settings.cueVolume);
    const element = target.element;
    element.setAttribute('data-chosen', 'true');
    window.setTimeout(() => element.removeAttribute('data-chosen'), 220);
    element.click();
  }

  // ── what the person sees ──────────────────────────────────────────────────

  private renderPointer(point: Point | null): void {
    const pointerMode = this.method === 'gaze' || this.method === 'head';
    if (!point || !this.settings.showPointer || !pointerMode) {
      if (this.pointerElement) this.pointerElement.style.opacity = '0';
      return;
    }
    if (!this.pointerElement) {
      this.pointerElement = document.createElement('div');
      this.pointerElement.className = 'access-pointer';
      this.pointerElement.setAttribute('aria-hidden', 'true');
      document.body.appendChild(this.pointerElement);
    }
    this.pointerElement.style.opacity = '1';
    this.pointerElement.style.transform = `translate(${point.x.toFixed(1)}px, ${point.y.toFixed(1)}px)`;
  }

  private renderScan(targets: DomTarget[]): void {
    const state = this.scanner.state();
    const lit = new Set(state.highlighted);
    const next = targets.filter((target) => lit.has(target.id)).map((target) => target.element);
    for (const element of this.scanned) if (!next.includes(element)) element.removeAttribute('data-scan');
    for (const element of next) element.setAttribute('data-scan', state.level);
    this.scanned = next;
  }

  private clearFeedback(): void {
    this.hovered?.removeAttribute('data-hover');
    this.hovered?.style.removeProperty('--dwell');
    this.hovered = null;
    for (const element of this.scanned) element.removeAttribute('data-scan');
    this.scanned = [];
    if (this.pointerElement) this.pointerElement.style.opacity = '0';
    this.resting = null;
  }

  // ── calibration ───────────────────────────────────────────────────────────

  /** Begin showing calibration dots for the eyes or the head. The camera must already be on. */
  async startCalibration(source: PointerSource): Promise<boolean> {
    this.active = true;
    this.attach();
    await this.tracker.start();
    if (this.tracker.state !== 'running') {
      this.publish();
      return false;
    }
    void this.keepAwake();
    // Calibration can be the first thing that switches hands-free access on
    // (from Settings), so the loop that drives scanning must be running too.
    this.startLoop();
    this.paused = false;
    this.clearFeedback();
    this.filter.reset();
    this.drift = { x: 0, y: 0 };
    this.calibration = {
      source,
      session: new CalibrationSession(source, calibrationPlan(this.settings.calibrationPoints), viewportSize()),
    };
    this.publish();
    return true;
  }

  cancelCalibration(): void {
    this.calibration = null;
    this.publish();
  }
}

/** One controller for the whole app. */
export const access = new AccessController();
