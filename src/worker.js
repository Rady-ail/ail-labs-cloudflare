import { createServer } from 'node:http';
import { httpServerHandler } from 'cloudflare:node';
import app from '../app.js';
import { handleResendInbound } from './resend-inbound.js';

const server = createServer(app);
const handleNodeRequest = httpServerHandler(server);

export default {
  async fetch(request, env, context) {
    const pathname = new URL(request.url).pathname;
    if (pathname === '/api/webhooks/resend/inbound' && request.method === 'POST') {
      return handleResendInbound(request, env);
    }
    if (!pathname.startsWith('/api/')) {
      return env.ASSETS.fetch(request);
    }
    return handleNodeRequest.fetch(request, env, context);
  },
};