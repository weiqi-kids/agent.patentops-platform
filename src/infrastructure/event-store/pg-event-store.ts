/**
 * PostgreSQL Event Store Implementation
 *
 * Append-only event store with hash chain verification.
 * All writes are INSERT-only — no UPDATE, no DELETE.
 */

import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { eq, and, asc, gt, sql } from 'drizzle-orm';
import { events } from '../database/schema.js';
import type {
  EventStore,
  HashChainVerificationResult,
} from './types.js';
import type { DomainEvent, EventType } from '../../shared/events/index.js';
import type {
  EventId,
  TenantId,
  CaseId,
  CorrelationId,
} from '../../shared/types/index.js';
import { computeEventHash, GENESIS_HASH, verifyEventHash } from './hash-chain.js';
import { ulid } from 'ulid';

type DB = NodePgDatabase<Record<string, never>>;

export class PgEventStore implements EventStore {
  constructor(private readonly db: DB) {}

  async append(event: DomainEvent): Promise<EventId> {
    const eventId = event.event_id || (ulid() as EventId);

    // Get the latest event for this case to determine previous_hash and sequence
    const latest = await this.getLatestEvent(event.tenant_id, event.case_id);
    const previousHash = latest ? latest.new_hash : GENESIS_HASH;
    const sequenceNumber = latest
      ? (await this.getSequenceNumber(event.case_id)) + 1
      : 1;

    const newHash = computeEventHash(
      eventId,
      event.case_id,
      event.event_type,
      event.actor_id,
      event.timestamp,
      event.payload,
      previousHash,
    );

    await this.db.insert(events).values({
      event_id: eventId,
      tenant_id: event.tenant_id,
      case_id: event.case_id,
      event_type: event.event_type,
      actor_id: event.actor_id,
      actor_role: event.actor_role,
      correlation_id: event.correlation_id,
      causation_id: event.causation_id,
      timestamp: new Date(event.timestamp),
      previous_hash: previousHash,
      new_hash: newHash,
      payload: event.payload as Record<string, unknown>,
      metadata: (event.metadata ?? {}) as Record<string, unknown>,
      sequence_number: sequenceNumber,
    });

    return eventId;
  }

  async appendBatch(domainEvents: DomainEvent[]): Promise<EventId[]> {
    if (domainEvents.length === 0) return [];

    const eventIds: EventId[] = [];

    // All events in a batch must be for the same case
    const caseId = domainEvents[0].case_id;
    const tenantId = domainEvents[0].tenant_id;

    const latest = await this.getLatestEvent(tenantId, caseId);
    let previousHash = latest ? latest.new_hash : GENESIS_HASH;
    let sequenceNumber = latest
      ? (await this.getSequenceNumber(caseId)) + 1
      : 1;

    const rows = domainEvents.map((event) => {
      const eventId = event.event_id || (ulid() as EventId);
      const newHash = computeEventHash(
        eventId,
        event.case_id,
        event.event_type,
        event.actor_id,
        event.timestamp,
        event.payload,
        previousHash,
      );

      const row = {
        event_id: eventId,
        tenant_id: event.tenant_id,
        case_id: event.case_id,
        event_type: event.event_type,
        actor_id: event.actor_id,
        actor_role: event.actor_role,
        correlation_id: event.correlation_id,
        causation_id: event.causation_id,
        timestamp: new Date(event.timestamp),
        previous_hash: previousHash,
        new_hash: newHash,
        payload: event.payload as Record<string, unknown>,
        metadata: (event.metadata ?? {}) as Record<string, unknown>,
        sequence_number: sequenceNumber,
      };

      previousHash = newHash;
      sequenceNumber++;
      eventIds.push(eventId);
      return row;
    });

    await this.db.insert(events).values(rows);
    return eventIds;
  }

  async getEventsByCase(
    tenant_id: TenantId,
    case_id: CaseId,
  ): Promise<DomainEvent[]> {
    const rows = await this.db
      .select()
      .from(events)
      .where(and(eq(events.tenant_id, tenant_id), eq(events.case_id, case_id)))
      .orderBy(asc(events.sequence_number));

    return rows.map(rowToEvent);
  }

  async getEventsByCaseAndType(
    tenant_id: TenantId,
    case_id: CaseId,
    event_type: EventType,
  ): Promise<DomainEvent[]> {
    const rows = await this.db
      .select()
      .from(events)
      .where(
        and(
          eq(events.tenant_id, tenant_id),
          eq(events.case_id, case_id),
          eq(events.event_type, event_type),
        ),
      )
      .orderBy(asc(events.sequence_number));

    return rows.map(rowToEvent);
  }

  async getEventsByCorrelation(
    tenant_id: TenantId,
    correlation_id: CorrelationId,
  ): Promise<DomainEvent[]> {
    const rows = await this.db
      .select()
      .from(events)
      .where(
        and(
          eq(events.tenant_id, tenant_id),
          eq(events.correlation_id, correlation_id),
        ),
      )
      .orderBy(asc(events.sequence_number));

    return rows.map(rowToEvent);
  }

  async getLatestEvent(
    tenant_id: TenantId,
    case_id: CaseId,
  ): Promise<DomainEvent | null> {
    const rows = await this.db
      .select()
      .from(events)
      .where(and(eq(events.tenant_id, tenant_id), eq(events.case_id, case_id)))
      .orderBy(sql`${events.sequence_number} DESC`)
      .limit(1);

    if (rows.length === 0) return null;
    return rowToEvent(rows[0]);
  }

  async verifyHashChain(
    tenant_id: TenantId,
    case_id: CaseId,
  ): Promise<HashChainVerificationResult> {
    const caseEvents = await this.getEventsByCase(tenant_id, case_id);

    let firstBreakAtEventId: EventId | null = null;
    let verifiedCount = 0;

    for (let i = 0; i < caseEvents.length; i++) {
      const event = caseEvents[i];
      const expectedPrevHash = i === 0 ? GENESIS_HASH : caseEvents[i - 1].new_hash;

      if (event.previous_hash !== expectedPrevHash || !verifyEventHash(event)) {
        firstBreakAtEventId = event.event_id;
        break;
      }
      verifiedCount++;
    }

    return {
      case_id,
      tenant_id,
      total_events: caseEvents.length,
      verified_events: verifiedCount,
      is_valid: verifiedCount === caseEvents.length,
      first_break_at_event_id: firstBreakAtEventId,
      verified_at: new Date().toISOString(),
    };
  }

  async *streamAllEvents(
    from_event_id?: EventId,
    batch_size: number = 100,
  ): AsyncIterable<DomainEvent[]> {
    let lastId = from_event_id ?? '';

    while (true) {
      const condition = lastId
        ? gt(events.event_id, lastId)
        : undefined;

      const rows = await this.db
        .select()
        .from(events)
        .where(condition)
        .orderBy(asc(events.event_id))
        .limit(batch_size);

      if (rows.length === 0) break;

      yield rows.map(rowToEvent);
      lastId = rows[rows.length - 1].event_id;

      if (rows.length < batch_size) break;
    }
  }

  private async getSequenceNumber(case_id: string): Promise<number> {
    const result = await this.db
      .select({ max: sql<number>`COALESCE(MAX(${events.sequence_number}), 0)` })
      .from(events)
      .where(eq(events.case_id, case_id));

    return result[0]?.max ?? 0;
  }
}

// ─── Row Mapping ────────────────────────────────────────────────────

function rowToEvent(row: typeof events.$inferSelect): DomainEvent {
  return {
    event_id: row.event_id,
    tenant_id: row.tenant_id,
    case_id: row.case_id,
    event_type: row.event_type,
    actor_id: row.actor_id,
    actor_role: row.actor_role,
    correlation_id: row.correlation_id,
    causation_id: row.causation_id,
    timestamp: row.timestamp.toISOString(),
    previous_hash: row.previous_hash,
    new_hash: row.new_hash,
    payload: row.payload,
    metadata: row.metadata as Record<string, unknown>,
  } as DomainEvent;
}
