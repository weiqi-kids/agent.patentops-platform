/**
 * Authentication & Tenant Middleware
 *
 * Extracts JWT claims, sets tenant context, and enforces RBAC.
 * Every request must include a valid JWT with tenant_id and actor_role.
 *
 * PostgreSQL Row-Level Security (RLS) is activated by setting
 * app.tenant_id via SET LOCAL for each request's transaction.
 */

import type { FastifyRequest, FastifyReply, FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import type { TenantId, ActorId, ActorRole } from '../../shared/types/index.js';

// ─── JWT Payload Shape ─────────────────────────────────────────────

export interface JwtPayload {
  sub: string;          // actor_id
  tenant_id: string;
  role: ActorRole;
  email: string;
  name: string;
  iat: number;
  exp: number;
}

// ─── Request Decoration ────────────────────────────────────────────

declare module 'fastify' {
  interface FastifyRequest {
    tenant_id: TenantId;
    actor_id: ActorId;
    actor_role: ActorRole;
  }
}

// ─── Auth Plugin ───────────────────────────────────────────────────

async function authPluginImpl(fastify: FastifyInstance): Promise<void> {
  fastify.decorateRequest('tenant_id', '');
  fastify.decorateRequest('actor_id', '');
  fastify.decorateRequest('actor_role', '');

  fastify.addHook('onRequest', async (request: FastifyRequest, reply: FastifyReply) => {
    // Skip auth for health check
    if (request.url === '/health') return;

    try {
      const decoded = await request.jwtVerify<JwtPayload>();

      if (!decoded.tenant_id) {
        return reply.status(401).send({ error: 'Missing tenant_id in token' });
      }

      if (!decoded.sub) {
        return reply.status(401).send({ error: 'Missing actor_id in token' });
      }

      request.tenant_id = decoded.tenant_id as TenantId;
      request.actor_id = decoded.sub as ActorId;
      request.actor_role = decoded.role;
    } catch {
      return reply.status(401).send({ error: 'Invalid or expired token' });
    }
  });
}

export const authPlugin = fp(authPluginImpl, { name: 'auth-plugin' });

// ─── Role Guard ────────────────────────────────────────────────────

export function requireRole(...roles: ActorRole[]) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    if (!roles.includes(request.actor_role)) {
      return reply.status(403).send({
        error: `Role '${request.actor_role}' is not permitted. Required: ${roles.join(', ')}`,
      });
    }
  };
}
