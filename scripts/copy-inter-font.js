const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const source = path.join(root, 'node_modules', '@fontsource-variable', 'inter', 'files', 'inter-latin-wght-normal.woff2');
const destinationDir = path.join(root, 'public', 'fonts');
const destination = path.join(destinationDir, 'inter-latin-wght-normal.woff2');

if (!fs.existsSync(source)) {
  console.error('Missing Inter variable Latin WOFF2. Run: npm install');
  process.exit(1);
}
fs.mkdirSync(destinationDir, { recursive: true });
fs.copyFileSync(source, destination);
const size = fs.statSync(destination).size;
if (size > 100 * 1024) {
  fs.unlinkSync(destination);
  throw new Error('Inter Latin WOFF2 exceeds 100 KB: ' + size);
}
console.log('Self-hosted Inter variable Latin font: ' + size + ' bytes');
