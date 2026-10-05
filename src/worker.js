import { createServer } from 'node:http';
import { httpServerHandler } from 'cloudflare:node';
import app from '../app.js';
import { runScheduledBroadcasts } from '../jobs/broadcastScheduler.js';

const server = createServer(app);
const handleNodeRequest = httpServerHandler(server);

export default {
  async scheduled(controller, env, context) {
    const witaHour = new Date(controller.scheduledTime + (8 * 60 * 60 * 1000)).getUTCHours();
    if (witaHour < 8 || witaHour > 23) return;
    await runScheduledBroadcasts({ maxContacts: 10 });
  },
  fetch(request, env, context) {
    if (!new URL(request.url).pathname.startsWith('/api/')) {
      return env.ASSETS.fetch(request);
    }
    return handleNodeRequest.fetch(request, env, context);
  },
};