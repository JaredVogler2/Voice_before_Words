"""How big must a target be? Where the pointer errs, and how sizing rules trade size against hit rate.

    python3 sizing.py           (reads features_all.json)

A "hit" is a first look at the middle of a target landing inside it, for a target `size` wide and 0.9 x size tall.
"""
import numpy as np

from common import FIVE, NINE, UNITS_PER_DEGREE, Data, distance, error_degrees, screen

data = Data()


def slope(x, y):
    x, y = x - x.mean(), y - y.mean()
    return float((x * y).sum() / (x * x).sum())


print('Where the pointer errs (9 dots, head still), mean absolute error in degrees as sideways,up-down:')
cells = {}
for person in data.people:
    model = data.personal(data.held_out[person], data.calibration(person, NINE))
    rows = [row for row in data.by[person] if row['P'] == 0]
    for row, error in zip(rows, error_degrees(model(rows), rows)):
        cells.setdefault((row['V'], row['H']), []).append(error)
for v in (10, 0, -10):
    print(f'  looking {v:+3d} up: ' + '  '.join(f"{np.mean([abs(e[0]) for e in cells[(v, h)]]):.1f},{np.mean([abs(e[1]) for e in cells[(v, h)]]):.1f}" for h in (-15, -10, -5, 0, 5, 10, 15)))
pooled = np.array([e for key in cells for e in cells[key]])
for axis, name in ((0, 'sideways'), (1, 'up and down')):
    print(f'  share of looks within X degrees {name}: ' + ', '.join(f'{x}: {100 * (np.abs(pooled[:, axis]) < x).mean():.0f}%' for x in (2, 3, 4, 5)))

for label, dots, factor in (('9 dots', NINE, 0.7), ('5 dots', FIVE, 0.55)):
    people = []
    for person in data.people:
        calibration = data.calibration(person, dots)
        model = data.personal(data.held_out[person], calibration)
        test = [row for row in data.by[person] if row['P'] == 0 and (row['H'], row['V']) not in dots]
        # The app's own estimate of its error, and its estimate of pixels per degree relative to the truth.
        sideways = data.angles(data.held_out[person], calibration)[:, 0]
        measured = abs(slope(sideways, screen(calibration)[:, 0])) / UNITS_PER_DEGREE / 1.12
        people.append(dict(estimate=data.cross_checked(person, calibration) * factor, errors=error_degrees(model(test), test), scale=measured))
    estimates = np.array([p['estimate'] for p in people])
    actual = np.array([distance(p['errors']).mean() for p in people])
    print(f"\n{label}: the app's estimate of a person's error against the real thing: mean {estimates.mean():.2f} vs {actual.mean():.2f} degrees, correlation {np.corrcoef(estimates, actual)[0, 1]:.2f}")

    def score(rule):
        hits, sizes = [], []
        for p in people:
            size = rule(p)
            sizes.append(size)
            hits.extend((np.abs(p['errors'][:, 0]) < size / 2) & (np.abs(p['errors'][:, 1]) < 0.45 * size))
        return f'{np.mean(sizes):5.1f} degrees wide on average ({min(sizes):.1f} to {max(sizes):.1f}), first look lands {100 * np.mean(hits):3.0f}% of the time'

    for name, rule in (
        ('2.6 x estimate', lambda p: 2.6 * p['estimate']),
        ('3.0 x max(estimate, 2.0)', lambda p: 3.0 * max(p['estimate'], 2.0)),
        ('1.5 x estimate + 4.5', lambda p: 1.5 * p['estimate'] + 4.5),
        ('fixed 6', lambda p: 6.0),
        ('fixed 8', lambda p: 8.0),
        ('fixed 10', lambda p: 10.0),
    ):
        print(f'  {name:26s} {score(rule)}')
    # As shipped: degrees come from pixels-per-degree, which the app can only estimate (half from the
    # calibration, half from a typical device). `device` is this device's real value against that typical one.
    for device in (0.8, 1.0, 1.3):
        ratio = lambda p: min(55 / (33 * device), max(20 / (33 * device), np.sqrt(p['scale'] / device)))
        print(f"  as shipped, device {device:.1f}x     {score(lambda p: 1.5 * p['estimate'] + 4.5 * ratio(p))}")
    scale = np.array([p['scale'] for p in people])
    print(f'  pixels per degree from the calibration alone, against the truth: mean {scale.mean():.2f}, spread {scale.std():.2f}')
