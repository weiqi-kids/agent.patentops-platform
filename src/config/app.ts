/**
 * Application Factory
 *
 * Creates and configures the Fastify application instance.
 * Separated from index.ts to enable testing without starting the server.
 */

import Fastify, { type FastifyInstance } from 'fastify';

export async function createApp(): Promise<FastifyInstance> {
  const app = Fastify({
    logger: {
      level: process.env['LOG_LEVEL'] ?? 'info',
      transport:
        process.env['NODE_ENV'] === 'development'
          ? { target: 'pino-pretty' }
          : undefined,
    },
    genReqId: () => {
      // Use ULID for request IDs (to be replaced with actual ULID generation)
      return `req_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
    },
  });

  // Health check route
  app.get('/health', async () => {
    return {
      status: 'ok',
      service: 'patentops-api',
      timestamp: new Date().toISOString(),
    };
  });

  // TODO: Register plugins (CORS, JWT, Swagger)
  // TODO: Register tenant middleware
  // TODO: Register API routes
  // TODO: Register error handlers

  return app;
}
