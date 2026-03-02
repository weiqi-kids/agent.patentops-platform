/**
 * Deadline API Routes
 *
 * Query and manage deadlines for cases.
 * All endpoints are tenant-scoped (tenant_id extracted from JWT).
 */

import type { FastifyInstance } from 'fastify';
import { ulid } from 'ulid';
import {
  createDeadlineSchema,
  completeDeadlineSchema,
  extendDeadlineSchema,
} from '../schemas/deadline-schemas.js';
import type {
  CreateDeadlineInput,
  ExtendDeadlineInput,
} from '../schemas/deadline-schemas.js';
import type { EventStore } from '../../infrastructure/event-store/types.js';
import type {
  CaseId,
  DeadlineId,
  FeeId,
  CorrelationId,
  CausationId,
} from '../../shared/types/index.js';
import type {
  DomainEvent,
  DeadlineCreatedPayload,
} from '../../shared/events/index.js';

export async function deadlineRoutes(
  fastify: FastifyInstance,
  opts: { eventStore: EventStore },
): Promise<void> {
  const { eventStore } = opts;

  // ─── Create Deadline ──────────────────────────────────────────
  fastify.post<{
    Params: { case_id: string };
    Body: CreateDeadlineInput;
  }>('/cases/:case_id/deadlines', async (request, reply) => {
    const parsed = createDeadlineSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Validation error', details: parsed.error.issues });
    }

    const caseId = request.params.case_id as CaseId;
    const input = parsed.data;
    const correlationId = ulid() as CorrelationId;
    const causationId = ulid() as CausationId;
    const deadlineId = ulid() as DeadlineId;

    const payload: DeadlineCreatedPayload = {
      deadline_id: deadlineId,
      deadline_type: input.deadline_type,
      source_entity_type: input.source_entity_type,
      source_entity_id: input.source_entity_id,
      due_date: input.due_date,
      rule_reference: input.rule_reference ?? null,
    };

    const event: DomainEvent = {
      event_id: ulid(),
      tenant_id: request.tenant_id,
      case_id: caseId,
      event_type: 'DEADLINE_CREATED',
      actor_id: request.actor_id,
      actor_role: request.actor_role,
      correlation_id: correlationId,
      causation_id: causationId,
      timestamp: new Date().toISOString(),
      previous_hash: '',
      new_hash: '',
      payload,
      metadata: {},
    } as DomainEvent;

    await eventStore.appendBatch([event]);

    return reply.status(201).send({
      deadline_id: deadlineId,
      due_date: input.due_date,
      correlation_id: correlationId,
    });
  });

  // ─── Get Deadlines for Case ──────────────────────────────────────
  fastify.get<{
    Params: { case_id: string };
  }>('/cases/:case_id/deadlines', async (request, reply) => {
    const caseId = request.params.case_id as CaseId;
    const events = await eventStore.getEventsByCase(request.tenant_id, caseId);

    const deadlineCreatedEvents = events.filter((e) => e.event_type === 'DEADLINE_CREATED');
    const completedIds = new Set(
      events
        .filter((e) => e.event_type === 'DEADLINE_COMPLETED')
        .map((e) => (e.payload as any).deadline_id),
    );
    const missedIds = new Set(
      events
        .filter((e) => e.event_type === 'DEADLINE_MISSED')
        .map((e) => (e.payload as any).deadline_id),
    );

    const deadlines = deadlineCreatedEvents.map((e) => {
      const p = e.payload as DeadlineCreatedPayload;

      // Check for extensions
      const extensionEvents = events.filter(
        (ev) =>
          ev.event_type === 'DEADLINE_EXTENDED' &&
          (ev.payload as any).deadline_id === p.deadline_id,
      );
      const currentDueDate = extensionEvents.length > 0
        ? (extensionEvents[extensionEvents.length - 1].payload as any).new_due_date
        : p.due_date;

      let status: string = 'active';
      if (completedIds.has(p.deadline_id)) status = 'completed';
      else if (missedIds.has(p.deadline_id)) status = 'missed';

      return {
        deadline_id: p.deadline_id,
        deadline_type: p.deadline_type,
        source_entity_type: p.source_entity_type,
        source_entity_id: p.source_entity_id,
        due_date: currentDueDate,
        original_due_date: p.due_date,
        rule_reference: p.rule_reference,
        status,
      };
    });

    return reply.send({ deadlines, total: deadlines.length });
  });

  // ─── Complete Deadline ──────────────────────────────────────────
  fastify.post<{
    Params: { case_id: string; deadline_id: string };
  }>('/cases/:case_id/deadlines/:deadline_id/complete', async (request, reply) => {
    const caseId = request.params.case_id as CaseId;
    const deadlineId = request.params.deadline_id as DeadlineId;
    const correlationId = ulid() as CorrelationId;
    const causationId = ulid() as CausationId;

    const event: DomainEvent = {
      event_id: ulid(),
      tenant_id: request.tenant_id,
      case_id: caseId,
      event_type: 'DEADLINE_COMPLETED',
      actor_id: request.actor_id,
      actor_role: request.actor_role,
      correlation_id: correlationId,
      causation_id: causationId,
      timestamp: new Date().toISOString(),
      previous_hash: '',
      new_hash: '',
      payload: {
        deadline_id: deadlineId,
        completed_by: request.actor_id,
      },
      metadata: {},
    } as DomainEvent;

    await eventStore.appendBatch([event]);

    return reply.send({
      deadline_id: deadlineId,
      status: 'completed',
      correlation_id: correlationId,
    });
  });

  // ─── Extend Deadline ──────────────────────────────────────────
  fastify.post<{
    Params: { case_id: string; deadline_id: string };
    Body: ExtendDeadlineInput;
  }>('/cases/:case_id/deadlines/:deadline_id/extend', async (request, reply) => {
    const parsed = extendDeadlineSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Validation error', details: parsed.error.issues });
    }

    const caseId = request.params.case_id as CaseId;
    const deadlineId = request.params.deadline_id as DeadlineId;
    const input = parsed.data;
    const correlationId = ulid() as CorrelationId;
    const causationId = ulid() as CausationId;

    // Find original due date
    const events = await eventStore.getEventsByCase(request.tenant_id, caseId);
    const deadlineEvent = events.find(
      (e) =>
        e.event_type === 'DEADLINE_CREATED' &&
        (e.payload as DeadlineCreatedPayload).deadline_id === deadlineId,
    );
    if (!deadlineEvent) {
      return reply.status(404).send({ error: 'Deadline not found' });
    }

    // Get current due date (might have been extended before)
    const extensionEvents = events.filter(
      (e) =>
        e.event_type === 'DEADLINE_EXTENDED' &&
        (e.payload as any).deadline_id === deadlineId,
    );
    const previousDueDate = extensionEvents.length > 0
      ? (extensionEvents[extensionEvents.length - 1].payload as any).new_due_date
      : (deadlineEvent.payload as DeadlineCreatedPayload).due_date;

    const event: DomainEvent = {
      event_id: ulid(),
      tenant_id: request.tenant_id,
      case_id: caseId,
      event_type: 'DEADLINE_EXTENDED',
      actor_id: request.actor_id,
      actor_role: request.actor_role,
      correlation_id: correlationId,
      causation_id: causationId,
      timestamp: new Date().toISOString(),
      previous_hash: '',
      new_hash: '',
      payload: {
        deadline_id: deadlineId,
        previous_due_date: previousDueDate,
        new_due_date: input.new_due_date,
        extension_fee_id: (input.extension_fee_id ?? null) as FeeId | null,
      },
      metadata: {},
    } as DomainEvent;

    await eventStore.appendBatch([event]);

    return reply.send({
      deadline_id: deadlineId,
      new_due_date: input.new_due_date,
      correlation_id: correlationId,
    });
  });
}
