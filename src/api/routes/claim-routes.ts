/**
 * Claim API Routes
 *
 * CRUD operations for patent claims within a case.
 * All endpoints are tenant-scoped (tenant_id extracted from JWT).
 */

import type { FastifyInstance } from 'fastify';
import { ulid } from 'ulid';
import {
  createClaimSchema,
  amendClaimSchema,
  changeClaimStatusSchema,
} from '../schemas/claim-schemas.js';
import type {
  CreateClaimInput,
  AmendClaimInput,
  ChangeClaimStatusInput,
} from '../schemas/claim-schemas.js';
import { ClaimAggregate } from '../../domain/claim/claim-aggregate.js';
import type { EventStore } from '../../infrastructure/event-store/types.js';
import type {
  CaseId,
  ClaimId,
  CorrelationId,
  CausationId,
  ClaimStatus,
} from '../../shared/types/index.js';

export async function claimRoutes(
  fastify: FastifyInstance,
  opts: { eventStore: EventStore },
): Promise<void> {
  const { eventStore } = opts;

  // ─── Create Claim ────────────────────────────────────────────────
  fastify.post<{
    Params: { case_id: string };
    Body: CreateClaimInput;
  }>('/cases/:case_id/claims', async (request, reply) => {
    const parsed = createClaimSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Validation error', details: parsed.error.issues });
    }

    const caseId = request.params.case_id as CaseId;
    const input = parsed.data;
    const correlationId = ulid() as CorrelationId;
    const causationId = ulid() as CausationId;

    // Load existing claim events for this case
    const existingEvents = await eventStore.getEventsByCase(request.tenant_id, caseId);
    const claimEvents = existingEvents.filter(
      (e) =>
        e.event_type === 'CLAIM_CREATED' ||
        e.event_type === 'CLAIM_AMENDED' ||
        e.event_type === 'CLAIM_STATUS_CHANGED',
    );

    const aggregate = new ClaimAggregate();
    aggregate.loadFromHistory(claimEvents);

    try {
      const claimId = aggregate.createClaim({
        tenant_id: request.tenant_id,
        case_id: caseId,
        claim_number: input.claim_number,
        claim_type: input.claim_type,
        claim_category: input.claim_category ?? null,
        depends_on_claim_id: (input.depends_on_claim_id ?? null) as ClaimId | null,
        claim_text: input.claim_text,
        ai_generated: input.ai_generated,
        actor_id: request.actor_id,
        actor_role: request.actor_role,
        correlation_id: correlationId,
        causation_id: causationId,
      });

      await eventStore.appendBatch(aggregate.pendingEvents);

      return reply.status(201).send({
        claim_id: claimId,
        claim_number: input.claim_number,
        correlation_id: correlationId,
      });
    } catch (err: any) {
      return reply.status(422).send({ error: err.message });
    }
  });

  // ─── Get Claims for Case ────────────────────────────────────────
  fastify.get<{
    Params: { case_id: string };
  }>('/cases/:case_id/claims', async (request, reply) => {
    const caseId = request.params.case_id as CaseId;
    const existingEvents = await eventStore.getEventsByCase(request.tenant_id, caseId);
    const claimEvents = existingEvents.filter(
      (e) =>
        e.event_type === 'CLAIM_CREATED' ||
        e.event_type === 'CLAIM_AMENDED' ||
        e.event_type === 'CLAIM_STATUS_CHANGED',
    );

    const aggregate = new ClaimAggregate();
    aggregate.loadFromHistory(claimEvents);

    return reply.send({ claims: aggregate.allClaims, total: aggregate.allClaims.length });
  });

  // ─── Get Single Claim ───────────────────────────────────────────
  fastify.get<{
    Params: { case_id: string; claim_id: string };
  }>('/cases/:case_id/claims/:claim_id', async (request, reply) => {
    const caseId = request.params.case_id as CaseId;
    const claimId = request.params.claim_id as ClaimId;

    const existingEvents = await eventStore.getEventsByCase(request.tenant_id, caseId);
    const claimEvents = existingEvents.filter(
      (e) =>
        e.event_type === 'CLAIM_CREATED' ||
        e.event_type === 'CLAIM_AMENDED' ||
        e.event_type === 'CLAIM_STATUS_CHANGED',
    );

    const aggregate = new ClaimAggregate();
    aggregate.loadFromHistory(claimEvents);

    const claim = aggregate.getClaim(claimId);
    if (!claim) {
      return reply.status(404).send({ error: 'Claim not found' });
    }

    return reply.send(claim);
  });

  // ─── Amend Claim ────────────────────────────────────────────────
  fastify.post<{
    Params: { case_id: string; claim_id: string };
    Body: AmendClaimInput;
  }>('/cases/:case_id/claims/:claim_id/amend', async (request, reply) => {
    const parsed = amendClaimSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Validation error', details: parsed.error.issues });
    }

    const caseId = request.params.case_id as CaseId;
    const claimId = request.params.claim_id as ClaimId;
    const input = parsed.data;
    const correlationId = ulid() as CorrelationId;
    const causationId = ulid() as CausationId;

    const existingEvents = await eventStore.getEventsByCase(request.tenant_id, caseId);
    const claimEvents = existingEvents.filter(
      (e) =>
        e.event_type === 'CLAIM_CREATED' ||
        e.event_type === 'CLAIM_AMENDED' ||
        e.event_type === 'CLAIM_STATUS_CHANGED',
    );

    const aggregate = new ClaimAggregate();
    aggregate.loadFromHistory(claimEvents);

    try {
      aggregate.amendClaim({
        tenant_id: request.tenant_id,
        case_id: caseId,
        claim_id: claimId,
        new_text: input.new_text,
        amendment_reason: input.amendment_reason,
        actor_id: request.actor_id,
        actor_role: request.actor_role,
        correlation_id: correlationId,
        causation_id: causationId,
      });

      await eventStore.appendBatch(aggregate.pendingEvents);

      return reply.send({
        claim_id: claimId,
        version: aggregate.getClaim(claimId)!.version,
        correlation_id: correlationId,
      });
    } catch (err: any) {
      return reply.status(422).send({ error: err.message });
    }
  });

  // ─── Change Claim Status ─────────────────────────────────────────
  fastify.post<{
    Params: { case_id: string; claim_id: string };
    Body: ChangeClaimStatusInput;
  }>('/cases/:case_id/claims/:claim_id/status', async (request, reply) => {
    const parsed = changeClaimStatusSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Validation error', details: parsed.error.issues });
    }

    const caseId = request.params.case_id as CaseId;
    const claimId = request.params.claim_id as ClaimId;
    const input = parsed.data;
    const correlationId = ulid() as CorrelationId;
    const causationId = ulid() as CausationId;

    const existingEvents = await eventStore.getEventsByCase(request.tenant_id, caseId);
    const claimEvents = existingEvents.filter(
      (e) =>
        e.event_type === 'CLAIM_CREATED' ||
        e.event_type === 'CLAIM_AMENDED' ||
        e.event_type === 'CLAIM_STATUS_CHANGED',
    );

    const aggregate = new ClaimAggregate();
    aggregate.loadFromHistory(claimEvents);

    try {
      aggregate.changeClaimStatus({
        tenant_id: request.tenant_id,
        case_id: caseId,
        claim_id: claimId,
        to_status: input.to_status as ClaimStatus,
        actor_id: request.actor_id,
        actor_role: request.actor_role,
        correlation_id: correlationId,
        causation_id: causationId,
      });

      await eventStore.appendBatch(aggregate.pendingEvents);

      return reply.send({
        claim_id: claimId,
        status: input.to_status,
        correlation_id: correlationId,
      });
    } catch (err: any) {
      return reply.status(422).send({ error: err.message });
    }
  });
}
