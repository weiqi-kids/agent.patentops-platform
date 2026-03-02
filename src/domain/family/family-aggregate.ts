/**
 * Patent Family Aggregate — Domain Logic
 *
 * Manages patent family relationships (continuations, divisionals, CIPs, etc.)
 * with bidirectional link enforcement and priority date validation.
 *
 * CLAUDE.md: "Family links must be bidirectional; priority dates validated
 * against parent filing dates."
 */

import { ulid } from 'ulid';
import type {
  CaseId,
  TenantId,
  ActorId,
  ActorRole,
  CorrelationId,
  CausationId,
  PatentFamilyId,
  FamilyRelationshipType,
  PatentFamilyLink,
} from '../../shared/types/index.js';
import type { DomainEvent } from '../../shared/events/index.js';

// ─── Commands ─────────────────────────────────────────────────────

export interface LinkFamilyCommand {
  tenant_id: TenantId;
  parent_case_id: CaseId;
  child_case_id: CaseId;
  relationship_type: FamilyRelationshipType;
  priority_date: string;
  parent_filing_date: string | null;
  actor_id: ActorId;
  actor_role: ActorRole;
  correlation_id: CorrelationId;
  causation_id: CausationId;
}

export interface UnlinkFamilyCommand {
  tenant_id: TenantId;
  parent_case_id: CaseId;
  child_case_id: CaseId;
  reason: string;
  actor_id: ActorId;
  actor_role: ActorRole;
  correlation_id: CorrelationId;
  causation_id: CausationId;
}

export interface RecordPriorityClaimCommand {
  tenant_id: TenantId;
  claiming_case_id: CaseId;
  parent_case_id: CaseId;
  priority_date: string;
  basis: string;
  parent_filing_date: string | null;
  actor_id: ActorId;
  actor_role: ActorRole;
  correlation_id: CorrelationId;
  causation_id: CausationId;
}

// ─── Validation ──────────────────────────────────────────────────

export interface FamilyValidationResult {
  valid: boolean;
  errors: string[];
}

/**
 * Validate that the priority date is consistent with the parent filing date.
 * The priority date should match the parent's filing date (the child claims
 * priority from the parent's filing).
 */
export function validatePriorityDate(
  priorityDate: string,
  parentFilingDate: string | null,
): FamilyValidationResult {
  const errors: string[] = [];

  if (!parentFilingDate) {
    // Cannot fully validate without parent filing date
    return { valid: true, errors: [] };
  }

  const priority = new Date(priorityDate);
  const parentFiling = new Date(parentFilingDate);

  if (isNaN(priority.getTime())) {
    errors.push('Invalid priority date format');
  }
  if (isNaN(parentFiling.getTime())) {
    errors.push('Invalid parent filing date format');
  }

  if (errors.length > 0) {
    return { valid: false, errors };
  }

  // Priority date should not be before parent filing date
  if (priority.getTime() < parentFiling.getTime()) {
    errors.push(
      `Priority date (${priorityDate}) cannot be before parent filing date (${parentFilingDate})`,
    );
  }

  // Check Paris Convention 12-month limit for patents (generic check)
  const monthsDiff =
    (priority.getTime() - parentFiling.getTime()) / (1000 * 60 * 60 * 24 * 30);
  if (monthsDiff > 12) {
    errors.push(
      `Priority date (${priorityDate}) is more than 12 months after parent filing date (${parentFilingDate}). Priority claim may be invalid.`,
    );
  }

  return { valid: errors.length === 0, errors };
}

// ─── Family Aggregate ─────────────────────────────────────────────

export class FamilyAggregate {
  private links: Map<string, PatentFamilyLink> = new Map();
  private uncommittedEvents: DomainEvent[] = [];

  get currentLinks(): PatentFamilyLink[] {
    return Array.from(this.links.values());
  }

  get pendingEvents(): DomainEvent[] {
    return [...this.uncommittedEvents];
  }

  clearPendingEvents(): void {
    this.uncommittedEvents = [];
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
   * Link two cases as parent-child within a patent family.
   * Validates priority date against parent filing date.
   * Enforces no duplicate links.
   */
  linkFamily(cmd: LinkFamilyCommand): void {
    if (cmd.parent_case_id === cmd.child_case_id) {
      throw new Error('Cannot link a case to itself');
    }

    // Check for duplicate bidirectional link
    const existingLink = this.findLink(cmd.parent_case_id, cmd.child_case_id);
    if (existingLink) {
      throw new Error(
        `Family link already exists between ${cmd.parent_case_id} and ${cmd.child_case_id}`,
      );
    }

    // Validate priority date
    const validation = validatePriorityDate(cmd.priority_date, cmd.parent_filing_date);
    if (!validation.valid) {
      throw new Error(`Priority date validation failed: ${validation.errors.join('; ')}`);
    }

    // Determine family_id: use existing family or create new
    const familyId = this.findExistingFamilyId(cmd.parent_case_id, cmd.child_case_id)
      ?? (ulid() as PatentFamilyId);

    const eventId = ulid();
    const now = new Date().toISOString();

    const event = this.buildEvent(
      eventId,
      cmd.tenant_id,
      cmd.parent_case_id, // Store event on parent case
      'PATENT_FAMILY_LINKED',
      {
        family_id: familyId,
        parent_case_id: cmd.parent_case_id,
        child_case_id: cmd.child_case_id,
        relationship_type: cmd.relationship_type,
        priority_date: cmd.priority_date,
      },
      cmd.actor_id,
      cmd.actor_role,
      cmd.correlation_id,
      cmd.causation_id,
      now,
    );

    this.applyEvent(event);
    this.uncommittedEvents.push(event);
  }

  /**
   * Remove a family link between two cases.
   */
  unlinkFamily(cmd: UnlinkFamilyCommand): void {
    const link = this.findLink(cmd.parent_case_id, cmd.child_case_id);
    if (!link) {
      throw new Error(
        `No family link found between ${cmd.parent_case_id} and ${cmd.child_case_id}`,
      );
    }

    const eventId = ulid();
    const now = new Date().toISOString();

    const event = this.buildEvent(
      eventId,
      cmd.tenant_id,
      cmd.parent_case_id,
      'PATENT_FAMILY_UNLINKED',
      {
        family_id: link.family_id,
        parent_case_id: cmd.parent_case_id,
        child_case_id: cmd.child_case_id,
        reason: cmd.reason,
      },
      cmd.actor_id,
      cmd.actor_role,
      cmd.correlation_id,
      cmd.causation_id,
      now,
    );

    this.applyEvent(event);
    this.uncommittedEvents.push(event);
  }

  /**
   * Record a priority claim from one case to another.
   * Emits a PRIORITY_CLAIM_RECORDED event after validating dates.
   */
  recordPriorityClaim(cmd: RecordPriorityClaimCommand): void {
    if (cmd.claiming_case_id === cmd.parent_case_id) {
      throw new Error('A case cannot claim priority from itself');
    }

    const validation = validatePriorityDate(cmd.priority_date, cmd.parent_filing_date);
    if (!validation.valid) {
      throw new Error(`Priority date validation failed: ${validation.errors.join('; ')}`);
    }

    const eventId = ulid();
    const now = new Date().toISOString();

    const event = this.buildEvent(
      eventId,
      cmd.tenant_id,
      cmd.claiming_case_id,
      'PRIORITY_CLAIM_RECORDED',
      {
        claiming_case_id: cmd.claiming_case_id,
        parent_case_id: cmd.parent_case_id,
        priority_date: cmd.priority_date,
        basis: cmd.basis,
      },
      cmd.actor_id,
      cmd.actor_role,
      cmd.correlation_id,
      cmd.causation_id,
      now,
    );

    this.uncommittedEvents.push(event);
  }

  /**
   * Check if a case is part of a family (either as parent or child).
   */
  isCaseInFamily(caseId: CaseId): boolean {
    for (const link of this.links.values()) {
      if (link.parent_case_id === caseId || link.child_case_id === caseId) {
        return true;
      }
    }
    return false;
  }

  /**
   * Get all linked cases for a given case (bidirectional).
   */
  getLinkedCases(caseId: CaseId): PatentFamilyLink[] {
    const results: PatentFamilyLink[] = [];
    for (const link of this.links.values()) {
      if (link.parent_case_id === caseId || link.child_case_id === caseId) {
        results.push(link);
      }
    }
    return results;
  }

  // ─── Event Application ──────────────────────────────────────────

  private applyEvent(event: DomainEvent): void {
    switch (event.event_type) {
      case 'PATENT_FAMILY_LINKED':
        this.applyFamilyLinked(event);
        break;
      case 'PATENT_FAMILY_UNLINKED':
        this.applyFamilyUnlinked(event);
        break;
    }
  }

  private applyFamilyLinked(event: DomainEvent): void {
    const p = event.payload as {
      family_id: PatentFamilyId;
      parent_case_id: CaseId;
      child_case_id: CaseId;
      relationship_type: FamilyRelationshipType;
      priority_date: string;
    };

    const linkKey = this.makeLinkKey(p.parent_case_id, p.child_case_id);
    this.links.set(linkKey, {
      family_id: p.family_id,
      tenant_id: event.tenant_id as TenantId,
      parent_case_id: p.parent_case_id,
      child_case_id: p.child_case_id,
      relationship_type: p.relationship_type,
      priority_date: p.priority_date,
      created_at: event.timestamp,
    });
  }

  private applyFamilyUnlinked(event: DomainEvent): void {
    const p = event.payload as {
      parent_case_id: CaseId;
      child_case_id: CaseId;
    };
    const linkKey = this.makeLinkKey(p.parent_case_id, p.child_case_id);
    this.links.delete(linkKey);
  }

  // ─── Helpers ────────────────────────────────────────────────────

  private makeLinkKey(parentId: CaseId, childId: CaseId): string {
    return `${parentId}:${childId}`;
  }

  /**
   * Find a link between two cases (checks both directions for bidirectional enforcement).
   */
  private findLink(caseA: CaseId, caseB: CaseId): PatentFamilyLink | undefined {
    return this.links.get(this.makeLinkKey(caseA, caseB))
      ?? this.links.get(this.makeLinkKey(caseB, caseA));
  }

  /**
   * Find existing family ID from any linked case.
   */
  private findExistingFamilyId(
    parentCaseId: CaseId,
    childCaseId: CaseId,
  ): PatentFamilyId | null {
    for (const link of this.links.values()) {
      if (
        link.parent_case_id === parentCaseId ||
        link.child_case_id === parentCaseId ||
        link.parent_case_id === childCaseId ||
        link.child_case_id === childCaseId
      ) {
        return link.family_id;
      }
    }
    return null;
  }

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
