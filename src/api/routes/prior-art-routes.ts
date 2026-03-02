/**
 * Prior Art Reference API Routes
 *
 * Add and query prior art references for cases.
 * All endpoints are tenant-scoped (tenant_id extracted from JWT).
 */

import type { FastifyInstance } from 'fastify';
import { ulid } from 'ulid';
import { addPriorArtSchema } from '../schemas/prior-art-schemas.js';
import type { AddPriorArtInput } from '../schemas/prior-art-schemas.js';
import type { EventStore } from '../../infrastructure/event-store/types.js';
import type {
  CaseId,
  EventId,
  CorrelationId,
  CausationId,
} from '../../shared/types/index.js';
import type { DomainEvent } from '../../shared/events/index.js';

export async function priorArtRoutes(
  fastify: FastifyInstance,
  opts: { eventStore: EventStore },
): Promise<void> {
  const { eventStore } = opts;

  // ─── Add Prior Art Reference ─────────────────────────────────
  fastify.post<{
    Params: { case_id: string };
    Body: AddPriorArtInput;
  }>('/cases/:case_id/prior-art', async (request, reply) => {
    const parsed = addPriorArtSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Validation error', details: parsed.error.issues });
    }

    const caseId = request.params.case_id as CaseId;
    const input = parsed.data;
    const correlationId = ulid() as CorrelationId;
    const causationId = ulid() as CausationId;
    const referenceId = ulid();

    const event: DomainEvent = {
      event_id: ulid() as EventId,
      tenant_id: request.tenant_id,
      case_id: caseId,
      event_type: 'PRIOR_ART_REFERENCE_ADDED',
      actor_id: request.actor_id,
      actor_role: request.actor_role,
      correlation_id: correlationId,
      causation_id: causationId,
      timestamp: new Date().toISOString(),
      previous_hash: '',
      new_hash: '',
      payload: {
        reference_id: referenceId,
        reference_type: input.reference_type,
        document_number: input.document_number,
        title: input.title,
        source: input.source,
      },
      metadata: {
        inventor: input.inventor ?? null,
        publication_date: input.publication_date ?? null,
        jurisdiction: input.jurisdiction ?? null,
      },
    } as DomainEvent;

    await eventStore.appendBatch([event]);

    return reply.status(201).send({
      reference_id: referenceId,
      document_number: input.document_number,
      correlation_id: correlationId,
    });
  });

  // ─── List Prior Art References for Case ──────────────────────
  fastify.get<{
    Params: { case_id: string };
  }>('/cases/:case_id/prior-art', async (request, reply) => {
    const caseId = request.params.case_id as CaseId;
    const events = await eventStore.getEventsByCase(request.tenant_id, caseId);

    const priorArtEvents = events.filter((e) => e.event_type === 'PRIOR_ART_REFERENCE_ADDED');
    const references = priorArtEvents.map((e) => {
      const p = e.payload as {
        reference_id: string;
        reference_type: string;
        document_number: string;
        title: string;
        source: string;
      };
      const meta = e.metadata as {
        inventor?: string | null;
        publication_date?: string | null;
        jurisdiction?: string | null;
      };

      return {
        reference_id: p.reference_id,
        reference_type: p.reference_type,
        document_number: p.document_number,
        title: p.title,
        source: p.source,
        inventor: meta.inventor ?? null,
        publication_date: meta.publication_date ?? null,
        jurisdiction: meta.jurisdiction ?? null,
        added_at: e.timestamp,
        added_by: e.actor_id,
      };
    });

    return reply.send({ references, total: references.length });
  });
}
