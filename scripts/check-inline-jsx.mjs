// Lint sintaks untuk JSX inline di public/index.html (di-transform Babel di browser).
import { readFile } from 'node:fs/promises';
import { transform } from 'esbuild';

const html = await readFile(new URL('../public/index.html', import.meta.url), 'utf8');
const blocks = [...html.matchAll(/<script type="text\/babel"[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
if (!blocks.length) throw new Error('Tidak menemukan <script type="text/babel"> di public/index.html');
for (const code of blocks) await transform(code, { loader: 'jsx', format: 'esm' });
console.log(`index.html: ${blocks.length} blok JSX inline lolos cek sintaks`);
