"""Evaluate the shipped design on people the model has not seen, then fit the population model on everyone.

    python3 fit_prior.py        (reads features_all.json, writes gaze_prior.json)

The numbers in src/access/gazePrior.ts are the "mean", "sd" and "weights" written here.
"""
import json
import os

import numpy as np

from common import FIVE, INPUTS, NINE, Data, distance, error_degrees

data = Data()
print(f'{len(data.rows)} photographs of {len(data.people)} people\n')

print('Typical error in degrees after calibrating with the head still, by how far the head has turned since:')
print(f"  {'calibration':28s} {'0':>6s} {'15':>6s} {'30':>6s}")
for label, dots, head in (('9 dots', NINE, (0,)), ('5 dots', FIVE, (0,)), ('9 dots at each of 3 head turns', NINE, (-15, 0, 15))):
    errors = {0: [], 15: [], 30: []}
    per_person = []
    for person in data.people:
        calibration = data.calibration(person, dots, head)
        used = {id(row) for row in calibration}
        model = data.personal(data.held_out[person], calibration)
        for turn in errors:
            test = [row for row in data.by[person] if abs(row['P']) == turn and id(row) not in used]
            if test:
                errors[turn].extend(error_degrees(model(test), test))
        still = [row for row in data.by[person] if row['P'] == 0 and id(row) not in used]
        per_person.append(distance(error_degrees(model(still), still)).mean())
    print(f"  {label:28s} " + ' '.join(f'{distance(errors[turn]).mean():6.2f}' for turn in errors))
    if head == (0,):
        still = distance(errors[0])
        print(f"  {'':28s} head still: median {np.median(still):.1f}, 9 in 10 looks within {np.percentile(still, 90):.1f}; worst person {max(per_person):.1f}; people above 4 degrees: {sum(e > 4 for e in per_person)}")

no_calibration = []
for person in data.people:
    rows = [row for row in data.by[person] if row['P'] == 0]
    no_calibration.extend(data.angles(data.held_out[person], rows) - np.array([[row['H'], row['V']] for row in rows]))
print(f'\nNo calibration at all (population model only): {distance(no_calibration).mean():.1f} degrees')

everyone = data.fit_population(data.rows)
if os.path.exists('features_noisy.json'):
    noisy = json.load(open('features_noisy.json'))
    key = lambda row: (row['subj'], row['P'], row['V'], row['H'])
    clean = {key(row): row for row in data.rows}
    pairs = [(clean[key(row)], row) for row in noisy if key(row) in clean]
    difference = data.angles(everyone, [a for a, _ in pairs]) - data.angles(everyone, [b for _, b in pairs])
    print(f'Jitter from sensor-like noise alone: {difference[:, 0].std() / np.sqrt(2):.2f} degrees sideways, {difference[:, 1].std() / np.sqrt(2):.2f} up and down, per frame')

out = {'inputs': INPUTS, 'mean': data.mean.round(6).tolist(), 'sd': data.sd.round(6).tolist(), 'weights': np.asarray(everyone[:-1]).round(5).tolist(), 'fittedOn': {'photographs': len(data.rows), 'people': len(data.people)}}
json.dump(out, open('gaze_prior.json', 'w'), indent=1)
print('\nWrote gaze_prior.json')
