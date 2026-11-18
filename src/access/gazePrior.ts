/**
 * Population prior for webcam gaze estimation.
 *
 * A small linear model that turns eye and head measurements into a first guess
 * of where someone is looking, relative to the camera. Each person's own
 * calibration is then fitted on top of it (see gazeModel.ts), which is why a
 * handful of calibration points is enough.
 *
 * ── Where these numbers come from ──────────────────────────────────────────
 * They were fitted by ridge regression on the Columbia Gaze Data Set:
 *
 *   B.A. Smith, Q. Yin, S.K. Feiner and S.K. Nayar, "Gaze Locking: Passive Eye
 *   Contact Detection for Human-Object Interaction", ACM UIST 2013.
 *   https://www.cs.columbia.edu/CAVE/databases/columbia_gaze/
 *
 * 5,880 photographs of 56 people (21 wearing glasses) looking at 21 known
 * directions from 5 head poses. Each photo was scaled so the face was about
 * 200 px wide in a 640x480 frame, similar to what a phone's front camera sees,
 * and passed through the same face-landmark model this app runs.
 *
 * Measured leaving each person out of the fit in turn (typical error in degrees):
 *   - 9-dot personal calibration, head still:  2.5 mean, 2.3 median, 9 looks in 10 within 4.4
 *   - 5-dot personal calibration, head still:  2.8 mean, 9 looks in 10 within 5.1
 *   - after a 15 degree head turn:              5.8
 *   - calibrated across those head turns:       2.7 still, 2.9 after a 15 degree turn
 *   - no personal calibration at all:           5.9
 *
 * Those are still photographs in good light with the head on a chin rest. Real
 * use on a phone is harder. Treat them as the best case.
 *
 * The scripts that produced these coefficients and numbers are in
 * research/gaze/, and docs/eye-tracking.md explains what they mean for the app.
 *
 * ── Licence note ───────────────────────────────────────────────────────────
 * The data set is published for non-commercial research. The photographs are
 * not part of this app; only the fitted coefficients below are. If this project
 * is ever used commercially, refit these numbers on data you have the rights to
 * (research/gaze/ has the method) or set `GAZE_PRIOR.enabled` to false, in
 * which case personal calibration alone is used.
 */

export const GAZE_INPUTS = ['gh', 'gv', 'bsh', 'bsv', 'open', 'lid', 'yaw', 'pitch'] as const;
export type GazeInput = (typeof GAZE_INPUTS)[number];

export const GAZE_PRIOR = {
  enabled: true,
  /** Mean and spread of each input across the data set, used to put them on one scale. */
  mean: [0.008287, -0.07353, 0.108844, -0.072213, 0.335589, -0.219372, -1.016657, 0.061042],
  sd: [0.091476, 0.02384, 0.59832, 0.244458, 0.047217, 0.037761, 15.754718, 5.736277],
  /**
   * Degrees of gaze per unit of each standardised input: [horizontal, vertical].
   * Horizontal is positive toward the right of the camera image; vertical is
   * positive upward.
   */
  weights: [
    [13.05334, -1.03231], // gh    iris position across the eye
    [0.97086, -2.50239], // gv    iris position up/down in the eye
    [2.19959, 1.41211], // bsh   "eye look in/out" blendshapes
    [0.61819, -0.67881], // bsv   "eye look up/down" blendshapes
    [0.69529, -0.845], // open  how open the eyes are
    [0.12402, -4.70712], // lid   height of the upper lids
    [12.36367, 1.45271], // yaw   head turned left/right
    [-0.24325, 0.23387], // pitch head tipped up/down (see PITCH_GAIN)
  ],
} as const;

/**
 * Every head in the data set was held level, so it says nothing about nodding.
 * Geometry says tipping the head moves the gaze with it, and the yaw term above
 * came out at 0.78 degrees of gaze per measured degree of turn. Vertical is
 * given a slightly smaller share of that, on purpose: under-correcting is safer
 * than over-correcting for something that could not be measured.
 *
 * The measured pitch is positive when the face points down, hence the minus.
 */
export const PITCH_GAIN = -0.6;
