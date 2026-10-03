import { createServer } from 'node:http';
import { httpServerHandler } from 'cloudflare:node';
import app from '../app.js';

const server = createServer(app);
const handleNodeRequest = httpServerHandler(server);

export default {
  fetch(request, env, context) {
    if (!new URL(request.url).pathname.startsWith('/api/')) {
      return env.ASSETS.fetch(request);
    }
    return handleNodeRequest.fetch(request, env, context);
  },
};