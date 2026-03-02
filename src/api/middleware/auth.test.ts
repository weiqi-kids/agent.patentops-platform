/**
 * Auth Middleware — Unit Tests
 *
 * Tests JWT extraction, tenant context injection, and role guard.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import fastifyJwt from '@fastify/jwt';
import { authPlugin, requireRole } from './auth.js';
import type { ActorRole } from '../../shared/types/index.js';

const JWT_SECRET = 'test-secret-for-auth-tests';

function buildToken(
  app: FastifyInstance,
  payload: { sub: string; tenant_id: string; role: ActorRole; email: string; name: string },
): string {
  return app.jwt.sign(payload);
}

describe('Auth Middleware', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = Fastify();
    await app.register(fastifyJwt, { secret: JWT_SECRET });
    await app.register(authPlugin);

    // Test route
    app.get('/test', async (request) => {
      return {
        tenant_id: request.tenant_id,
        actor_id: request.actor_id,
        actor_role: request.actor_role,
      };
    });

    // Route with role guard
    app.get('/admin-only', {
      preHandler: requireRole('admin', 'partner'),
    }, async (request) => {
      return { ok: true };
    });

    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('extracts tenant_id, actor_id, and actor_role from JWT', async () => {
    const token = buildToken(app, {
      sub: 'user_01',
      tenant_id: 'tenant_01',
      role: 'associate',
      email: 'test@example.com',
      name: 'Test User',
    });

    const res = await app.inject({
      method: 'GET',
      url: '/test',
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.tenant_id).toBe('tenant_01');
    expect(body.actor_id).toBe('user_01');
    expect(body.actor_role).toBe('associate');
  });

  it('returns 401 when no token is provided', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/test',
    });

    expect(res.statusCode).toBe(401);
  });

  it('returns 401 for invalid token', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/test',
      headers: { authorization: 'Bearer invalid-token' },
    });

    expect(res.statusCode).toBe(401);
  });

  it('returns 401 when tenant_id is missing from token', async () => {
    const token = app.jwt.sign({
      sub: 'user_01',
      tenant_id: '',
      role: 'associate',
      email: 'test@example.com',
      name: 'Test User',
    });

    const res = await app.inject({
      method: 'GET',
      url: '/test',
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(401);
  });

  it('returns 401 when sub (actor_id) is missing from token', async () => {
    const token = app.jwt.sign({
      sub: '',
      tenant_id: 'tenant_01',
      role: 'associate',
      email: 'test@example.com',
      name: 'Test User',
    });

    const res = await app.inject({
      method: 'GET',
      url: '/test',
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(401);
  });

  it('skips auth for /health endpoint', async () => {
    // Register a health endpoint to test
    const healthApp = Fastify();
    await healthApp.register(fastifyJwt, { secret: JWT_SECRET });
    await healthApp.register(authPlugin);
    healthApp.get('/health', async () => ({ status: 'ok' }));
    await healthApp.ready();

    const res = await healthApp.inject({
      method: 'GET',
      url: '/health',
    });

    expect(res.statusCode).toBe(200);
    await healthApp.close();
  });

  describe('requireRole', () => {
    it('allows access for permitted roles', async () => {
      const token = buildToken(app, {
        sub: 'admin_01',
        tenant_id: 'tenant_01',
        role: 'admin',
        email: 'admin@example.com',
        name: 'Admin',
      });

      const res = await app.inject({
        method: 'GET',
        url: '/admin-only',
        headers: { authorization: `Bearer ${token}` },
      });

      expect(res.statusCode).toBe(200);
    });

    it('returns 403 for unpermitted roles', async () => {
      const token = buildToken(app, {
        sub: 'user_01',
        tenant_id: 'tenant_01',
        role: 'client',
        email: 'client@example.com',
        name: 'Client',
      });

      const res = await app.inject({
        method: 'GET',
        url: '/admin-only',
        headers: { authorization: `Bearer ${token}` },
      });

      expect(res.statusCode).toBe(403);
      const body = JSON.parse(res.body);
      expect(body.error).toContain("Role 'client' is not permitted");
    });
  });
});
