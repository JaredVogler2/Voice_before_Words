"""Shared pieces for the gaze evaluation: features, the population model, the personal fit.

Everything mirrors what the app does in src/access/ (features.ts, gazeModel.ts), so the
numbers these scripts print are numbers about the shipped design.
"""
import json
import math

import numpy as np

INPUTS = ['gh', 'gv', 'bsh', 'bsv', 'open', 'lid', 'yaw', 'pitch']
NINE = {(h, v) for h in (-15, 0, 15) for v in (-10, 0, 10)}
FIVE = {(0, 0), (-15, -10), (15, -10), (-15, 10), (15, 10)}

R_EYE = dict(a=33, b=133, iris=[468, 469, 470, 471, 472], up=159, lo=145)
L_EYE = dict(a=362, b=263, iris=[473, 474, 475, 476, 477], up=386, lo=374)


def _eye(points, eye):
    a, b = points[eye['a']], points[eye['b']]
    centre = (a + b) / 2
    width = np.linalg.norm(b - a)
    along = (b - a) / width
    down = np.array([-along[1], along[0]])
    if down[1] < 0:
        down = -down
    iris = points[eye['iris']].mean(axis=0)
    return dict(
        h=np.dot(iris - centre, along) / width,
        v=np.dot(iris - centre, down) / width,
        open=np.dot(points[eye['lo']] - points[eye['up']], down) / width,
        lid=np.dot(points[eye['up']] - centre, down) / width,
    )


def features(record, width=640, height=480):
    """The app's measurements for one detected face (see src/access/features.ts)."""
    points = np.array(record['lm'])[:, :2] * np.array([width, height])
    r, l = _eye(points, R_EYE), _eye(points, L_EYE)
    bs = record['bs']
    m = np.array(record['mat']).reshape(4, 4).T
    rot, t = m[:3, :3], m[:3, 3]
    return dict(
        gh=(r['h'] + l['h']) / 2, gv=(r['v'] + l['v']) / 2,
        open=(r['open'] + l['open']) / 2, lid=(r['lid'] + l['lid']) / 2,
        bsh=((bs['eyeLookOutLeft'] - bs['eyeLookInLeft']) + (bs['eyeLookInRight'] - bs['eyeLookOutRight'])) / 2,
        bsv=(bs['eyeLookUpLeft'] + bs['eyeLookUpRight'] - bs['eyeLookDownLeft'] - bs['eyeLookDownRight']) / 2,
        yaw=math.degrees(math.atan2(rot[0, 2], rot[2, 2])),
        pitch=math.degrees(math.asin(max(-1, min(1, -rot[1, 2])))),
        roll=math.degrees(math.atan2(rot[1, 0], rot[1, 1])),
        tx=t[0], ty=t[1], tz=t[2],
    )


def X(rows, names):
    return np.array([[row[name] for name in names] for row in rows], float)


def Y(rows):
    """True gaze direction relative to the camera, in degrees: [sideways, up]."""
    return np.array([[row['H'], row['V']] for row in rows], float)


def distance(errors):
    errors = np.array(errors)
    return np.hypot(errors[:, 0], errors[:, 1])


class Data:
    def __init__(self, path='features_all.json'):
        self.rows = json.load(open(path))
        self.people = sorted({row['subj'] for row in self.rows})
        self.by = {person: [row for row in self.rows if row['subj'] == person] for person in self.people}
        self.mean = X(self.rows, INPUTS).mean(0)
        self.sd = X(self.rows, INPUTS).std(0)
        # One population model per person, fitted on everyone else, so nobody is tested on a model that has seen them.
        self.held_out = {p: self.fit_population([r for q in self.people if q != p for r in self.by[q]]) for p in self.people}

    def z(self, rows):
        return (X(rows, INPUTS) - self.mean) / self.sd

    def fit_population(self, rows, penalty=1.0):
        a = np.hstack([self.z(rows), np.ones((len(rows), 1))])
        ridge = np.eye(a.shape[1]) * penalty
        ridge[-1, -1] = 0
        return np.linalg.solve(a.T @ a + ridge, a.T @ Y(rows))

    def angles(self, weights, rows):
        return np.hstack([self.z(rows), np.ones((len(rows), 1))]) @ weights

    def plane(self, weights, rows):
        """Where the line of sight meets the camera's plane (gazeModel.ts: planePoint)."""
        ang = np.radians(self.angles(weights, rows))
        d = -X(rows, ['tz'])[:, 0]
        return np.column_stack([X(rows, ['tx'])[:, 0] + d * np.tan(ang[:, 0]), X(rows, ['ty'])[:, 0] + d * np.tan(ang[:, 1])])

    def personal(self, weights, calibration, plane_penalty=0.05, correction_penalty=5.0):
        """One weighted ridge from this person's calibration (gazeModel.ts: fitWeights)."""
        design = lambda rows: np.hstack([self.plane(weights, rows), self.z(rows), np.ones((len(rows), 1))])
        a = design(calibration)
        penalty = np.array([plane_penalty] * 2 + [correction_penalty] * len(INPUTS) + [0.0])
        fitted = np.linalg.solve(a.T @ a + np.diag(penalty), a.T @ screen(calibration))
        return lambda rows: design(rows) @ fitted

    def calibration(self, person, dots, head=(0,)):
        return [row for row in self.by[person] if row['P'] in head and (row['H'], row['V']) in dots]

    def cross_checked(self, person, calibration):
        """Leave each dot out in turn (gazeModel.ts: crossCheckedError), in degrees."""
        errors = []
        for i in range(len(calibration)):
            model = self.personal(self.held_out[person], calibration[:i] + calibration[i + 1:])
            errors.append(distance(error_degrees(model([calibration[i]]), [calibration[i]]))[0])
        return float(np.mean(errors))


def screen(rows):
    """Where the targets really are on a plane 30 units away: a stand-in for screen position."""
    return 30.0 * np.tan(np.radians(Y(rows)))


def error_degrees(predicted, rows):
    return np.degrees(np.arctan(predicted / 30.0)) - Y(rows)


UNITS_PER_DEGREE = 30.0 * math.tan(math.radians(1.0))
