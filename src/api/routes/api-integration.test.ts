/**
 * API Integration Tests
 *
 * Tests the API routes with an in-memory event store.
 * Verifies request/response handling, validation, and event emission.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { createApp } from '../../config/app.js';
import type { EventStore, HashChainVerificationResult } from '../../infrastructure/event-store/types.js';
import type { DomainEvent, EventType } from '../../shared/events/index.js';
import type {
  EventId,
  TenantId,
  CaseId,
  CorrelationId,
} from '../../shared/types/index.js';
import type { ConflictCheckRepository } from '../../domain/conflict-check/conflict-checker.js';
import type { FastifyInstance } from 'fastify';

// ─── In-Memory Event Store ─────────────────────────────────────────

class InMemoryEventStore implements EventStore {
  private events: DomainEvent[] = [];

  async append(event: DomainEvent): Promise<EventId> {
    this.events.push(event);
    return event.event_id as EventId;
  }

  async appendBatch(events: DomainEvent[]): Promise<EventId[]> {
    this.events.push(...events);
    return events.map((e) => e.event_id as EventId);
  }

  async getEventsByCase(tenantId: TenantId, caseId: CaseId): Promise<DomainEvent[]> {
    return this.events.filter(
      (e) => e.tenant_id === tenantId && e.case_id === caseId,
    );
  }

  async getEventsByCaseAndType(
    tenantId: TenantId,
    caseId: CaseId,
    eventType: EventType,
  ): Promise<DomainEvent[]> {
    return this.events.filter(
      (e) => e.tenant_id === tenantId && e.case_id === caseId && e.event_type === eventType,
    );
  }

  async getEventsByCorrelation(
    tenantId: TenantId,
    correlationId: CorrelationId,
  ): Promise<DomainEvent[]> {
    return this.events.filter(
      (e) => e.tenant_id === tenantId && e.correlation_id === correlationId,
    );
  }

  async getLatestEvent(tenantId: TenantId, caseId: CaseId): Promise<DomainEvent | null> {
    const caseEvents = await this.getEventsByCase(tenantId, caseId);
    return caseEvents[caseEvents.length - 1] ?? null;
  }

  async verifyHashChain(
    tenantId: TenantId,
    caseId: CaseId,
  ): Promise<HashChainVerificationResult> {
    const caseEvents = await this.getEventsByCase(tenantId, caseId);
    return {
      case_id: caseId,
      tenant_id: tenantId,
      total_events: caseEvents.length,
      verified_events: caseEvents.length,
      is_valid: true,
      first_break_at_event_id: null,
      verified_at: new Date().toISOString(),
    };
  }

  async *streamAllEvents(): AsyncIterable<DomainEvent[]> {
    yield this.events;
  }
}

// ─── In-Memory Conflict Repository ──────────────────────────────

class InMemoryConflictRepository implements ConflictCheckRepository {
  async findActiveCasesByTenant() {
    return [];
  }
}

// ─── Test Helpers ─────────────────────────────────────────────────

const TEST_JWT_PAYLOAD = {
  sub: 'actor_test',
  tenant_id: 'tenant_test',
  role: 'partner',
  email: 'test@patentops.com',
  name: 'Test User',
};

async function createTestApp(): Promise<FastifyInstance> {
  const eventStore = new InMemoryEventStore();
  const conflictRepository = new InMemoryConflictRepository();
  const app = await createApp({ eventStore, conflictRepository });
  return app;
}

function signToken(app: FastifyInstance, payload?: Record<string, unknown>): string {
  return (app as any).jwt.sign(payload ?? TEST_JWT_PAYLOAD);
}

// ─── Tests ─────────────────────────────────────────────────────────

describe('API Integration', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    app = await createTestApp();
  });

  describe('Health Check', () => {
    it('GET /health returns ok', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/health',
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.status).toBe('ok');
      expect(body.service).toBe('patentops-api');
    });
  });

  describe('Authentication', () => {
    it('rejects requests without JWT', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/cases/some_id',
      });

      expect(response.statusCode).toBe(401);
    });

    it('accepts requests with valid JWT', async () => {
      const token = signToken(app);
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/cases/some_id',
        headers: { authorization: `Bearer ${token}` },
      });

      // 404 is fine — it means auth passed but case doesn't exist
      expect(response.statusCode).toBe(404);
    });
  });

  describe('Case CRUD', () => {
    it('POST /api/v1/cases creates a case', async () => {
      const token = signToken(app);
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/cases',
        headers: { authorization: `Bearer ${token}` },
        payload: {
          title: 'Test Patent Application',
          patent_type: 'invention',
          applicant_id: 'applicant_1',
          inventor_ids: ['inventor_1'],
          assigned_attorney_id: 'attorney_1',
          jurisdiction: 'US',
        },
      });

      expect(response.statusCode).toBe(201);
      const body = response.json();
      expect(body.case_id).toBeDefined();
      expect(body.status).toBe('INTAKE');
      expect(body.correlation_id).toBeDefined();
    });

    it('GET /api/v1/cases/:id returns created case', async () => {
      const token = signToken(app);

      // Create
      const createRes = await app.inject({
        method: 'POST',
        url: '/api/v1/cases',
        headers: { authorization: `Bearer ${token}` },
        payload: {
          title: 'Fetch Test',
          patent_type: 'design',
          applicant_id: 'applicant_1',
          inventor_ids: ['inventor_1'],
          assigned_attorney_id: 'attorney_1',
          jurisdiction: 'TW',
        },
      });

      const { case_id } = createRes.json();

      // Fetch
      const getRes = await app.inject({
        method: 'GET',
        url: `/api/v1/cases/${case_id}`,
        headers: { authorization: `Bearer ${token}` },
      });

      expect(getRes.statusCode).toBe(200);
      const body = getRes.json();
      expect(body.case_id).toBe(case_id);
      expect(body.title).toBe('Fetch Test');
      expect(body.patent_type).toBe('design');
    });

    it('POST /api/v1/cases validates input', async () => {
      const token = signToken(app);
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/cases',
        headers: { authorization: `Bearer ${token}` },
        payload: {
          // Missing required fields
          title: '',
        },
      });

      expect(response.statusCode).toBe(400);
    });

    it('POST /api/v1/cases/:id/status changes status', async () => {
      const token = signToken(app);

      // Create case
      const createRes = await app.inject({
        method: 'POST',
        url: '/api/v1/cases',
        headers: { authorization: `Bearer ${token}` },
        payload: {
          title: 'Status Test',
          patent_type: 'invention',
          applicant_id: 'applicant_1',
          inventor_ids: ['inventor_1'],
          assigned_attorney_id: 'attorney_1',
          jurisdiction: 'US',
        },
      });

      const { case_id } = createRes.json();

      // Transition INTAKE → DRAFTING
      const statusRes = await app.inject({
        method: 'POST',
        url: `/api/v1/cases/${case_id}/status`,
        headers: { authorization: `Bearer ${token}` },
        payload: { to_state: 'DRAFTING' },
      });

      expect(statusRes.statusCode).toBe(200);
      expect(statusRes.json().status).toBe('DRAFTING');
    });

    it('POST /api/v1/cases/:id/close closes a case', async () => {
      const token = signToken(app);

      // Create
      const createRes = await app.inject({
        method: 'POST',
        url: '/api/v1/cases',
        headers: { authorization: `Bearer ${token}` },
        payload: {
          title: 'Close Test',
          patent_type: 'invention',
          applicant_id: 'applicant_1',
          inventor_ids: ['inventor_1'],
          assigned_attorney_id: 'attorney_1',
          jurisdiction: 'US',
        },
      });

      const { case_id } = createRes.json();

      // Close
      const closeRes = await app.inject({
        method: 'POST',
        url: `/api/v1/cases/${case_id}/close`,
        headers: { authorization: `Bearer ${token}` },
        payload: { close_reason: 'withdrawn' },
      });

      expect(closeRes.statusCode).toBe(200);
      expect(closeRes.json().status).toBe('CLOSED');
    });
  });

  describe('Claim CRUD', () => {
    async function createCaseAndGetId(token: string): Promise<string> {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/cases',
        headers: { authorization: `Bearer ${token}` },
        payload: {
          title: 'Claim Test Case',
          patent_type: 'invention',
          applicant_id: 'applicant_1',
          inventor_ids: ['inventor_1'],
          assigned_attorney_id: 'attorney_1',
          jurisdiction: 'US',
        },
      });
      return res.json().case_id;
    }

    it('POST /api/v1/cases/:id/claims creates a claim', async () => {
      const token = signToken(app);
      const caseId = await createCaseAndGetId(token);

      const response = await app.inject({
        method: 'POST',
        url: `/api/v1/cases/${caseId}/claims`,
        headers: { authorization: `Bearer ${token}` },
        payload: {
          claim_number: 1,
          claim_type: 'independent',
          claim_category: 'method',
          claim_text: 'A method comprising step A.',
        },
      });

      expect(response.statusCode).toBe(201);
      const body = response.json();
      expect(body.claim_id).toBeDefined();
      expect(body.claim_number).toBe(1);
    });

    it('GET /api/v1/cases/:id/claims lists claims', async () => {
      const token = signToken(app);
      const caseId = await createCaseAndGetId(token);

      // Create a claim
      await app.inject({
        method: 'POST',
        url: `/api/v1/cases/${caseId}/claims`,
        headers: { authorization: `Bearer ${token}` },
        payload: {
          claim_number: 1,
          claim_type: 'independent',
          claim_text: 'A method comprising step A.',
        },
      });

      const response = await app.inject({
        method: 'GET',
        url: `/api/v1/cases/${caseId}/claims`,
        headers: { authorization: `Bearer ${token}` },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.total).toBe(1);
      expect(body.claims[0].claim_number).toBe(1);
    });

    it('POST /api/v1/cases/:id/claims/:claim_id/amend amends a claim', async () => {
      const token = signToken(app);
      const caseId = await createCaseAndGetId(token);

      const createRes = await app.inject({
        method: 'POST',
        url: `/api/v1/cases/${caseId}/claims`,
        headers: { authorization: `Bearer ${token}` },
        payload: {
          claim_number: 1,
          claim_type: 'independent',
          claim_text: 'Original text.',
        },
      });
      const { claim_id } = createRes.json();

      const amendRes = await app.inject({
        method: 'POST',
        url: `/api/v1/cases/${caseId}/claims/${claim_id}/amend`,
        headers: { authorization: `Bearer ${token}` },
        payload: {
          new_text: 'Amended text with narrowing limitation.',
          amendment_reason: 'Narrowing to overcome prior art',
        },
      });

      expect(amendRes.statusCode).toBe(200);
      expect(amendRes.json().version).toBe(2);
    });
  });

  describe('Event History', () => {
    it('GET /api/v1/cases/:id/events returns event log', async () => {
      const token = signToken(app);

      const createRes = await app.inject({
        method: 'POST',
        url: '/api/v1/cases',
        headers: { authorization: `Bearer ${token}` },
        payload: {
          title: 'Event Test',
          patent_type: 'invention',
          applicant_id: 'applicant_1',
          inventor_ids: ['inventor_1'],
          assigned_attorney_id: 'attorney_1',
          jurisdiction: 'US',
        },
      });
      const { case_id } = createRes.json();

      // Transition
      await app.inject({
        method: 'POST',
        url: `/api/v1/cases/${case_id}/status`,
        headers: { authorization: `Bearer ${token}` },
        payload: { to_state: 'DRAFTING' },
      });

      const eventsRes = await app.inject({
        method: 'GET',
        url: `/api/v1/cases/${case_id}/events`,
        headers: { authorization: `Bearer ${token}` },
      });

      expect(eventsRes.statusCode).toBe(200);
      const body = eventsRes.json();
      expect(body.total).toBe(2);
      expect(body.events[0].event_type).toBe('CASE_CREATED');
      expect(body.events[1].event_type).toBe('CASE_STATUS_CHANGED');
    });
  });

  describe('Hash Chain Verification', () => {
    it('GET /api/v1/cases/:id/verify returns verification result', async () => {
      const token = signToken(app);

      const createRes = await app.inject({
        method: 'POST',
        url: '/api/v1/cases',
        headers: { authorization: `Bearer ${token}` },
        payload: {
          title: 'Hash Test',
          patent_type: 'invention',
          applicant_id: 'applicant_1',
          inventor_ids: ['inventor_1'],
          assigned_attorney_id: 'attorney_1',
          jurisdiction: 'US',
        },
      });
      const { case_id } = createRes.json();

      const verifyRes = await app.inject({
        method: 'GET',
        url: `/api/v1/cases/${case_id}/verify`,
        headers: { authorization: `Bearer ${token}` },
      });

      expect(verifyRes.statusCode).toBe(200);
      expect(verifyRes.json().is_valid).toBe(true);
    });
  });
});
