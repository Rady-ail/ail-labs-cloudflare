#!/usr/bin/env node
// AIL LABS local memory store (concept adapted from claude-mem, Apache-2.0, without its
// background worker or remote AI calls). Local JSONL, redacted, deduped, gitignored.
// Protocol: docs/memory-os/MEMORY_GRAPH.md. Repo is PUBLIC → store is never committed.
//   node scripts/memory.js add "fakta" --source "PR #12" --kind user|inferred [--supersedes m3]
//   node scripts/memory.js search "kata"     node scripts/memory.js list [--all]
//   node scripts/memory.js forget m3         (delete + verify)
'use strict';
const fs = require('node:fs');
const path = require('node:path');

const FILE = process.env.AIL_MEMORY_FILE || path.join(__dirname, '..', '.claude', 'memory', 'memory.jsonl');
const MAX_LEN = 500;

function redact(text) {
  return String(text)
    .replace(/sk-ant-[A-Za-z0-9_-]+|\bsk-[A-Za-z0-9]{20,}|\b(?:ghp|gho|ghs|github_pat)_[A-Za-z0-9_]+|\bAKIA[0-9A-Z]{16}\b/g, '[SECRET]')
    .replace(/\b[a-z]+:\/\/[^\s:@\/]+:[^\s@\/]+@/gi, '[CREDENTIAL-URL]@')
    .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '[EMAIL]')
    .replace(/(?:\+62|\b0)8[\d -]{7,14}\d/g, '[PHONE]')
    .replace(/\b\d{10,19}\b/g, '[NUMBER]')
    .replace(/\s+/g, ' ').trim().slice(0, MAX_LEN);
}

const norm = (s) => s.toLowerCase().replace(/[^a-z0-9À-￿]+/g, ' ').trim();

function readAll() {
  if (!fs.existsSync(FILE)) return [];
  return fs.readFileSync(FILE, 'utf8').split('\n').filter(Boolean).flatMap((l) => { try { return [JSON.parse(l)]; } catch { return []; } });
}
function writeAll(entries) {
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  const tmp = FILE + '.tmp';
  fs.writeFileSync(tmp, entries.map((e) => JSON.stringify(e)).join('\n') + (entries.length ? '\n' : ''));
  fs.renameSync(tmp, FILE);
}

function add(text, { source = 'unspecified', kind = 'inferred', supersedes } = {}) {
  if (!['user', 'inferred'].includes(kind)) throw new Error('kind harus user atau inferred');
  const clean = redact(text);
  if (!clean) throw new Error('fakta kosong');
  const all = readAll();
  const dup = all.find((e) => !e.superseded_by && norm(e.text) === norm(clean));
  if (dup) return { entry: dup, duplicate: true };
  const id = 'm' + (all.reduce((n, e) => Math.max(n, Number(e.id.slice(1)) || 0), 0) + 1);
  const entry = { id, text: clean, kind, source: redact(source), date: new Date().toISOString().slice(0, 10) };
  if (supersedes) {
    const old = all.find((e) => e.id === supersedes);
    if (!old) throw new Error('tidak ada memori ' + supersedes);
    old.superseded_by = id; // keep history
    entry.supersedes = supersedes;
  }
  all.push(entry);
  writeAll(all);
  return { entry, duplicate: false };
}

const list = ({ all = false } = {}) => readAll().filter((e) => all || !e.superseded_by);

function search(q) {
  const terms = norm(q).split(' ').filter(Boolean);
  return list().filter((e) => { const t = norm(e.text + ' ' + e.source); return terms.every((w) => t.includes(w)); });
}

function forget(id) {
  const all = readAll();
  const kept = all.filter((e) => e.id !== id);
  if (kept.length === all.length) return false;
  for (const e of kept) if (e.superseded_by === id) delete e.superseded_by;
  writeAll(kept);
  if (readAll().some((e) => e.id === id)) throw new Error('verifikasi hapus gagal untuk ' + id);
  return true;
}

function cli(argv) {
  const [cmd, ...rest] = argv;
  const flags = {};
  const pos = [];
  for (let i = 0; i < rest.length; i++) {
    if (rest[i].startsWith('--')) { const k = rest[i].slice(2); flags[k] = rest[i + 1] && !rest[i + 1].startsWith('--') ? rest[++i] : true; } else pos.push(rest[i]);
  }
  const show = (e) => `[${e.id}] ${e.text} (${e.kind}, ${e.source}, ${e.date}${e.superseded_by ? ', digantikan ' + e.superseded_by : ''})`;
  if (cmd === 'add') { const r = add(pos.join(' '), flags); console.log((r.duplicate ? 'SUDAH ADA ' : 'DISIMPAN ') + show(r.entry)); }
  else if (cmd === 'search') search(pos.join(' ')).forEach((e) => console.log(show(e)));
  else if (cmd === 'list') list({ all: !!flags.all }).forEach((e) => console.log(show(e)));
  else if (cmd === 'forget') console.log(forget(pos[0]) ? `DIHAPUS dan terverifikasi: ${pos[0]}` : `Tidak ditemukan: ${pos[0]}`);
  else { console.log('Pakai: add | search | list [--all] | forget <id>'); process.exitCode = 1; }
}

if (require.main === module) { try { cli(process.argv.slice(2)); } catch (e) { console.error('memory: ' + e.message); process.exitCode = 1; } }

module.exports = { add, list, search, forget, redact, FILE };
