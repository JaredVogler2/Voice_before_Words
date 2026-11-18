// Builds the bundled symbol library.
//
//   node scripts/build-symbols.mjs --mulberry <dir> --otsimo <dir>
//
// Reads scripts/symbol-sources.json (vocabulary id -> source symbol), copies and
// optimises just those pictures into public/symbols/, and writes
// src/vocab/symbols.json (vocabulary id -> bundled file) plus the attribution
// file that the licences require.
//
// The output is committed, so an ordinary build never needs this script or the
// source sets. Run it only after changing which picture a word uses.
//
// Where the sources come from:
//   Mulberry Symbols   https://github.com/mulberrysymbols/mulberry-symbols  (folder EN/)
//   Otsimo symbols     https://globalsymbols.com/symbolsets/otsimo  (SVGs, named after their English label)
//   custom             scripts/custom-symbols/ in this repository
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { optimize } from 'svgo';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const option = (name) => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 ? args[index + 1] : undefined;
};
const sourceDirs = {
  mulberry: option('mulberry'),
  otsimo: option('otsimo'),
  custom: join(root, 'scripts', 'custom-symbols'),
};
const shortName = { mulberry: 'm', otsimo: 'o', custom: 'x' };

for (const set of ['mulberry', 'otsimo']) {
  if (!sourceDirs[set] || !existsSync(sourceDirs[set])) {
    console.error(`Missing --${set} <directory of .svg files>. See the notes at the top of this script.`);
    process.exit(1);
  }
}

const slug = (name) =>
  name
    .toLowerCase()
    .replace(/_,_to$/, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

const sources = JSON.parse(await readFile(join(root, 'scripts', 'symbol-sources.json'), 'utf8'));
const outRoot = join(root, 'public', 'symbols');
for (const short of Object.values(shortName)) await rm(join(outRoot, short), { recursive: true, force: true });

const mapping = {};
const written = new Map(); // "set/name" -> "m/slug"
const usedSlugs = new Set();
const credits = { mulberry: [], otsimo: [], custom: [] };
let before = 0;
let after = 0;

for (const [id, source] of Object.entries(sources)) {
  if (!source) continue;
  const [set, ...rest] = source.split('/');
  const name = rest.join('/');
  if (!shortName[set]) throw new Error(`Unknown symbol set "${set}" for ${id}`);
  if (!written.has(source)) {
    const file = join(sourceDirs[set], `${name}.svg`);
    if (!existsSync(file)) throw new Error(`No such symbol: ${file} (for "${id}")`);
    let key = `${shortName[set]}/${slug(name)}`;
    for (let n = 2; usedSlugs.has(key); n++) key = `${shortName[set]}/${slug(name)}-${n}`;
    usedSlugs.add(key);
    const raw = await readFile(file, 'utf8');
    const result = optimize(raw, {
      multipass: true,
      // The default preset keeps the viewBox, which is what lets a symbol scale to any tile size.
      plugins: ['preset-default', 'removeDimensions'],
    });
    const out = join(outRoot, `${key}.svg`);
    await mkdir(dirname(out), { recursive: true });
    await writeFile(out, result.data);
    before += raw.length;
    after += result.data.length;
    written.set(source, key);
    credits[set].push(name);
  }
  mapping[id] = written.get(source);
}

await writeFile(join(root, 'src', 'vocab', 'symbols.json'), `${JSON.stringify(mapping, null, 1)}\n`);

const list = (names) => names.sort((a, b) => a.localeCompare(b)).join(', ');
await writeFile(
  join(outRoot, 'ATTRIBUTION.md'),
  `# Symbols in this folder

The pictures in this folder are **not** covered by the MIT licence that applies
to the app's code. They are licensed under the
[Creative Commons Attribution-ShareAlike 4.0 International licence](https://creativecommons.org/licenses/by-sa/4.0/)
(CC BY-SA 4.0). You may share and adapt them, including commercially, as long as
you give credit and license your adaptations under the same terms.

## m/ — Mulberry Symbols

Copyright 2018-2026 Steve Lee. https://mulberrysymbols.org
Source: https://github.com/mulberrysymbols/mulberry-symbols (folder \`EN/\`), CC BY-SA 4.0.

## o/ — Otsimo symbols

Copyright Otsimo (Ersin Kiymaz, Naz Yilmaz, Ersin Sinay). https://otsimo.com/en/
Source: https://globalsymbols.com/symbolsets/otsimo, CC BY-SA 4.0.

## x/ — drawn for this project

Copyright the Voice Before Words contributors, CC BY-SA 4.0. Sources are in
\`scripts/custom-symbols/\`.

## Changes made

Every file was passed through [SVGO](https://github.com/svg/svgo) to reduce its
size, which does not change how it looks, and renamed. No picture was redrawn.
The list below gives the original name of every symbol used, so each one can be
traced back to its source.

### Mulberry (${credits.mulberry.length})

${list(credits.mulberry)}

### Otsimo (${credits.otsimo.length})

${list(credits.otsimo)}

### Custom (${credits.custom.length})

${list(credits.custom)}
`,
);

const files = (await Promise.all(Object.values(shortName).map(async (short) => (existsSync(join(outRoot, short)) ? readdir(join(outRoot, short)) : [])))).flat();
console.log(`symbols: ${Object.keys(mapping).length} words -> ${files.length} pictures, ${(before / 1048576).toFixed(1)} MB -> ${(after / 1048576).toFixed(1)} MB`);
