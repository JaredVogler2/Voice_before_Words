import type { FaceLandmarker } from '@mediapipe/tasks-vision';
import { extractFeatures, type FaceFeatures } from './features';

/**
 * The front camera and the face-landmark model.
 *
 * Everything happens on the device. The model file and its WebAssembly runtime
 * are served by this app itself, so no frame, landmark or measurement is sent
 * anywhere, and nothing is recorded: each frame is reduced to a few numbers and
 * thrown away.
 */

export type TrackerState = 'idle' | 'starting' | 'running' | 'error';

export type TrackerErrorKind =
  | 'unsupported' // no camera API here (old browser, or not a secure page)
  | 'denied' // permission was refused
  | 'no-camera'
  | 'busy' // another app is using the camera
  | 'model' // the face model could not be loaded
  | 'unknown';

export interface TrackerError {
  kind: TrackerErrorKind;
  message: string;
}

export interface FrameInfo {
  /** Timestamp in milliseconds (same clock as performance.now()). */
  time: number;
  /** Frames analysed per second, smoothed. */
  fps: number;
}

type FrameListener = (features: FaceFeatures | null, info: FrameInfo) => void;
type StateListener = (state: TrackerState, error: TrackerError | null) => void;

const ERROR_TEXT: Record<TrackerErrorKind, string> = {
  unsupported: 'This browser cannot use the camera here. Open the app over https in a current version of Safari, Chrome, Edge or Firefox.',
  denied: 'The camera was not allowed. Allow camera access for this site in the browser settings, then try again.',
  'no-camera': 'No camera was found on this device.',
  busy: 'The camera is being used by another app. Close it and try again.',
  model: 'The face-tracking engine could not be loaded. Check the connection and try again; after the first time it works offline.',
  unknown: 'The camera could not be started.',
};

function classify(error: unknown): TrackerErrorKind {
  const name = (error as { name?: string } | null)?.name ?? '';
  if (name === 'NotAllowedError' || name === 'SecurityError') return 'denied';
  if (name === 'NotFoundError' || name === 'OverconstrainedError') return 'no-camera';
  if (name === 'NotReadableError' || name === 'AbortError') return 'busy';
  return 'unknown';
}

/** The cache the service worker serves the face-tracking files from (see vite.config.ts). */
const OFFLINE_CACHE = 'face-tracking-v1';

/**
 * Keep the face-tracking files on the device once they have been used.
 *
 * They are too large to download for everyone up front, and on a first visit
 * the page is not yet under the service worker's control, so nothing would
 * save them. Saving them here means that someone who set up eye pointing with
 * a connection still has it the next time, without one.
 */
async function keepForOffline(urls: string[]): Promise<void> {
  if (typeof caches === 'undefined') return;
  try {
    const cache = await caches.open(OFFLINE_CACHE);
    for (const url of urls) {
      if (await cache.match(url)) continue;
      const response = await fetch(url);
      if (response.ok) await cache.put(url, response);
    }
  } catch {
    // No storage here, or no room left. Face tracking still works with a connection.
  }
}

/** No picture for this long, with the page in view, means the camera has stopped. */
const STALL_MS = 4000;
/** How many times in a row to restart a stalled camera before reporting a problem. */
const MAX_RESTARTS = 3;

type VideoWithCallback = HTMLVideoElement & {
  requestVideoFrameCallback?: (callback: () => void) => number;
  cancelVideoFrameCallback?: (handle: number) => void;
};

export class FaceTracker {
  private landmarker: FaceLandmarker | null = null;
  private video: VideoWithCallback | null = null;
  private mediaStream: MediaStream | null = null;
  private frameHandle: number | null = null;
  private usingVideoCallback = false;
  private lastProcessed = 0;
  private lastVideoTime = -1;
  private lastTimestamp = 0;
  private fps = 0;
  private starting: Promise<void> | null = null;
  /** When a picture last arrived (or the page last came back into view). */
  private lastAlive = 0;
  private runningSince = 0;
  private restarts = 0;
  private watchdog: ReturnType<typeof setInterval> | null = null;
  private readonly frameListeners = new Set<FrameListener>();
  private readonly stateListeners = new Set<StateListener>();
  private readonly shapes: Record<string, number> = {};

  state: TrackerState = 'idle';
  error: TrackerError | null = null;
  /** Analyse at most this many frames a second. Higher is smoother but warmer and harder on the battery. */
  maxFps = 24;

  /** The live camera stream, for showing a preview. */
  get stream(): MediaStream | null {
    return this.mediaStream;
  }

  onFrame(listener: FrameListener): () => void {
    this.frameListeners.add(listener);
    return () => this.frameListeners.delete(listener);
  }

  onState(listener: StateListener): () => void {
    this.stateListeners.add(listener);
    return () => this.stateListeners.delete(listener);
  }

  private setState(state: TrackerState, error: TrackerError | null = null): void {
    this.state = state;
    this.error = error;
    for (const listener of this.stateListeners) listener(state, error);
  }

  private fail(kind: TrackerErrorKind): void {
    this.release();
    this.stopWatchdog();
    this.setState('error', { kind, message: ERROR_TEXT[kind] });
  }

  // ── staying alive ─────────────────────────────────────────────────────────
  // A phone call, the screen sleeping or another app can take the camera away
  // without telling the page. For someone with no other way to use the app that
  // must not be the end of it, so a stalled camera is noticed and restarted.

  private readonly onVisibility = (): void => {
    if (document.hidden) return;
    this.lastAlive = performance.now();
    void this.video?.play().catch(() => undefined);
  };

  private startWatchdog(): void {
    if (this.watchdog !== null) return;
    this.watchdog = setInterval(() => this.checkAlive(), 1500);
    document.addEventListener('visibilitychange', this.onVisibility);
  }

  private stopWatchdog(): void {
    if (this.watchdog !== null) clearInterval(this.watchdog);
    this.watchdog = null;
    if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', this.onVisibility);
  }

  private checkAlive(): void {
    if (this.state !== 'running' || this.starting || document.hidden) return;
    const track = this.mediaStream?.getVideoTracks()[0];
    const ended = !track || track.readyState === 'ended';
    if (!ended && performance.now() - this.lastAlive < STALL_MS) return;
    void this.restart();
  }

  private restart(): Promise<void> {
    this.restarts++;
    this.release();
    if (this.restarts > MAX_RESTARTS) {
      this.fail('busy');
      return Promise.resolve();
    }
    this.starting = this.begin().finally(() => {
      this.starting = null;
    });
    return this.starting;
  }

  /** Turn the camera on and start analysing. Safe to call again while starting or running. */
  start(): Promise<void> {
    if (this.state === 'running') return Promise.resolve();
    this.starting ??= this.begin().finally(() => {
      this.starting = null;
    });
    return this.starting;
  }

  private async begin(): Promise<void> {
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      this.fail('unsupported');
      return;
    }
    this.setState('starting');

    try {
      this.mediaStream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          facingMode: 'user',
          width: { ideal: 640 },
          height: { ideal: 480 },
          frameRate: { ideal: 30, max: 30 },
        },
      });
    } catch (error) {
      this.fail(classify(error));
      return;
    }

    try {
      // An element that is in the page but out of sight: phones only deliver
      // frames to a video that is attached and allowed to play inline.
      const video = document.createElement('video') as VideoWithCallback;
      video.setAttribute('playsinline', '');
      video.setAttribute('aria-hidden', 'true');
      video.muted = true;
      video.autoplay = true;
      Object.assign(video.style, { position: 'fixed', width: '2px', height: '2px', opacity: '0', pointerEvents: 'none', left: '0', bottom: '0' });
      video.srcObject = this.mediaStream;
      document.body.appendChild(video);
      this.video = video;
      await video.play();
    } catch (error) {
      this.fail(classify(error));
      return;
    }

    try {
      if (!this.landmarker) {
        const vision = await import('@mediapipe/tasks-vision');
        // Served from this app's own folder, so it works offline and nothing is fetched from elsewhere.
        const base = new URL('mediapipe', document.baseURI).href;
        const fileset = await vision.FilesetResolver.forVisionTasks(base);
        this.landmarker = await vision.FaceLandmarker.createFromOptions(fileset, {
          baseOptions: {
            modelAssetPath: `${base}/face_landmarker.task`,
            // The processor path behaves the same on every phone; the graphics path is faster on some and broken on others.
            delegate: 'CPU',
          },
          runningMode: 'VIDEO',
          numFaces: 1,
          outputFaceBlendshapes: true,
          outputFacialTransformationMatrixes: true,
        });
        void keepForOffline([`${base}/vision_wasm_internal.js`, `${base}/vision_wasm_internal.wasm`, `${base}/face_landmarker.task`]);
      }
    } catch {
      this.fail('model');
      return;
    }

    // The camera may have been turned off again while the model was loading.
    if (!this.mediaStream || !this.video) return;
    this.lastAlive = performance.now();
    this.runningSince = this.lastAlive;
    this.setState('running');
    this.startWatchdog();
    this.schedule();
  }

  private schedule(): void {
    const video = this.video;
    if (!video || this.state !== 'running') return;
    if (video.requestVideoFrameCallback) {
      this.usingVideoCallback = true;
      this.frameHandle = video.requestVideoFrameCallback(() => this.tick());
    } else {
      this.usingVideoCallback = false;
      this.frameHandle = requestAnimationFrame(() => this.tick());
    }
  }

  private tick(): void {
    this.frameHandle = null;
    const video = this.video;
    const landmarker = this.landmarker;
    if (!video || !landmarker || this.state !== 'running') return;
    this.schedule();

    if (document.hidden || video.readyState < 2 || video.videoWidth === 0) return;
    const now = performance.now();
    if (now - this.lastProcessed < 1000 / this.maxFps - 2) return;
    if (video.currentTime === this.lastVideoTime) return;
    this.lastVideoTime = video.currentTime;
    this.lastAlive = now;
    // Pictures have been arriving steadily for a while: whatever went wrong earlier is over.
    if (now - this.runningSince > 10000) this.restarts = 0;

    // The model needs timestamps that always increase.
    const timestamp = Math.max(now, this.lastTimestamp + 1);
    this.lastTimestamp = timestamp;

    let features: FaceFeatures | null = null;
    try {
      const result = landmarker.detectForVideo(video, timestamp);
      const landmarks = result.faceLandmarks[0];
      const matrix = result.facialTransformationMatrixes[0];
      if (landmarks && matrix) {
        for (const category of result.faceBlendshapes[0]?.categories ?? []) this.shapes[category.categoryName] = category.score;
        features = extractFeatures(landmarks, this.shapes, matrix.data, video.videoWidth, video.videoHeight);
      }
    } catch {
      features = null;
    }

    if (this.lastProcessed > 0) {
      const instant = 1000 / Math.max(1, now - this.lastProcessed);
      this.fps = this.fps === 0 ? instant : this.fps * 0.9 + instant * 0.1;
    }
    this.lastProcessed = now;
    const info: FrameInfo = { time: now, fps: this.fps };
    for (const listener of this.frameListeners) listener(features, info);
  }

  private release(): void {
    const video = this.video;
    if (video && this.frameHandle !== null) {
      if (this.usingVideoCallback) video.cancelVideoFrameCallback?.(this.frameHandle);
      else cancelAnimationFrame(this.frameHandle);
    }
    this.frameHandle = null;
    this.mediaStream?.getTracks().forEach((track) => track.stop());
    this.mediaStream = null;
    if (video) {
      video.srcObject = null;
      video.remove();
    }
    this.video = null;
    this.lastProcessed = 0;
    this.lastVideoTime = -1;
    this.fps = 0;
  }

  /** Turn the camera off. The loaded model is kept so turning it back on is quick. */
  stop(): void {
    this.release();
    this.stopWatchdog();
    this.restarts = 0;
    if (this.state !== 'idle') this.setState('idle');
  }
}
