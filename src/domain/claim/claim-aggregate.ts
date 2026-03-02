/**
 * Claim Aggregate — Domain Logic
 *
 * Manages the lifecycle of patent claims within a case.
 * Claims are the most critical part of a patent application — they define
 * the scope of protection.
 *
 * Every claim operation emits events. State is reconstructed from event replay.
 */

import { ulid } from 'ulid';
import type {
  CaseId,
  TenantId,
  ClaimId,
  ActorId,
  CorrelationId,
  CausationId,
  Claim,
  ClaimType,
  ClaimCategory,
  ClaimStatus,
  ActorRole,
} from '../../shared/types/index.js';
import type {
  DomainEvent,
  ClaimCreatedPayload,
  ClaimAmendedPayload,
} from '../../shared/events/index.js';

// ─── Commands ──────────────────────────────────────────────────────

export interface CreateClaimCommand {
  tenant_id: TenantId;
  case_id: CaseId;
  claim_number: number;
  claim_type: ClaimType;
  claim_category: ClaimCategory | null;
  depends_on_claim_id: ClaimId | null;
  claim_text: string;
  ai_generated: boolean;
  actor_id: ActorId;
  actor_role: ActorRole;
  correlation_id: CorrelationId;
  causation_id: CausationId;
}

export interface AmendClaimCommand {
  tenant_id: TenantId;
  case_id: CaseId;
  claim_id: ClaimId;
  new_text: string;
  amendment_reason: string;
  actor_id: ActorId;
  actor_role: ActorRole;
  correlation_id: CorrelationId;
  causation_id: CausationId;
}

export interface ChangeClaimStatusCommand {
  tenant_id: TenantId;
  case_id: CaseId;
  claim_id: ClaimId;
  to_status: ClaimStatus;
  actor_id: ActorId;
  actor_role: ActorRole;
  correlation_id: CorrelationId;
  causation_id: CausationId;
}

// ─── Aggregate ─────────────────────────────────────────────────────

export class ClaimAggregate {
  private claims: Map<string, Claim> = new Map();
  private uncommittedEvents: DomainEvent[] = [];

  get allClaims(): Claim[] {
    return [...this.claims.values()];
  }

  get pendingEvents(): DomainEvent[] {
    return [...this.uncommittedEvents];
  }

  clearPendingEvents(): void {
    this.uncommittedEvents = [];
  }

  getClaim(claimId: ClaimId): Claim | undefined {
    return this.claims.get(claimId);
  }

  /**
   * Reconstruct state from event history.
   */
  loadFromHistory(events: DomainEvent[]): void {
    for (const event of events) {
      this.applyEvent(event);
    }
  }

  /**
   * Create a new claim.
   */
  createClaim(cmd: CreateClaimCommand): ClaimId {
    // Validate dependency
    if (cmd.depends_on_claim_id) {
      const parent = this.claims.get(cmd.depends_on_claim_id);
      if (!parent) {
        throw new Error(`Parent claim ${cmd.depends_on_claim_id} not found`);
      }
      if (parent.claim_type !== 'independent') {
        // Dependent-on-dependent is technically allowed but uncommon
      }
    }

    if (cmd.claim_type === 'dependent' && !cmd.depends_on_claim_id) {
      throw new Error('Dependent claims must specify depends_on_claim_id');
    }

    // Check for duplicate claim numbers
    for (const claim of this.claims.values()) {
      if (claim.claim_number === cmd.claim_number && claim.status !== 'cancelled') {
        throw new Error(`Claim number ${cmd.claim_number} already exists`);
      }
    }

    const claimId = ulid() as ClaimId;
    const eventId = ulid();
    const now = new Date().toISOString();

    const payload: ClaimCreatedPayload = {
      claim_id: claimId,
      claim_number: cmd.claim_number,
      claim_type: cmd.claim_type,
      claim_category: cmd.claim_category,
      depends_on_claim_id: cmd.depends_on_claim_id,
      claim_text: cmd.claim_text,
      ai_generated: cmd.ai_generated,
    };

    const event = this.buildEvent(
      eventId, cmd.tenant_id, cmd.case_id,
      'CLAIM_CREATED', payload,
      cmd.actor_id, cmd.actor_role,
      cmd.correlation_id, cmd.causation_id,
      now,
    );

    this.applyEvent(event);
    this.uncommittedEvents.push(event);
    return claimId;
  }

  /**
   * Amend an existing claim (creates a new version).
   */
  amendClaim(cmd: AmendClaimCommand): void {
    const claim = this.claims.get(cmd.claim_id);
    if (!claim) {
      throw new Error(`Claim ${cmd.claim_id} not found`);
    }

    if (claim.status === 'cancelled') {
      throw new Error('Cannot amend a cancelled claim');
    }

    if (cmd.new_text === claim.claim_text) {
      throw new Error('Amendment text is identical to current text');
    }

    const eventId = ulid();
    const now = new Date().toISOString();

    const payload: ClaimAmendedPayload = {
      claim_id: cmd.claim_id,
      previous_version: claim.version,
      new_version: claim.version + 1,
      previous_text: claim.claim_text,
      new_text: cmd.new_text,
      amendment_reason: cmd.amendment_reason,
      diff: computeSimpleDiff(claim.claim_text, cmd.new_text),
    };

    const event = this.buildEvent(
      eventId, cmd.tenant_id, cmd.case_id,
      'CLAIM_AMENDED', payload,
      cmd.actor_id, cmd.actor_role,
      cmd.correlation_id, cmd.causation_id,
      now,
    );

    this.applyEvent(event);
    this.uncommittedEvents.push(event);
  }

  /**
   * Change claim status.
   */
  changeClaimStatus(cmd: ChangeClaimStatusCommand): void {
    const claim = this.claims.get(cmd.claim_id);
    if (!claim) {
      throw new Error(`Claim ${cmd.claim_id} not found`);
    }

    // Validate status transition
    const validTransitions: Record<ClaimStatus, ClaimStatus[]> = {
      draft: ['reviewed', 'cancelled'],
      reviewed: ['filed', 'draft', 'cancelled'],
      filed: ['amended', 'cancelled'],
      amended: ['reviewed', 'cancelled'],
      cancelled: [],
    };

    const allowed = validTransitions[claim.status];
    if (!allowed.includes(cmd.to_status)) {
      throw new Error(
        `Invalid claim status transition: ${claim.status} → ${cmd.to_status}`,
      );
    }

    const eventId = ulid();
    const now = new Date().toISOString();

    const event = this.buildEvent(
      eventId, cmd.tenant_id, cmd.case_id,
      'CLAIM_STATUS_CHANGED', {
        claim_id: cmd.claim_id,
        from_status: claim.status,
        to_status: cmd.to_status,
      },
      cmd.actor_id, cmd.actor_role,
      cmd.correlation_id, cmd.causation_id,
      now,
    );

    this.applyEvent(event);
    this.uncommittedEvents.push(event);
  }

  // ─── Event Application ──────────────────────────────────────────

  private applyEvent(event: DomainEvent): void {
    switch (event.event_type) {
      case 'CLAIM_CREATED':
        this.applyClaimCreated(event);
        break;
      case 'CLAIM_AMENDED':
        this.applyClaimAmended(event);
        break;
      case 'CLAIM_STATUS_CHANGED':
        this.applyClaimStatusChanged(event);
        break;
    }
  }

  private applyClaimCreated(event: DomainEvent): void {
    const p = event.payload as ClaimCreatedPayload;
    const claim: Claim = {
      claim_id: p.claim_id,
      case_id: event.case_id as CaseId,
      tenant_id: event.tenant_id as TenantId,
      version: 1,
      claim_number: p.claim_number,
      claim_type: p.claim_type,
      claim_category: p.claim_category,
      depends_on_claim_id: p.depends_on_claim_id,
      claim_text: p.claim_text,
      status: 'draft',
      breadth_score: null,
      ai_generated: p.ai_generated,
      created_by_actor_id: event.actor_id as ActorId,
      created_at: event.timestamp,
    };
    this.claims.set(p.claim_id, claim);
  }

  private applyClaimAmended(event: DomainEvent): void {
    const p = event.payload as ClaimAmendedPayload;
    const claim = this.claims.get(p.claim_id);
    if (claim) {
      claim.version = p.new_version;
      claim.claim_text = p.new_text;
      claim.status = 'amended';
    }
  }

  private applyClaimStatusChanged(event: DomainEvent): void {
    const p = event.payload as { claim_id: ClaimId; from_status: ClaimStatus; to_status: ClaimStatus };
    const claim = this.claims.get(p.claim_id);
    if (claim) {
      claim.status = p.to_status;
    }
  }

  // ─── Helpers ────────────────────────────────────────────────────

  private buildEvent(
    eventId: string,
    tenantId: TenantId,
    caseId: CaseId,
    eventType: string,
    payload: unknown,
    actorId: ActorId,
    actorRole: ActorRole,
    correlationId: CorrelationId,
    causationId: CausationId,
    timestamp: string,
  ): DomainEvent {
    return {
      event_id: eventId,
      tenant_id: tenantId,
      case_id: caseId,
      event_type: eventType,
      actor_id: actorId,
      actor_role: actorRole,
      correlation_id: correlationId,
      causation_id: causationId,
      timestamp,
      previous_hash: '',
      new_hash: '',
      payload,
      metadata: {},
    } as DomainEvent;
  }
}

/**
 * Simple diff: line-based comparison for amendment tracking.
 */
function computeSimpleDiff(oldText: string, newText: string): string {
  const oldLines = oldText.split('\n');
  const newLines = newText.split('\n');
  const diffs: string[] = [];

  const maxLen = Math.max(oldLines.length, newLines.length);
  for (let i = 0; i < maxLen; i++) {
    if (i >= oldLines.length) {
      diffs.push(`+ ${newLines[i]}`);
    } else if (i >= newLines.length) {
      diffs.push(`- ${oldLines[i]}`);
    } else if (oldLines[i] !== newLines[i]) {
      diffs.push(`- ${oldLines[i]}`);
      diffs.push(`+ ${newLines[i]}`);
    }
  }

  return diffs.join('\n');
}
