/**
 * Case API Routes
 *
 * All endpoints are tenant-scoped (tenant_id extracted from JWT).
 */

import type { FastifyInstance } from 'fastify';
import { ulid } from 'ulid';
import {
  createCaseSchema,
  changeCaseStatusSchema,
  recordFilingReceiptSchema,
  recordAllowanceSchema,
  recordGrantSchema,
  closeCaseSchema,
} from '../schemas/case-schemas.js';
import type {
  CreateCaseInput,
  ChangeCaseStatusInput,
  RecordFilingReceiptInput,
  RecordAllowanceInput,
  RecordGrantInput,
  CloseCaseInput,
} from '../schemas/case-schemas.js';
import { CaseAggregate } from '../../domain/case/case-aggregate.js';
import {
  FilingPreChecker,
} from '../../domain/case/filing-pre-check.js';
import type { FiledDocumentRecord } from '../../domain/case/filing-pre-check.js';
import type { EventStore } from '../../infrastructure/event-store/types.js';
import type {
  CaseId,
  CorrelationId,
  CausationId,
  CaseStatus,
  CaseCloseReason,
  DocumentType,
  DocumentStatus,
} from '../../shared/types/index.js';

export async function caseRoutes(
  fastify: FastifyInstance,
  opts: { eventStore: EventStore },
): Promise<void> {
  const { eventStore } = opts;

  // ─── Create Case ──────────────────────────────────────────────
  fastify.post<{ Body: CreateCaseInput }>('/cases', async (request, reply) => {
    const parsed = createCaseSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Validation error', details: parsed.error.issues });
    }

    const input = parsed.data;
    const aggregate = new CaseAggregate();
    const correlationId = ulid() as CorrelationId;

    aggregate.createCase({
      tenant_id: request.tenant_id,
      title: input.title,
      patent_type: input.patent_type,
      applicant_id: input.applicant_id as any,
      inventor_ids: input.inventor_ids as any[],
      assigned_attorney_id: input.assigned_attorney_id as any,
      jurisdiction: input.jurisdiction,
      priority_date: input.priority_date ?? null,
      parent_case_id: (input.parent_case_id ?? null) as CaseId | null,
      actor_id: request.actor_id,
      actor_role: request.actor_role,
      correlation_id: correlationId,
    });

    const events = aggregate.pendingEvents;
    await eventStore.appendBatch(events);

    return reply.status(201).send({
      case_id: aggregate.currentState!.case_id,
      status: aggregate.currentState!.status,
      correlation_id: correlationId,
    });
  });

  // ─── Get Case ──────────────────────────────────────────────────
  fastify.get<{ Params: { case_id: string } }>('/cases/:case_id', async (request, reply) => {
    const caseId = request.params.case_id as CaseId;
    const events = await eventStore.getEventsByCase(request.tenant_id, caseId);

    if (events.length === 0) {
      return reply.status(404).send({ error: 'Case not found' });
    }

    const aggregate = new CaseAggregate();
    aggregate.loadFromHistory(events);

    return reply.send(aggregate.currentState);
  });

  // ─── Change Case Status ────────────────────────────────────────
  fastify.post<{
    Params: { case_id: string };
    Body: ChangeCaseStatusInput;
  }>('/cases/:case_id/status', async (request, reply) => {
    const parsed = changeCaseStatusSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Validation error', details: parsed.error.issues });
    }

    const caseId = request.params.case_id as CaseId;
    const input = parsed.data;

    // Load current state
    const existingEvents = await eventStore.getEventsByCase(request.tenant_id, caseId);
    if (existingEvents.length === 0) {
      return reply.status(404).send({ error: 'Case not found' });
    }

    const aggregate = new CaseAggregate();
    aggregate.loadFromHistory(existingEvents);

    const correlationId = ulid() as CorrelationId;
    const causationId = ulid() as CausationId;

    // Filing pre-check: validate document completeness when transitioning to FILING
    if (input.to_state === 'FILING' && aggregate.currentState!.status === 'REVIEW') {
      const checker = new FilingPreChecker();
      const docEvents = existingEvents.filter(
        (e) => e.event_type === 'DOCUMENT_GENERATED' || e.event_type === 'DOCUMENT_FINALIZED',
      );

      // Build document records from events
      const docMap = new Map<string, FiledDocumentRecord>();
      for (const e of docEvents) {
        const p = e.payload as { document_id: string; document_type?: DocumentType; content_hash?: string; from_status?: DocumentStatus; to_status?: string };
        if (e.event_type === 'DOCUMENT_GENERATED') {
          docMap.set(p.document_id, {
            document_type: p.document_type!,
            status: 'draft',
            content_hash: p.content_hash ?? '',
          });
        }
        if (e.event_type === 'DOCUMENT_FINALIZED') {
          const existing = docMap.get(p.document_id);
          if (existing) {
            existing.status = 'final';
            if (p.content_hash) existing.content_hash = p.content_hash;
          }
        }
      }

      const checkResult = checker.check(
        caseId,
        request.tenant_id,
        aggregate.currentState!.patent_type,
        aggregate.currentState!.jurisdiction,
        Array.from(docMap.values()),
      );

      if (!checkResult.is_ready) {
        return reply.status(422).send({
          error: 'Filing pre-check failed',
          missing_documents: checkResult.missing_documents,
          warnings: checkResult.warnings,
        });
      }
    }

    try {
      aggregate.changeStatus({
        tenant_id: request.tenant_id,
        case_id: caseId,
        to_state: input.to_state as CaseStatus,
        reason: input.reason ?? null,
        actor_id: request.actor_id,
        actor_role: request.actor_role,
        correlation_id: correlationId,
        causation_id: causationId,
      });
    } catch (err: any) {
      return reply.status(422).send({ error: err.message });
    }

    await eventStore.appendBatch(aggregate.pendingEvents);

    return reply.send({
      case_id: caseId,
      status: aggregate.currentState!.status,
      correlation_id: correlationId,
    });
  });

  // ─── Record Filing Receipt ─────────────────────────────────────
  fastify.post<{
    Params: { case_id: string };
    Body: RecordFilingReceiptInput;
  }>('/cases/:case_id/filing-receipt', async (request, reply) => {
    const parsed = recordFilingReceiptSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Validation error', details: parsed.error.issues });
    }

    const caseId = request.params.case_id as CaseId;
    const input = parsed.data;

    const existingEvents = await eventStore.getEventsByCase(request.tenant_id, caseId);
    if (existingEvents.length === 0) {
      return reply.status(404).send({ error: 'Case not found' });
    }

    const aggregate = new CaseAggregate();
    aggregate.loadFromHistory(existingEvents);

    const correlationId = ulid() as CorrelationId;
    const causationId = ulid() as CausationId;

    try {
      aggregate.recordFilingReceipt({
        tenant_id: request.tenant_id,
        case_id: caseId,
        application_number: input.application_number,
        filing_date: input.filing_date,
        filing_reference: input.filing_reference ?? null,
        actor_id: request.actor_id,
        actor_role: request.actor_role,
        correlation_id: correlationId,
        causation_id: causationId,
      });
    } catch (err: any) {
      return reply.status(422).send({ error: err.message });
    }

    await eventStore.appendBatch(aggregate.pendingEvents);

    return reply.send({
      case_id: caseId,
      application_number: input.application_number,
      correlation_id: correlationId,
    });
  });

  // ─── Close Case ────────────────────────────────────────────────
  fastify.post<{
    Params: { case_id: string };
    Body: CloseCaseInput;
  }>('/cases/:case_id/close', async (request, reply) => {
    const parsed = closeCaseSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Validation error', details: parsed.error.issues });
    }

    const caseId = request.params.case_id as CaseId;
    const input = parsed.data;

    const existingEvents = await eventStore.getEventsByCase(request.tenant_id, caseId);
    if (existingEvents.length === 0) {
      return reply.status(404).send({ error: 'Case not found' });
    }

    const aggregate = new CaseAggregate();
    aggregate.loadFromHistory(existingEvents);

    const correlationId = ulid() as CorrelationId;
    const causationId = ulid() as CausationId;

    try {
      aggregate.closeCase({
        tenant_id: request.tenant_id,
        case_id: caseId,
        close_reason: input.close_reason as CaseCloseReason,
        actor_id: request.actor_id,
        actor_role: request.actor_role,
        correlation_id: correlationId,
        causation_id: causationId,
      });
    } catch (err: any) {
      return reply.status(422).send({ error: err.message });
    }

    await eventStore.appendBatch(aggregate.pendingEvents);

    return reply.send({
      case_id: caseId,
      status: 'CLOSED',
      close_reason: input.close_reason,
      correlation_id: correlationId,
    });
  });

  // ─── Verify Hash Chain ─────────────────────────────────────────
  fastify.get<{
    Params: { case_id: string };
  }>('/cases/:case_id/verify', async (request, reply) => {
    const caseId = request.params.case_id as CaseId;
    const result = await eventStore.verifyHashChain(request.tenant_id, caseId);
    return reply.send(result);
  });

  // ─── Get Case Events ───────────────────────────────────────────
  fastify.get<{
    Params: { case_id: string };
  }>('/cases/:case_id/events', async (request, reply) => {
    const caseId = request.params.case_id as CaseId;
    const events = await eventStore.getEventsByCase(request.tenant_id, caseId);
    return reply.send({ events, total: events.length });
  });
}
