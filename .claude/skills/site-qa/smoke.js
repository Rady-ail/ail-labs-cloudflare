#!/usr/bin/env node
// Smoke test halaman publik AIL LABS. Pakai: node .claude/skills/site-qa/smoke.js [BASE_URL] [OUT_DIR]
'use strict';
const path = require('node:path');
const fs = require('node:fs');
const { chromium } = require('playwright');

const BASE = (process.argv[2] || process.env.BASE_URL || 'http://127.0.0.1:8788').replace(/\/$/, '');
const OUT = process.argv[3] || path.join(require('node:os').tmpdir(), 'ail-site-qa');
const PAGES = ['index.html', 'catalog.html', 'private-label.html', 'procurement.html', 'compliance.html', 'about.html', 'contact.html'];
const VIEWPORTS = { desktop: { width: 1280, height: 800 }, mobile: { width: 390, height: 844 } };

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();
  let failed = 0;
  for (const [vp, size] of Object.entries(VIEWPORTS)) {
    const page = await browser.newPage({ viewport: size, deviceScaleFactor: 1 });
    for (const name of PAGES) {
      const errors = [];
      const api = [];
      // HTTP failures are tracked per URL below; the console copy has no URL, so skip it.
      const onConsole = (m) => { if (m.type() === 'error' && !m.text().startsWith('Failed to load resource')) errors.push(m.text()); };
      const onError = (e) => errors.push(e.message);
      const onResponse = (r) => {
        if (r.status() < 400) return;
        const u = new URL(r.url());
        (u.pathname.startsWith('/api/') ? api : errors).push(`${r.status()} ${u.pathname}`);
      };
      page.on('console', onConsole); page.on('pageerror', onError); page.on('response', onResponse);
      let status = 0;
      try {
        const res = await page.goto(`${BASE}/${name}`, { waitUntil: 'networkidle', timeout: 20000 });
        status = res ? res.status() : 0;
      } catch (e) { errors.push(e.message); }
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth).catch(() => -1);
      const shot = path.join(OUT, `${vp}-${name.replace('.html', '')}.png`);
      await page.screenshot({ path: shot, fullPage: false }).catch(() => {});
      const bad = status !== 200 || overflow > 1 || errors.length;
      if (bad) failed++;
      console.log(`${bad ? 'FAIL' : 'PASS'} ${vp} ${name} status=${status} overflowX=${overflow}px errors=${errors.length}${errors.length ? ' :: ' + errors.slice(0, 3).join(' | ') : ''}${api.length ? ` (api tidak tersedia: ${[...new Set(api)].join(', ')} — jalankan wrangler dev untuk menguji API)` : ''}`);
      page.off('console', onConsole); page.off('pageerror', onError); page.off('response', onResponse);
    }
    await page.close();
  }
  await browser.close();
  console.log(`${failed ? 'GAGAL' : 'LOLOS'}: ${PAGES.length * 2 - failed}/${PAGES.length * 2} cek. Screenshot: ${OUT}`);
  process.exitCode = failed ? 1 : 0;
})().catch((e) => { console.error(e); process.exitCode = 1; });
