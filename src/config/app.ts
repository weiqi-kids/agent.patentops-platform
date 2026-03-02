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
import { claimRoutes } from '../api/routes/claim-routes.js';
import { oaRoutes } from '../api/routes/oa-routes.js';
import { deadlineRoutes } from '../api/routes/deadline-routes.js';
import { conflictRoutes } from '../api/routes/conflict-routes.js';
import { feeRoutes } from '../api/routes/fee-routes.js';
import { priorArtRoutes } from '../api/routes/prior-art-routes.js';
import { familyRoutes } from '../api/routes/family-routes.js';
import type { EventStore } from '../infrastructure/event-store/types.js';
import type { ConflictCheckRepository } from '../domain/conflict-check/conflict-checker.js';

export interface AppDependencies {
  eventStore: EventStore;
  conflictRepository?: ConflictCheckRepository;
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

    await app.register(claimRoutes, {
      prefix: '/api/v1',
      eventStore: deps.eventStore,
    });

    await app.register(oaRoutes, {
      prefix: '/api/v1',
      eventStore: deps.eventStore,
    });

    await app.register(deadlineRoutes, {
      prefix: '/api/v1',
      eventStore: deps.eventStore,
    });

    await app.register(feeRoutes, {
      prefix: '/api/v1',
      eventStore: deps.eventStore,
    });

    await app.register(priorArtRoutes, {
      prefix: '/api/v1',
      eventStore: deps.eventStore,
    });

    await app.register(familyRoutes, {
      prefix: '/api/v1',
      eventStore: deps.eventStore,
    });

    if (deps.conflictRepository) {
      await app.register(conflictRoutes, {
        prefix: '/api/v1',
        eventStore: deps.eventStore,
        conflictRepository: deps.conflictRepository,
      });
    }
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
