# The gaze model: where its numbers come from

These scripts fitted the model in `src/access/gazePrior.ts` and produced every
figure in `docs/eye-tracking.md`. They are research code: not part of the app,
not run by its tests.

## The data

The [Columbia Gaze Data Set](https://www.cs.columbia.edu/CAVE/databases/columbia_gaze/)
(Smith, Yin, Feiner and Nayar, UIST 2013): 5,880 photographs of 56 people. It
is **not included here** and must be requested from its authors. It is licensed
for non-commercial research. Do not add its photographs to this repository.

## Steps

Run from the repository root, after `npm install`. The Python scripts need
`numpy`.

1. Face landmarks for every photograph, using the same model file the app
   ships. About 20 minutes.

   ```bash
   node research/gaze/extract_all.cjs --data /path/to/columbia/photos --out research/gaze/landmarks_all.json
   ```

2. The app's measurements for each photograph.

   ```bash
   cd research/gaze && python3 features.py
   ```

3. Evaluate the design on people the model has not seen, then fit the model on
   everyone. Writes `gaze_prior.json`, whose `mean`, `sd` and `weights` are the
   numbers in `src/access/gazePrior.ts`.

   ```bash
   python3 fit_prior.py
   ```

4. Where the pointer errs, and how rules for sizing targets trade size against
   how often a first look lands.

   ```bash
   python3 sizing.py
   ```

## Inside the running app

`in-app/` feeds photographs into the built app as if they were its camera, so
the whole path can be checked: calibration, the pointer, and choosing.

```bash
node research/gaze/in-app/prepare_frames.cjs --data /path/to/columbia/photos --out /somewhere/outside/the/repo/0003 --person 0003
```

```bash
npm run build && npm run preview -- --port 4173
```

```bash
node research/gaze/in-app/simulate.cjs --frames /somewhere/outside/the/repo/0003
```

Add `--width 390 --height 844 --span 5` for a phone held upright.

## The code

`common.py` holds the model itself, written to mirror `src/access/features.ts`
and `src/access/gazeModel.ts`. `tests/access.test.ts` checks the TypeScript
against values computed here (`tests/fixtures/gaze-features.json`, which is a
synthetic face, not a person from the data set).

The generated `.json` files are ignored by git: they are derived from the
photographs.
