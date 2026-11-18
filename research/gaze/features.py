"""landmarks_all.json (from extract_all.cjs) -> features_all.json: one row of measurements per photograph."""
import json
import sys

from common import features

source = sys.argv[1] if len(sys.argv) > 1 else 'landmarks_all.json'
rows, noisy = [], []
for record in json.load(open(source)):
    if record.get('w200') is None:
        continue
    labels = dict(subj=record['subj'], P=record['P'], V=record['V'], H=record['H'])
    rows.append({**features(record['w200']), **labels})
    if record.get('w200n') is not None:
        noisy.append({**features(record['w200n']), **labels})
json.dump(rows, open('features_all.json', 'w'))
json.dump(noisy, open('features_noisy.json', 'w'))
print(len(rows), 'rows;', len({row['subj'] for row in rows}), 'people;', len(noisy), 'with a noisy twin')
