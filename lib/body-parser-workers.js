'use strict';

const querystring = require('node:querystring');

function createParser(type, parse) {
  return function parser(req, res, next) {
    if (req.body !== undefined || !req.is(type)) return next();

    const chunks = [];
    req.on('data', chunk => {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    });
    req.on('end', () => {
      try {
        req.body = parse(Buffer.concat(chunks));
        next();
      } catch (error) {
        error.status = 400;
        next(error);
      }
    });
    req.on('error', next);
  };
}

function json(options = {}) {
  return createParser(options.type || 'application/json', buffer => {
    if (buffer.length === 0) return {};
    const value = JSON.parse(buffer.toString(options.defaultCharset || 'utf8'));
    if (options.strict !== false && (value === null || typeof value !== 'object')) {
      throw new SyntaxError('JSON body must be an object or array');
    }
    return value;
  });
}

function raw(options = {}) {
  return createParser(options.type || 'application/octet-stream', buffer => buffer);
}

function text(options = {}) {
  return createParser(options.type || 'text/plain', buffer => buffer.toString(options.defaultCharset || 'utf8'));
}

function urlencoded(options = {}) {
  return createParser(options.type || 'application/x-www-form-urlencoded', buffer =>
    querystring.parse(buffer.toString(options.defaultCharset || 'utf8'))
  );
}

module.exports = { json, raw, text, urlencoded };