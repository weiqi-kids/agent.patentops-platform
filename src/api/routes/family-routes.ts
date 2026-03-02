/**
 * Patent Family API Routes
 *
 * Endpoints for managing patent family links and priority claims.
 * All endpoints are tenant-scoped (tenant_id extracted from JWT).
 */

import type { FastifyInstance } from 'fastify';
import { ulid } from 'ulid';
import {
  linkFamilySchema,
  unlinkFamilySchema,
  recordPriorityClaimSchema,
} from '../schemas/family-schemas.js';
import type {
  LinkFamilyInput,
  UnlinkFamilyInput,
  RecordPriorityClaimInput,
} from '../schemas/family-schemas.js';
import type { EventStore } from '../../infrastructure/event-store/types.js';
import { FamilyAggregate } from '../../domain/family/family-aggregate.js';
import type {
  CaseId,
  CorrelationId,
  CausationId,
} from '../../shared/types/index.js';

export async function familyRoutes(
  fastify: FastifyInstance,
  opts: { eventStore: EventStore },
): Promise<void> {
  const { eventStore } = opts;

  // ─── Link Family ────────────────────────────────────────────────
  fastify.post<{
    Body: LinkFamilyInput;
  }>('/family/links', async (request, reply) => {
    const parsed = linkFamilySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Validation error', details: parsed.error.issues });
    }

    const input = parsed.data;
    const parentCaseId = input.parent_case_id as CaseId;
    const childCaseId = input.child_case_id as CaseId;
    const correlationId = ulid() as CorrelationId;
    const causationId = ulid() as CausationId;

    // Load existing family events for both cases
    const agg = new FamilyAggregate();
    const parentEvents = await eventStore.getEventsByCase(request.tenant_id, parentCaseId);
    const childEvents = await eventStore.getEventsByCase(request.tenant_id, childCaseId);

    // Combine and replay family-related events
    const familyEvents = [...parentEvents, ...childEvents].filter(
      (e) => e.event_type === 'PATENT_FAMILY_LINKED' || e.event_type === 'PATENT_FAMILY_UNLINKED',
    );
    agg.loadFromHistory(familyEvents);

    try {
      agg.linkFamily({
        tenant_id: request.tenant_id,
        parent_case_id: parentCaseId,
        child_case_id: childCaseId,
        relationship_type: input.relationship_type,
        priority_date: input.priority_date,
        parent_filing_date: input.parent_filing_date ?? null,
        actor_id: request.actor_id,
        actor_role: request.actor_role,
        correlation_id: correlationId,
        causation_id: causationId,
      });
    } catch (err: any) {
      return reply.status(422).send({ error: err.message });
    }

    await eventStore.appendBatch(agg.pendingEvents);
    const link = agg.currentLinks.find(
      (l) => l.parent_case_id === parentCaseId && l.child_case_id === childCaseId,
    );

    return reply.status(201).send({
      family_id: link?.family_id,
      parent_case_id: parentCaseId,
      child_case_id: childCaseId,
      relationship_type: input.relationship_type,
      correlation_id: correlationId,
    });
  });

  // ─── Unlink Family ──────────────────────────────────────────────
  fastify.post<{
    Body: UnlinkFamilyInput;
  }>('/family/unlink', async (request, reply) => {
    const parsed = unlinkFamilySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Validation error', details: parsed.error.issues });
    }

    const input = parsed.data;
    const parentCaseId = input.parent_case_id as CaseId;
    const childCaseId = input.child_case_id as CaseId;
    const correlationId = ulid() as CorrelationId;
    const causationId = ulid() as CausationId;

    const agg = new FamilyAggregate();
    const parentEvents = await eventStore.getEventsByCase(request.tenant_id, parentCaseId);
    const childEvents = await eventStore.getEventsByCase(request.tenant_id, childCaseId);
    const familyEvents = [...parentEvents, ...childEvents].filter(
      (e) => e.event_type === 'PATENT_FAMILY_LINKED' || e.event_type === 'PATENT_FAMILY_UNLINKED',
    );
    agg.loadFromHistory(familyEvents);

    try {
      agg.unlinkFamily({
        tenant_id: request.tenant_id,
        parent_case_id: parentCaseId,
        child_case_id: childCaseId,
        reason: input.reason,
        actor_id: request.actor_id,
        actor_role: request.actor_role,
        correlation_id: correlationId,
        causation_id: causationId,
      });
    } catch (err: any) {
      return reply.status(422).send({ error: err.message });
    }

    await eventStore.appendBatch(agg.pendingEvents);

    return reply.send({
      parent_case_id: parentCaseId,
      child_case_id: childCaseId,
      unlinked: true,
      correlation_id: correlationId,
    });
  });

  // ─── List Family Links for Case ─────────────────────────────────
  fastify.get<{
    Params: { case_id: string };
  }>('/cases/:case_id/family', async (request, reply) => {
    const caseId = request.params.case_id as CaseId;
    const events = await eventStore.getEventsByCase(request.tenant_id, caseId);

    const familyEvents = events.filter(
      (e) => e.event_type === 'PATENT_FAMILY_LINKED' || e.event_type === 'PATENT_FAMILY_UNLINKED',
    );

    const agg = new FamilyAggregate();
    agg.loadFromHistory(familyEvents);

    const links = agg.getLinkedCases(caseId);

    return reply.send({
      case_id: caseId,
      family_links: links,
      total: links.length,
    });
  });

  // ─── Record Priority Claim ──────────────────────────────────────
  fastify.post<{
    Params: { case_id: string };
    Body: RecordPriorityClaimInput;
  }>('/cases/:case_id/priority-claims', async (request, reply) => {
    const parsed = recordPriorityClaimSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Validation error', details: parsed.error.issues });
    }

    const caseId = request.params.case_id as CaseId;
    const input = parsed.data;
    const correlationId = ulid() as CorrelationId;
    const causationId = ulid() as CausationId;

    const agg = new FamilyAggregate();

    try {
      agg.recordPriorityClaim({
        tenant_id: request.tenant_id,
        claiming_case_id: caseId,
        parent_case_id: input.parent_case_id as CaseId,
        priority_date: input.priority_date,
        basis: input.basis,
        parent_filing_date: input.parent_filing_date ?? null,
        actor_id: request.actor_id,
        actor_role: request.actor_role,
        correlation_id: correlationId,
        causation_id: causationId,
      });
    } catch (err: any) {
      return reply.status(422).send({ error: err.message });
    }

    await eventStore.appendBatch(agg.pendingEvents);

    return reply.status(201).send({
      claiming_case_id: caseId,
      parent_case_id: input.parent_case_id,
      priority_date: input.priority_date,
      correlation_id: correlationId,
    });
  });
}
