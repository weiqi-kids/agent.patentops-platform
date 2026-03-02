/**
 * Office Action API Routes
 *
 * Endpoints for receiving OAs and managing the OA response sub-workflow.
 * All endpoints are tenant-scoped (tenant_id extracted from JWT).
 */

import type { FastifyInstance } from 'fastify';
import { ulid } from 'ulid';
import {
  receiveOaSchema,
  transitionOaSchema,
  fileOaResponseSchema,
} from '../schemas/oa-schemas.js';
import type {
  ReceiveOaInput,
  TransitionOaInput,
  FileOaResponseInput,
} from '../schemas/oa-schemas.js';
import type { EventStore } from '../../infrastructure/event-store/types.js';
import {
  validateOaTransition,
} from '../../workflow/states/oa-response-state-machine.js';
import type {
  CaseId,
  EventId,
  OfficeActionId,
  OfficeActionStatus,
  CorrelationId,
  CausationId,
  DocumentId,
} from '../../shared/types/index.js';
import type { DomainEvent, OaReceivedPayload } from '../../shared/events/index.js';

export async function oaRoutes(
  fastify: FastifyInstance,
  opts: { eventStore: EventStore },
): Promise<void> {
  const { eventStore } = opts;

  // ─── Receive Office Action ──────────────────────────────────────
  fastify.post<{
    Params: { case_id: string };
    Body: ReceiveOaInput;
  }>('/cases/:case_id/office-actions', async (request, reply) => {
    const parsed = receiveOaSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Validation error', details: parsed.error.issues });
    }

    const caseId = request.params.case_id as CaseId;
    const input = parsed.data;
    const correlationId = ulid() as CorrelationId;
    const causationId = ulid() as CausationId;
    const oaId = ulid() as OfficeActionId;

    // Determine sequence number from existing OAs
    const existingEvents = await eventStore.getEventsByCase(request.tenant_id, caseId);
    const oaEvents = existingEvents.filter((e) => e.event_type === 'OA_RECEIVED');
    const sequenceNumber = oaEvents.length + 1;

    const payload: OaReceivedPayload = {
      oa_id: oaId,
      oa_category: input.oa_category,
      oa_type_label: input.oa_type_label,
      mailing_date: input.mailing_date,
      received_date: input.received_date,
      response_deadline: input.response_deadline,
      rejection_bases: input.rejection_bases,
      statutory_references: input.statutory_references,
      cited_references: input.cited_references,
      sequence_number: sequenceNumber,
    };

    const event: DomainEvent = {
      event_id: ulid() as EventId,
      tenant_id: request.tenant_id,
      case_id: caseId,
      event_type: 'OA_RECEIVED',
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
      oa_id: oaId,
      sequence_number: sequenceNumber,
      status: 'received',
      correlation_id: correlationId,
    });
  });

  // ─── List Office Actions for Case ────────────────────────────────
  fastify.get<{
    Params: { case_id: string };
  }>('/cases/:case_id/office-actions', async (request, reply) => {
    const caseId = request.params.case_id as CaseId;
    const events = await eventStore.getEventsByCase(request.tenant_id, caseId);
    const oaEvents = events.filter((e) => e.event_type === 'OA_RECEIVED');

    const officeActions = oaEvents.map((e) => {
      const p = e.payload as OaReceivedPayload;
      // Find latest status for this OA
      const statusEvents = events.filter(
        (ev) =>
          (ev.event_type === 'OA_CLASSIFIED' ||
            ev.event_type === 'OA_RESPONSE_FILED') &&
          (ev.payload as any).oa_id === p.oa_id,
      );
      const lastStatus = statusEvents.length > 0
        ? (statusEvents[statusEvents.length - 1].payload as any).to_status ?? 'filed'
        : 'received';

      return {
        oa_id: p.oa_id,
        oa_category: p.oa_category,
        oa_type_label: p.oa_type_label,
        mailing_date: p.mailing_date,
        received_date: p.received_date,
        response_deadline: p.response_deadline,
        rejection_bases: p.rejection_bases,
        sequence_number: p.sequence_number,
        status: lastStatus,
      };
    });

    return reply.send({ office_actions: officeActions, total: officeActions.length });
  });

  // ─── Transition OA Status ──────────────────────────────────────
  fastify.post<{
    Params: { case_id: string; oa_id: string };
    Body: TransitionOaInput;
  }>('/cases/:case_id/office-actions/:oa_id/status', async (request, reply) => {
    const parsed = transitionOaSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Validation error', details: parsed.error.issues });
    }

    const caseId = request.params.case_id as CaseId;
    const oaId = request.params.oa_id as OfficeActionId;
    const input = parsed.data;
    const toStatus = input.to_status as OfficeActionStatus;
    const correlationId = ulid() as CorrelationId;
    const causationId = ulid() as CausationId;

    // Determine current status from events
    const events = await eventStore.getEventsByCase(request.tenant_id, caseId);
    const oaReceived = events.find(
      (e) => e.event_type === 'OA_RECEIVED' && (e.payload as any).oa_id === oaId,
    );
    if (!oaReceived) {
      return reply.status(404).send({ error: 'Office action not found' });
    }

    // Find current status
    const statusEvents = events.filter(
      (e) =>
        e.event_type === 'OA_CLASSIFIED' &&
        (e.payload as any).oa_id === oaId,
    );
    const currentStatus: OfficeActionStatus = statusEvents.length > 0
      ? (statusEvents[statusEvents.length - 1].payload as any).to_status
      : 'received';

    const result = validateOaTransition(currentStatus, toStatus, request.actor_role);
    if (!result.valid) {
      return reply.status(422).send({ error: result.error });
    }

    const event: DomainEvent = {
      event_id: ulid() as EventId,
      tenant_id: request.tenant_id,
      case_id: caseId,
      event_type: 'OA_CLASSIFIED',
      actor_id: request.actor_id,
      actor_role: request.actor_role,
      correlation_id: correlationId,
      causation_id: causationId,
      timestamp: new Date().toISOString(),
      previous_hash: '',
      new_hash: '',
      payload: {
        oa_id: oaId,
        from_status: currentStatus,
        to_status: toStatus,
      },
      metadata: {},
    } as DomainEvent;

    await eventStore.appendBatch([event]);

    return reply.send({
      oa_id: oaId,
      status: toStatus,
      correlation_id: correlationId,
    });
  });

  // ─── File OA Response ──────────────────────────────────────────
  fastify.post<{
    Params: { case_id: string; oa_id: string };
    Body: FileOaResponseInput;
  }>('/cases/:case_id/office-actions/:oa_id/file', async (request, reply) => {
    const parsed = fileOaResponseSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Validation error', details: parsed.error.issues });
    }

    const caseId = request.params.case_id as CaseId;
    const oaId = request.params.oa_id as OfficeActionId;
    const input = parsed.data;
    const correlationId = ulid() as CorrelationId;
    const causationId = ulid() as CausationId;

    const event: DomainEvent = {
      event_id: ulid() as EventId,
      tenant_id: request.tenant_id,
      case_id: caseId,
      event_type: 'OA_RESPONSE_FILED',
      actor_id: request.actor_id,
      actor_role: request.actor_role,
      correlation_id: correlationId,
      causation_id: causationId,
      timestamp: new Date().toISOString(),
      previous_hash: '',
      new_hash: '',
      payload: {
        oa_id: oaId,
        document_id: input.document_id as DocumentId,
        filed_hash: input.filed_hash,
      },
      metadata: {},
    } as DomainEvent;

    await eventStore.appendBatch([event]);

    return reply.send({
      oa_id: oaId,
      status: 'filed',
      correlation_id: correlationId,
    });
  });
}
