/**
 * Application Factory
 *
 * Creates and configures the Fastify application instance.
 * Separated from index.ts to enable testing without starting the server.
 */

import Fastify, { type FastifyInstance } from 'fastify';
import fastifyJwt from '@fastify/jwt';
import fastifyCors from '@fastify/cors';
import { ulid } from 'ulid';
import { authPlugin } from '../api/middleware/auth.js';
import { caseRoutes } from '../api/routes/case-routes.js';
import type { EventStore } from '../infrastructure/event-store/types.js';

export interface AppDependencies {
  eventStore: EventStore;
}

export async function createApp(deps?: AppDependencies): Promise<FastifyInstance> {
  const app = Fastify({
    logger: {
      level: process.env['LOG_LEVEL'] ?? 'info',
      transport:
        process.env['NODE_ENV'] === 'development'
          ? { target: 'pino-pretty' }
          : undefined,
    },
    genReqId: () => ulid(),
  });

  // ─── Plugins ──────────────────────────────────────────────────
  await app.register(fastifyCors, {
    origin: process.env['CORS_ORIGIN'] ?? '*',
  });

  await app.register(fastifyJwt, {
    secret: process.env['JWT_SECRET'] ?? 'dev-secret-change-in-production',
  });

  // ─── Auth Middleware ──────────────────────────────────────────
  await app.register(authPlugin);

  // ─── Health Check (unauthenticated) ───────────────────────────
  app.get('/health', async () => {
    return {
      status: 'ok',
      service: 'patentops-api',
      timestamp: new Date().toISOString(),
    };
  });

  // ─── API Routes ───────────────────────────────────────────────
  if (deps?.eventStore) {
    await app.register(caseRoutes, {
      prefix: '/api/v1',
      eventStore: deps.eventStore,
    });
  }

  // ─── Error Handler ────────────────────────────────────────────
  app.setErrorHandler((error, request, reply) => {
    request.log.error(error);

    if (error.validation) {
      return reply.status(400).send({
        error: 'Validation error',
        details: error.validation,
      });
    }

    return reply.status(error.statusCode ?? 500).send({
      error: error.message ?? 'Internal server error',
    });
  });

  return app;
}
