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
    if (!pathname.startsWith('/api/')) {
      return env.ASSETS.fetch(request);
    }
    return handleNodeRequest.fetch(withGeoHeaders(request), env, context);
  },
};

// Lokasi pengunjung level negara/provinsi/kota dari Cloudflare (request.cf),
// diteruskan ke Express lewat header internal. Header dari klien dengan nama
// yang sama selalu dibuang dulu supaya tidak bisa dipalsukan. Tidak ada
// koordinat atau GPS yang dipakai; hanya nama wilayah.
function withGeoHeaders(request) {
  const headers = new Headers(request.headers);
  for (const name of ['x-ail-geo-country', 'x-ail-geo-region', 'x-ail-geo-city']) headers.delete(name);
  const cf = request.cf || {};
  const set = (name, value) => {
    if (value) headers.set(name, encodeURIComponent(String(value).slice(0, 120)));
  };
  set('x-ail-geo-country', cf.country);
  set('x-ail-geo-region', cf.region);
  set('x-ail-geo-city', cf.city);
  return new Request(request, { headers });
}