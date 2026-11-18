# Eye pointing with an ordinary camera: what it can and cannot do

This explains how the app works out where someone is looking, how accurate
that was measured to be, and how those measurements shaped the design. It is
written to be honest about the limits, because for some of the people this app
is for, looking is the only way in.

## How it works

1. **Face landmarks.** The front camera's picture goes to MediaPipe's Face
   Landmarker, running in the browser. It gives 478 points on the face,
   including the outline of each iris, plus the position and tilt of the head.
   The picture is then discarded. Nothing is recorded or sent anywhere.
2. **Measurements.** From those points the app takes eight numbers: where each
   iris sits within its eye (across and up/down), how open the eyes are, how
   high the upper lids are, two "eye look" scores from the landmark model, and
   how far the head is turned and tipped (`src/access/features.ts`).
3. **A first guess from other people.** A small fixed model, fitted on
   photographs of 56 people, turns those numbers into a direction of gaze
   relative to the camera (`src/access/gazePrior.ts`). Geometry turns the
   direction into a point.
4. **A personal correction.** Calibration shows nine dots. A second small model
   is fitted to that one person: mostly a shift and a scale, plus small
   corrections that are held near zero unless the evidence for them is strong
   (`src/access/gazeModel.ts`).
5. **A steady pointer.** A One Euro filter removes jitter without adding much
   lag (`src/access/oneEuro.ts`).
6. **Choosing.** Resting on something for about a second chooses it
   (`src/access/pointer.ts`).

## What was measured

The Columbia Gaze Data Set has 5,880 photographs of 56 people, 21 of them
wearing glasses, each looking at 21 known directions (7 sideways by 3 up and
down) from 5 head positions. Each photograph was redrawn the way a front
camera would see the person (640 by 480 pixels, the face about 200 pixels
wide) and put through exactly the pipeline above. Every figure below was
measured on people the model had not seen: each person's first guess came from
a model fitted on the other 55.

| After calibrating with | Head still | Head turned 15° since | Head turned 30° since |
|---|---|---|---|
| 9 dots | **2.5°** typical; half of looks within 2.3°, 9 in 10 within 4.4° | 5.8° | 8.3° |
| 5 dots | 2.8°; 9 in 10 within 5.1° | 6.0° | 8.4° |
| 9 dots at each of three head positions | 2.7° | 2.9° | 6.6° |
| No calibration | 5.9° | | |

Other things the data showed:

- **Sideways and up/down are about equally hard**: 76% of looks land within 2°
  sideways and 71% within 2° up and down; 92% and 87% within 3°.
- **Noise from the camera alone** moves the estimate about 1° from frame to
  frame, which the filter removes.
- **A richer personal model does not help.** Adding squared and cross terms
  moved the typical error from 2.46° to between 2.38° and 2.52°, and made
  five-dot calibration worse. The remaining error is not a smooth distortion a
  better curve would fix.
- **The app's own estimate of a person's error is honest on average** (2.4°
  against a real 2.5°) but only loosely tied to the truth for any one person
  (correlation 0.63). A short calibration cannot tell someone at 1.8° from
  someone at 3°.

For scale: 2.5° is about 2 cm on a tablet at 45 cm, or 1.3 cm on a phone at
30 cm. A dedicated eye tracker manages 0.5° to 1°.

## What that means for the design

**Targets are sized in degrees, generously.** A target is the person's
measured error times 1.5, plus 4.5°: about 8° across on average. The fixed
allowance is there because the measured error cannot be trusted for one
person. With this rule a first look landed on the intended target 86 to 91% of
the time, depending on how far the device's pixels are from typical. The more
obvious rule (2.6 times the measured error) managed 69%, and left the people
whose error it underestimated with almost nothing they could hit.

| Rule | Typical target | First look lands |
|---|---|---|
| 2.6 × measured error | 6.1° | 69% |
| A fixed 8° for everyone | 8.0° | 87% |
| **1.5 × measured error + 4.5° (used)** | **8.0°** | **89%** |
| A fixed 10° for everyone | 10.0° | 94% |

The pointer and a filling ring show which target is about to be chosen for a
second before it is, so a wrong first landing can be corrected by looking again.

**Few targets, so words take two looks.** At 8° a tablet has room for about
four targets across and a phone two. Rather than show four words to a page,
each target holds a group of four words; looking at the group opens it into
four full-size targets. Sixteen words to a page on either device.

**Everything that can be chosen is full size.** The sentences and the controls
are targets in the same grid as the words. Sentences take a third longer to
choose than words, because something spoken cannot be taken back.

**Nothing new is chosen without a fresh look.** After a choice, whatever now
sits where the pointer already was cannot be chosen until the pointer has been
somewhere else. The same thing in the same place (a letter typed twice) can be
chosen again by staying on it for longer.

**The menu does not depend on pointing.** Holding the eyes closed for two
seconds opens it, and by default it is worked by scanning with a face gesture.
So when pointing has drifted there is still a way to recalibrate, pause, delete
or change method. It closes itself after 45 seconds if nothing is chosen.

**Head movement is the weak point, and the app says so.** A 15° turn of the
head roughly doubles the error. The result screen asks the person to keep
their head where it is and to calibrate again after moving. Calibrating at
several head positions would fix much of this (the third row of the table) and
is the most valuable thing not yet built.

## Checked inside the app

The figures above come from scripts. To check that the app itself behaves the
same way, photographs from the data set were fed into the running app as if
they were its camera, with a test script "looking" wherever the calibration dot
or the intended target was (`research/gaze/in-app/`). For the four people
tried, on a simulated 12-inch tablet:

- Calibration ran start to finish with no touch after the first.
- The pointer landed 1.6° to 2.3° from where the person was looking, at places
  that were not calibration dots, and the app's own estimate of pixels per
  degree was within about a tenth of the truth.
- For three people taken through the full board, every look aimed well inside
  a target chose that target (24 of 24), and so did every word chosen from an
  opened group (15 of 15), at about 1.4 seconds a choice. Looks aimed near the
  edge of a target chose it a little over half the time, as the figures above
  predict.
- After a 15° turn of the head the pointer was 3.4° to 11° off, depending on
  the person.

That is a small sample of still photographs. It shows the pipeline works as
designed; it does not show how well it works for a person.

It also caught two real faults before anyone met them: a target could keep
hold of the pointer after the pointer had clearly moved onto its neighbour, and
the slow correction for drift learned from those wrong choices and made the
next ones worse. Both are fixed and have tests.

## What is not known

- **Real use.** The photographs were taken with a good camera, in even light,
  with the head on a chin rest and the gaze within 15° of the camera. A
  hand-held phone, a bright window, glare on glasses, a head that will not keep
  still, or eyes that do not move together will all be harder. Expect worse
  than the figures here until someone measures it.
- **Children.** Everyone in the data set was an adult.
- **Looking up and down by moving the head.** Every head in the data set was
  level. The correction for a tipped head is geometry, not measurement.
- **Head pointing and face gestures.** Their logic is tested with simulated
  measurements. They have not been measured on people. Head position is
  measured several times more steadily than gaze (0.2° to 0.65° of noise), so
  head pointing should be finer than eye pointing, but that is an expectation.
- **Fatigue.** Holding a gaze for a second, hundreds of times, is tiring.

## Reproducing the figures

`research/gaze/` has the scripts. They need the data set, which is not included
and is licensed for non-commercial research only; see `NOTICE.md` for what that
means for this project.
