import { createServer } from 'node:http';
import { httpServerHandler } from 'cloudflare:node';
import app from '../app.js';
import { handleResendInbound } from './resend-inbound.js';
import { runScheduledBroadcasts } from '../jobs/broadcastScheduler.js';

const server = createServer(app);
const handleNodeRequest = httpServerHandler(server);

export default {
  async scheduled(controller, env, context) {
    const witaHour = new Date(controller.scheduledTime + (8 * 60 * 60 * 1000)).getUTCHours();
    if (witaHour < 8 || witaHour > 23) return;
    await runScheduledBroadcasts({ maxContacts: 10 });
  },
  async fetch(request, env, context) {
    const pathname = new URL(request.url).pathname;
    if (pathname === '/api/webhooks/resend/inbound' && request.method === 'POST') {
      return handleResendInbound(request, env);
    }
    if ((pathname === '/catalog' || pathname === '/catalog.html') && request.method === 'GET') {
      return renderCatalogPage(request, env, context);
    }
    if (!pathname.startsWith('/api/')) {
      return env.ASSETS.fetch(request);
    }
    return handleNodeRequest.fetch(withGeoHeaders(request), env, context);
  },
};

// Katalog dirender dulu di server (nama, kandungan, kemasan — tanpa harga)
// supaya isinya terbaca mesin pencari. Script di halaman tetap mengganti
// isi #productGroups dengan versi interaktif seperti biasa. Kalau API gagal,
// halaman statis asli dikirim apa adanya.
async function renderCatalogPage(request, env, context) {
  const page = await env.ASSETS.fetch(request);
  if (!page.ok || !(page.headers.get('content-type') || '').includes('text/html')) return page;
  let groups;
  try {
    const apiUrl = new URL('/api/products', request.url);
    const apiRes = await handleNodeRequest.fetch(new Request(apiUrl, { headers: { Accept: 'application/json' } }), env, context);
    groups = apiRes.ok ? await apiRes.json() : null;
  } catch {
    groups = null;
  }
  if (!Array.isArray(groups) || !groups.length) return page;
  const esc = (v) => String(v ?? '').replace(/[&<>"]/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[m]));
  const html = groups
    .filter((g) => g && typeof g.cat === 'string' && Array.isArray(g.items))
    .map((g) => '<section class="rounded-2xl border border-slate-200 bg-white p-5 card sm:p-6 lg:p-7"><h3 class="mb-4 font-black">' + esc(g.cat) + '</h3><ul class="grid grid-cols-1 gap-2 text-sm sm:grid-cols-2 lg:grid-cols-3">'
      + g.items.map((i) => '<li class="rounded-xl bg-ail-clinical px-4 py-3"><strong class="block text-ail-teal">' + esc(i[0]) + '</strong>'
        + (i[1] ? '<span class="block text-xs text-slate-500">' + esc(i[1]) + '</span>' : '')
        + (i[2] ? '<span class="block text-xs text-slate-400">' + esc(i[2]) + '</span>' : '') + '</li>').join('')
      + '</ul></section>')
    .join('');
  const out = new HTMLRewriter()
    .on('#productGroups', { element(el) { el.setInnerContent(html, { html: true }); } })
    .transform(page);
  const headers = new Headers(out.headers);
  headers.set('Cache-Control', 'public, max-age=0, s-maxage=300');
  return new Response(out.body, { status: out.status, headers });
}

// Lokasi pengunjung level negara/provinsi/kota dari Cloudflare (request.cf),
// diteruskan ke Express lewat header internal. Header dari klien dengan nama
// yang sama selalu dibuang dulu supaya tidak bisa dipalsukan. Tidak ada
// koordinat atau GPS yang dipakai; hanya nama wilayah.
//
// Di depan Worker, Cloudflare tidak mengisi X-Forwarded-For, jadi Express hanya
// melihat header yang dikirim klien (bisa dipalsukan) atau tidak ada sama
// sekali. Akibatnya semua pengunjung berbagi satu "IP" dan rate limit OTP
// mengunci semua orang. Isi ulang dari CF-Connecting-IP, IP asli pengunjung.
function withGeoHeaders(request) {
  const headers = new Headers(request.headers);
  for (const name of ['x-ail-geo-country', 'x-ail-geo-region', 'x-ail-geo-city', 'x-forwarded-for']) headers.delete(name);
  const clientIp = request.headers.get('cf-connecting-ip');
  if (clientIp) headers.set('x-forwarded-for', clientIp);
  const cf = request.cf || {};
  const set = (name, value) => {
    if (value) headers.set(name, encodeURIComponent(String(value).slice(0, 120)));
  };
  set('x-ail-geo-country', cf.country);
  set('x-ail-geo-region', cf.region);
  set('x-ail-geo-city', cf.city);
  return new Request(request, { headers });
}