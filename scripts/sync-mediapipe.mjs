// Copies the face-tracking WebAssembly runtime out of node_modules so the app
// can self-host it (no third-party CDN at run time, and it works offline once
// cached). The model file itself is committed in public/mediapipe/.
import { copyFile, mkdir, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const from = join(root, 'node_modules', '@mediapipe', 'tasks-vision', 'wasm');
const to = join(root, 'public', 'mediapipe');
const files = ['vision_wasm_internal.js', 'vision_wasm_internal.wasm'];

await mkdir(to, { recursive: true });
for (const file of files) {
  const src = join(from, file);
  const dst = join(to, file);
  const [a, b] = await Promise.all([stat(src), stat(dst).catch(() => null)]);
  if (b && b.size === a.size) continue;
  await copyFile(src, dst);
  console.log(`mediapipe: copied ${file} (${(a.size / 1048576).toFixed(1)} MB)`);
}
