/**
 * Turns one frame of face-landmark output into the handful of numbers the
 * access methods need: where the irises sit in the eyes, how open the eyes are,
 * which way the head points, and a few expressions that can act as a switch.
 *
 * Nothing here keeps or sends the image. The camera frame is read, reduced to
 * these numbers on the device, and discarded.
 */

export interface FaceFeatures {
  /** Iris position across the eye, averaged over both eyes (positive = toward the right of the image). */
  gh: number;
  /** Iris position up/down in the eye (positive = lower in the image). */
  gv: number;
  /** Horizontal and vertical "eye look" blendshape balance. */
  bsh: number;
  bsv: number;
  /** Eye opening and upper-lid height, in eye widths. */
  open: number;
  lid: number;
  /** Head pose in degrees. Yaw is positive toward the right of the image; pitch is positive when the face points down. */
  yaw: number;
  pitch: number;
  roll: number;
  /** Head position relative to the camera, roughly in centimetres. `tz` is negative in front of the camera. */
  tx: number;
  ty: number;
  tz: number;
  /** 0 = open, 1 = closed. */
  blinkLeft: number;
  blinkRight: number;
  /** Expressions usable as a switch, each roughly 0 to 1. */
  jawOpen: number;
  browsUp: number;
  smile: number;
}

export interface Landmark {
  x: number;
  y: number;
  z?: number;
}

interface EyeIndices {
  /** Corner on the left of the image, corner on the right of the image. */
  a: number;
  b: number;
  iris: number[];
  upper: number;
  lower: number;
}

// Indices into the 478-point face mesh. "Right eye" is the person's right, which
// appears on the left of an unmirrored camera image.
const RIGHT_EYE: EyeIndices = { a: 33, b: 133, iris: [468, 469, 470, 471, 472], upper: 159, lower: 145 };
const LEFT_EYE: EyeIndices = { a: 362, b: 263, iris: [473, 474, 475, 476, 477], upper: 386, lower: 374 };

export const REQUIRED_LANDMARKS = 478;

interface EyeMeasure {
  h: number;
  v: number;
  open: number;
  lid: number;
}

function measureEye(points: Landmark[], eye: EyeIndices, width: number, height: number): EyeMeasure {
  const px = (i: number) => points[i].x * width;
  const py = (i: number) => points[i].y * height;
  const ax = px(eye.a);
  const ay = py(eye.a);
  const bx = px(eye.b);
  const by = py(eye.b);
  const cx = (ax + bx) / 2;
  const cy = (ay + by) / 2;
  const w = Math.hypot(bx - ax, by - ay) || 1;
  // Unit vector along the eye, and its normal pointing down the image. Measuring
  // in this frame makes the numbers independent of head roll and face size.
  const ux = (bx - ax) / w;
  const uy = (by - ay) / w;
  let nx = -uy;
  let ny = ux;
  if (ny < 0) {
    nx = -nx;
    ny = -ny;
  }
  let ix = 0;
  let iy = 0;
  for (const i of eye.iris) {
    ix += px(i);
    iy += py(i);
  }
  ix /= eye.iris.length;
  iy /= eye.iris.length;
  const upx = px(eye.upper);
  const upy = py(eye.upper);
  const lox = px(eye.lower);
  const loy = py(eye.lower);
  return {
    h: ((ix - cx) * ux + (iy - cy) * uy) / w,
    v: ((ix - cx) * nx + (iy - cy) * ny) / w,
    open: ((lox - upx) * nx + (loy - upy) * ny) / w,
    lid: ((upx - cx) * nx + (upy - cy) * ny) / w,
  };
}

const DEGREES = 180 / Math.PI;

/**
 * @param landmarks   478 normalised landmarks for one face
 * @param blendshapes expression scores by name
 * @param matrix      4x4 face transform, column-major, as the landmark model reports it
 * @param width       frame width in pixels
 * @param height      frame height in pixels
 */
export function extractFeatures(
  landmarks: Landmark[],
  blendshapes: Record<string, number>,
  matrix: ArrayLike<number>,
  width: number,
  height: number,
): FaceFeatures | null {
  if (landmarks.length < REQUIRED_LANDMARKS || matrix.length < 16) return null;
  const right = measureEye(landmarks, RIGHT_EYE, width, height);
  const left = measureEye(landmarks, LEFT_EYE, width, height);
  const shape = (name: string) => blendshapes[name] ?? 0;

  // Column-major: element (row r, column c) is matrix[c * 4 + r].
  const r02 = matrix[8];
  const r12 = matrix[9];
  const r22 = matrix[10];
  const r10 = matrix[1];
  const r11 = matrix[5];

  const features: FaceFeatures = {
    gh: (right.h + left.h) / 2,
    gv: (right.v + left.v) / 2,
    open: (right.open + left.open) / 2,
    lid: (right.lid + left.lid) / 2,
    bsh: (shape('eyeLookOutLeft') - shape('eyeLookInLeft') + (shape('eyeLookInRight') - shape('eyeLookOutRight'))) / 2,
    bsv: (shape('eyeLookUpLeft') + shape('eyeLookUpRight') - shape('eyeLookDownLeft') - shape('eyeLookDownRight')) / 2,
    yaw: Math.atan2(r02, r22) * DEGREES,
    pitch: Math.asin(Math.max(-1, Math.min(1, -r12))) * DEGREES,
    roll: Math.atan2(r10, r11) * DEGREES,
    tx: matrix[12],
    ty: matrix[13],
    tz: matrix[14],
    blinkLeft: shape('eyeBlinkLeft'),
    blinkRight: shape('eyeBlinkRight'),
    jawOpen: shape('jawOpen'),
    browsUp: (shape('browInnerUp') + shape('browOuterUpLeft') + shape('browOuterUpRight')) / 3,
    smile: (shape('mouthSmileLeft') + shape('mouthSmileRight')) / 2,
  };
  for (const value of Object.values(features)) if (!Number.isFinite(value)) return null;
  return features;
}

/** Both eyes closed enough that the iris cannot be trusted. */
export function eyesClosed(features: FaceFeatures, threshold = 0.5): boolean {
  return Math.min(features.blinkLeft, features.blinkRight) > threshold;
}
