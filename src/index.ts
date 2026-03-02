/**
 * PatentOps Platform — Application Entry Point
 *
 * Bootstraps the Fastify server with all routes, middleware, and plugins.
 * Designed to run under PM2 in cluster mode.
 */

import { createApp } from './config/app.js';

async function main(): Promise<void> {
  const app = await createApp();
  const port = parseInt(process.env['PORT'] ?? '7426', 10);
  const host = '0.0.0.0';

  try {
    await app.listen({ port, host });
    app.log.info(`PatentOps API server listening on ${host}:${port}`);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

main();
