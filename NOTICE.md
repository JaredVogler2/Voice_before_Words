# What this project builds on

## Pictures

The symbols in `public/symbols/` are **not** under the MIT licence. They are
under the [Creative Commons Attribution-ShareAlike 4.0 International](https://creativecommons.org/licenses/by-sa/4.0/)
licence: they may be shared and adapted, including commercially, with credit,
and adaptations must be shared under the same terms.

- **Mulberry Symbols**, copyright 2018-2026 Steve Lee, <https://mulberrysymbols.org>
- **Otsimo symbol set**, copyright Otsimo, obtained from <https://globalsymbols.com/symbolsets/otsimo>
- Six symbols drawn for this project (`scripts/custom-symbols/`), same licence

Each file was reduced in size with SVGO and renamed; none was redrawn.
`public/symbols/ATTRIBUTION.md` lists the original name of every symbol used.

## Software shipped with the app

| | Licence |
|---|---|
| [MediaPipe Face Landmarker](https://ai.google.dev/edge/mediapipe/solutions/vision/face_landmarker) model and `@mediapipe/tasks-vision`, Google | Apache 2.0 |
| [Atkinson Hyperlegible Next](https://www.brailleinstitute.org/freefont/) typeface, Braille Institute of America | SIL Open Font Licence 1.1 |
| [React](https://react.dev) | MIT |
| [Zustand](https://github.com/pmndrs/zustand) | MIT |
| [Anthropic TypeScript SDK](https://github.com/anthropics/anthropic-sdk-typescript) (loaded only if Claude is chosen) | MIT |
| [Workbox](https://developer.chrome.com/docs/workbox) (offline support) | MIT |

## The data behind the gaze model

The numbers in `src/access/gazePrior.ts` were fitted on the Columbia Gaze Data
Set:

> B.A. Smith, Q. Yin, S.K. Feiner and S.K. Nayar, "Gaze Locking: Passive Eye
> Contact Detection for Human-Object Interaction", ACM Symposium on User
> Interface Software and Technology (UIST), 2013.
> <https://www.cs.columbia.edu/CAVE/databases/columbia_gaze/>

No photograph from the data set is included in this project, only a few dozen
numbers derived from it. The data set is made available for **non-commercial
research**. If this project is ever used commercially, either refit those
numbers on data you have the rights to (`research/gaze/` has the method), or
set `GAZE_PRIOR.enabled` to `false`, which makes the app rely on each person's
own calibration alone.

## Ideas

- The colour coding follows the modified Fitzgerald Key used across AAC.
- The pointer smoothing is the One Euro Filter (Casiez, Roussel and Vogel, 2012).
- The earlier iOS project UnlockVoice set the aims this one tries to meet.
