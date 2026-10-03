'use strict';

const fs = require('node:fs');
const path = require('node:path');

const expressEntry = require.resolve('express/lib/express');
const source = fs.readFileSync(expressEntry, 'utf8');
const original = "var bodyParser = require('body-parser')";
const replacement = "var bodyParser = require('../../../lib/body-parser-workers')";

if (source.includes(replacement)) process.exit(0);
if (!source.includes(original)) {
  throw new Error('Unexpected Express entry; cannot apply Workers body parser compatibility patch');
}

fs.writeFileSync(expressEntry, source.replace(original, replacement));