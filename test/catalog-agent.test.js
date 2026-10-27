// Jalankan: node test/catalog-agent.test.js  (tanpa DB/API sungguhan: pool dan fetch di-mock)
const assert = require('assert');
const Module = require('module');
const calls = { sql: [], fetch: [] };
let colMissing = false;
const fakePool = { query: async (sql, params) => {
  calls.sql.push({ sql, params });
  if (colMissing && /p\.manfaat|manfaat/.test(sql)) { const e = new Error('column "manfaat" does not exist'); e.code = '42703'; throw e; }
  if (/FROM products/.test(sql)) return { rows: [{ name: 'PureEssence VitC', kategori: 'Serum', kandungan: 'Serum Vit C 15%', kemasan: 'Botol 15ml', harga: 45000, manfaat: colMissing ? undefined : 'Antioksidan.' }] };
  return { rows: [] };
} };
const origLoad = Module._load;
Module._load = function (req, ...a) { return /db\/pool$/.test(req) ? fakePool : origLoad.call(this, req, ...a); };
process.env.ANTHROPIC_API_KEY = 'test';
const agent = require('../lib/catalog-agent');

(async () => {
  assert.deepStrictEqual(agent.tokenize('Serum  pencerah!!'), ['serum', 'pencerah']);
  assert.deepStrictEqual(agent.tokenize('%%'), []);
  // harga hanya untuk approved
  let r = await agent.searchCatalog('serum vit c', false);
  assert.strictEqual(r[0].harga_idr, undefined); assert.strictEqual(r[0].manfaat, 'Antioksidan.');
  r = await agent.searchCatalog('serum vit c', true);
  assert.strictEqual(r[0].harga_idr, 45000);
  assert.ok(calls.sql[0].sql.includes('manfaat') && calls.sql[0].params.length === 3 && calls.sql[0].params[2] === 8);
  // kolom manfaat belum dimigrasi -> fallback tanpa error
  colMissing = true; delete require.cache[require.resolve('../lib/catalog-agent')];
  const agent2 = require('../lib/catalog-agent');
  r = await agent2.searchCatalog('serum', true);
  assert.strictEqual(r[0].nama, 'PureEssence VitC'); assert.strictEqual(r[0].manfaat, undefined);
  // loop tool: Claude minta search_catalog lalu menjawab; harga tidak bocor untuk non-approved
  let step = 0;
  global.fetch = async (url, opt) => {
    const body = JSON.parse(opt.body); calls.fetch.push(body);
    if (step++ === 0) return { ok: true, json: async () => ({ stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 't1', name: 'search_catalog', input: { query: 'serum' } }] }) };
    const tr = body.messages[body.messages.length - 1].content[0].content;
    assert.ok(!/harga_idr/.test(tr), 'harga bocor ke model untuk customer non-approved');
    return { ok: true, json: async () => ({ stop_reason: 'end_turn', content: [{ type: 'text', text: 'Ada PureEssence VitC.' }] }) };
  };
  const out = await agent2.answerWithAgent({ teks: 'serum', nomor: '62811', priceVisible: false });
  assert.strictEqual(out, 'Ada PureEssence VitC.');
  // handoff
  step = 0;
  global.fetch = async (u, opt) => {
    if (step++ === 0) return { ok: true, json: async () => ({ stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 't2', name: 'handoff_to_admin', input: { reason: 'minta PO', summary: 'x' } }] }) };
    return { ok: true, json: async () => ({ stop_reason: 'end_turn', content: [{ type: 'text', text: 'Admin akan melanjutkan.' }] }) };
  };
  let got; await agent2.answerWithAgent({ teks: 'mau PO', nomor: '62822', priceVisible: false, onHandoff: async (i) => { got = i; } });
  assert.deepStrictEqual(got, { reason: 'minta PO', summary: 'x' });
  // API gagal -> null (pemanggil memakai fallback)
  global.fetch = async () => ({ ok: false, status: 500, text: async () => 'err' });
  assert.strictEqual(await agent2.answerWithAgent({ teks: 'a', nomor: '62833', priceVisible: false }), null);
  console.log('SEMUA TES LOLOS');
})().catch((e) => { console.error('GAGAL:', e.message); process.exit(1); });
