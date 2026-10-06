const fs = require('node:fs');
const path = require('node:path');

const homepage = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');

const forbidden = [
  '7215584640',
  'FALABS@icloud.com',
];

for (const token of forbidden) {
  if (homepage.includes(token)) {
    throw new Error(`Forbidden public token found: ${token}`);
  }
}

const required = [
  'Request Quotation',
  'NIB 0308260088951',
  'PBF 46444',
  'BPOM',
  'Halal mandatory 17 Oct 2026',
  'Porcine-Free',
  'ISO22716',
  '+62 818-4555-59',
];

for (const token of required) {
  if (!homepage.includes(token)) {
    throw new Error(`Required B2B homepage token missing: ${token}`);
  }
}

if (!homepage.includes('/api/products')) {
  throw new Error('Catalog API integration missing.');
}

if (!homepage.includes('2–25°C')) {
  throw new Error('Cold-chain trust copy missing.');
}

console.log('AIL LABS B2B homepage validation: PASS');
