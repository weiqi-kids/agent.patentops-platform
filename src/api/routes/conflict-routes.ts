/**
 * Conflict Check API Routes
 *
 * Trigger and manage conflict of interest checks.
 * All endpoints are tenant-scoped (tenant_id extracted from JWT).
 */

import type { FastifyInstance } from 'fastify';
import { ulid } from 'ulid';
import {
  initiateConflictCheckSchema,
  overrideConflictSchema,
} from '../schemas/conflict-schemas.js';
import type {
  InitiateConflictCheckInput,
  OverrideConflictInput,
} from '../schemas/conflict-schemas.js';
import type { EventStore } from '../../infrastructure/event-store/types.js';
import { ConflictChecker } from '../../domain/conflict-check/conflict-checker.js';
import type { ConflictCheckRepository } from '../../domain/conflict-check/conflict-checker.js';
import type {
  CaseId,
  EventId,
  ConflictCheckId,
  CorrelationId,
  CausationId,
  ActorId,
} from '../../shared/types/index.js';
import type { DomainEvent } from '../../shared/events/index.js';

export async function conflictRoutes(
  fastify: FastifyInstance,
  opts: { eventStore: EventStore; conflictRepository: ConflictCheckRepository },
): Promise<void> {
  const { eventStore, conflictRepository } = opts;
  const checker = new ConflictChecker(conflictRepository);

  // ─── Initiate Conflict Check ─────────────────────────────────────
  fastify.post<{
    Params: { case_id: string };
    Body: InitiateConflictCheckInput;
  }>('/cases/:case_id/conflict-check', async (request, reply) => {
    const parsed = initiateConflictCheckSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Validation error', details: parsed.error.issues });
    }

    const caseId = request.params.case_id as CaseId;
    const input = parsed.data;
    const correlationId = ulid() as CorrelationId;
    const causationId = ulid() as CausationId;
    const checkId = ulid() as ConflictCheckId;

    // Emit initiation event
    const initiatedEvent: DomainEvent = {
      event_id: ulid() as EventId,
      tenant_id: request.tenant_id,
      case_id: caseId,
      event_type: 'CONFLICT_CHECK_INITIATED',
      actor_id: request.actor_id,
      actor_role: request.actor_role,
      correlation_id: correlationId,
      causation_id: causationId,
      timestamp: new Date().toISOString(),
      previous_hash: '',
      new_hash: '',
      payload: {
        check_id: checkId,
        parties_to_check: input.parties_to_check,
      },
      metadata: {},
    } as DomainEvent;

    await eventStore.appendBatch([initiatedEvent]);

    // Perform the check
    const result = await checker.checkConflicts({
      check_id: checkId,
      tenant_id: request.tenant_id,
      case_id: caseId,
      parties_to_check: input.parties_to_check,
      initiated_by: request.actor_id,
    });

    // Emit completion event
    const completedEvent: DomainEvent = {
      event_id: ulid() as EventId,
      tenant_id: request.tenant_id,
      case_id: caseId,
      event_type: 'CONFLICT_CHECK_COMPLETED',
      actor_id: request.actor_id,
      actor_role: request.actor_role,
      correlation_id: correlationId,
      causation_id: causationId,
      timestamp: new Date().toISOString(),
      previous_hash: '',
      new_hash: '',
      payload: {
        check_id: checkId,
        checked_parties: input.parties_to_check,
        result: result.result,
        matched_cases: result.matched_cases,
        details: result.details,
      },
      metadata: {},
    } as DomainEvent;

    await eventStore.appendBatch([completedEvent]);

    return reply.status(201).send({
      check_id: checkId,
      result: result.result,
      matches: result.matches,
      details: result.details,
      correlation_id: correlationId,
    });
  });

  // ─── Override Conflict (Partner only) ────────────────────────────
  fastify.post<{
    Params: { case_id: string };
    Body: OverrideConflictInput;
  }>('/cases/:case_id/conflict-check/override', async (request, reply) => {
    if (request.actor_role !== 'partner') {
      return reply.status(403).send({
        error: 'Only partners can override conflict checks',
      });
    }

    const parsed = overrideConflictSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Validation error', details: parsed.error.issues });
    }

    const caseId = request.params.case_id as CaseId;
    const input = parsed.data;
    const correlationId = ulid() as CorrelationId;
    const causationId = ulid() as CausationId;

    const event: DomainEvent = {
      event_id: ulid() as EventId,
      tenant_id: request.tenant_id,
      case_id: caseId,
      event_type: 'CONFLICT_OVERRIDE_APPROVED',
      actor_id: request.actor_id,
      actor_role: request.actor_role,
      correlation_id: correlationId,
      causation_id: causationId,
      timestamp: new Date().toISOString(),
      previous_hash: '',
      new_hash: '',
      payload: {
        check_id: input.check_id as ConflictCheckId,
        approved_by: request.actor_id as ActorId,
        justification: input.justification,
      },
      metadata: {},
    } as DomainEvent;

    await eventStore.appendBatch([event]);

    return reply.send({
      check_id: input.check_id,
      status: 'overridden',
      correlation_id: correlationId,
    });
  });
}
