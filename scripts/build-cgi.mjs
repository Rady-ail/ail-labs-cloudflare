// Build modul CGI ke public/cgi/ (statis, kompatibel Cloudflare Assets).
// 1) chunk 3D mandiri (three + R3F + React sendiri), nama ber-hash -> boleh immutable.
// 2) core kecil yang memakai React halaman (jsDelivr) dan me-lazy-load chunk 3D.
import { build } from 'esbuild';
import { rm, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outdir = path.join(root, 'public/cgi');
const REACT_URL = 'https://cdn.jsdelivr.net/npm/react@19.0.0/+esm'; // sama persis dengan public/index.html

const common = {
  bundle: true,
  minify: true,
  format: 'esm',
  target: ['es2020', 'chrome90', 'safari15', 'firefox90'],
  legalComments: 'none',
  define: { 'process.env.NODE_ENV': '"production"' },
  logLevel: 'warning',
  metafile: true,
};

await rm(path.join(outdir, 'chunks'), { recursive: true, force: true });
await rm(path.join(outdir, 'cgi-core.js'), { force: true });
await mkdir(outdir, { recursive: true });

const hero = await build({
  ...common,
  entryPoints: { hero3d: path.join(root, 'components/cgi/hero3d/HeroScene.jsx') },
  outdir: path.join(outdir, 'chunks'),
  entryNames: '[name]-[hash]',
  jsx: 'automatic',
});
const heroFile = Object.keys(hero.metafile.outputs).find((f) => f.endsWith('.js'));
const heroUrl = '/' + path.relative(path.join(root, 'public'), path.join(root, heroFile)).split(path.sep).join('/');

const reactExternal = {
  name: 'react-from-page',
  setup(b) {
    b.onResolve({ filter: /^react$/ }, () => ({ path: REACT_URL, external: true }));
  },
};

const core = await build({
  ...common,
  entryPoints: { 'cgi-core': path.join(root, 'components/cgi/index.jsx') },
  outdir,
  jsx: 'transform',
  jsxFactory: 'React.createElement',
  jsxFragment: 'React.Fragment',
  define: { ...common.define, __CGI_HERO3D_URL__: JSON.stringify(heroUrl) },
  plugins: [reactExternal],
});

for (const meta of [core.metafile, hero.metafile]) {
  for (const [file, info] of Object.entries(meta.outputs)) {
    console.log(`${path.relative(root, file).padEnd(44)} ${(info.bytes / 1024).toFixed(1)} KiB`);
  }
}
