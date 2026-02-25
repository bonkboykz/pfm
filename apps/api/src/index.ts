import { serve } from '@hono/node-server';
import { db } from './db.js';
import { createApp } from './app.js';

const app = createApp(db);
const port = parseInt(process.env.PORT ?? '3000');

serve({ fetch: app.fetch, port }, (info) => {
  console.log(`PFM API v0.4.0 → http://localhost:${info.port}`);
});
