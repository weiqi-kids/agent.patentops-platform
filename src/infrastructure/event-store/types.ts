/**
 * Event Store — Infrastructure Types
 *
 * The event store is append-only. No UPDATE, no DELETE.
 * All domain state is derived by replaying events.
 */

import type {
  EventId,
  TenantId,
  CaseId,
  CorrelationId,
  CausationId,
} from '../../shared/types/index.js';
import type { DomainEvent, EventType } from '../../shared/events/index.js';

// ─── Event Store Interface ─────────────────────────────────────────

export interface EventStore {
  /** Append a new event. Returns the assigned event_id. */
  append(event: DomainEvent): Promise<EventId>;

  /** Append multiple events atomically (same correlation). */
  appendBatch(events: DomainEvent[]): Promise<EventId[]>;

  /** Retrieve all events for a case, in order. */
  getEventsByCase(tenant_id: TenantId, case_id: CaseId): Promise<DomainEvent[]>;

  /** Retrieve events by type for a case. */
  getEventsByCaseAndType(
    tenant_id: TenantId,
    case_id: CaseId,
    event_type: EventType,
  ): Promise<DomainEvent[]>;

  /** Retrieve events by correlation_id. */
  getEventsByCorrelation(
    tenant_id: TenantId,
    correlation_id: CorrelationId,
  ): Promise<DomainEvent[]>;

  /** Get the latest event for a case (for hash chaining). */
  getLatestEvent(tenant_id: TenantId, case_id: CaseId): Promise<DomainEvent | null>;

  /** Verify hash chain integrity for a case. */
  verifyHashChain(tenant_id: TenantId, case_id: CaseId): Promise<HashChainVerificationResult>;

  /** Stream events for projection rebuilding. */
  streamAllEvents(
    from_event_id?: EventId,
    batch_size?: number,
  ): AsyncIterable<DomainEvent[]>;
}

// ─── Hash Chain Verification ───────────────────────────────────────

export interface HashChainVerificationResult {
  case_id: CaseId;
  tenant_id: TenantId;
  total_events: number;
  verified_events: number;
  is_valid: boolean;
  first_break_at_event_id: EventId | null;
  verified_at: string;
}

// ─── Event Subscription ───────────────────────────────────────────

export type EventHandler = (event: DomainEvent) => Promise<void>;

export interface EventSubscription {
  /** Subscribe to specific event types. */
  subscribe(event_types: EventType[], handler: EventHandler): void;

  /** Subscribe to all events. */
  subscribeAll(handler: EventHandler): void;

  /** Unsubscribe. */
  unsubscribe(handler: EventHandler): void;
}
