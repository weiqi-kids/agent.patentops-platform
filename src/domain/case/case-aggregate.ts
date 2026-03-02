/**
 * Case Aggregate — Domain Logic
 *
 * The Case aggregate is the central domain object in the PatentOps platform.
 * It encapsulates all state transitions and business rules for patent cases.
 *
 * Every operation emits one or more events. State is reconstructed by
 * replaying events from the event store.
 */

import { ulid } from 'ulid';
import type {
  CaseId,
  TenantId,
  ActorId,
  CorrelationId,
  CausationId,
  PatentCase,
  PatentType,
  CaseStatus,
  CaseCloseReason,
  ActorRole,
  PatentFamilyId,
} from '../../shared/types/index.js';
import type {
  DomainEvent,
  CaseCreatedPayload,
  CaseStatusChangedPayload,
  FilingReceiptPayload,
  AllowanceReceivedPayload,
  PatentGrantedPayload,
} from '../../shared/events/index.js';
import { validateTransition } from '../../workflow/states/case-state-machine.js';

// ─── Commands ──────────────────────────────────────────────────────

export interface CreateCaseCommand {
  tenant_id: TenantId;
  title: string;
  patent_type: PatentType;
  applicant_id: ActorId;
  inventor_ids: ActorId[];
  assigned_attorney_id: ActorId;
  jurisdiction: string;
  priority_date: string | null;
  parent_case_id: CaseId | null;
  actor_id: ActorId;
  actor_role: ActorRole;
  correlation_id: CorrelationId;
}

export interface ChangeCaseStatusCommand {
  tenant_id: TenantId;
  case_id: CaseId;
  to_state: CaseStatus;
  reason: string | null;
  actor_id: ActorId;
  actor_role: ActorRole;
  correlation_id: CorrelationId;
  causation_id: CausationId;
}

export interface RecordFilingReceiptCommand {
  tenant_id: TenantId;
  case_id: CaseId;
  application_number: string;
  filing_date: string;
  filing_reference: string | null;
  actor_id: ActorId;
  actor_role: ActorRole;
  correlation_id: CorrelationId;
  causation_id: CausationId;
}

export interface RecordAllowanceCommand {
  tenant_id: TenantId;
  case_id: CaseId;
  allowance_date: string;
  issue_fee_due_date: string;
  conditions: string | null;
  actor_id: ActorId;
  actor_role: ActorRole;
  correlation_id: CorrelationId;
  causation_id: CausationId;
}

export interface RecordGrantCommand {
  tenant_id: TenantId;
  case_id: CaseId;
  patent_number: string;
  grant_date: string;
  first_annuity_due_date: string | null;
  actor_id: ActorId;
  actor_role: ActorRole;
  correlation_id: CorrelationId;
  causation_id: CausationId;
}

export interface CloseCaseCommand {
  tenant_id: TenantId;
  case_id: CaseId;
  close_reason: CaseCloseReason;
  actor_id: ActorId;
  actor_role: ActorRole;
  correlation_id: CorrelationId;
  causation_id: CausationId;
}

// ─── Aggregate ─────────────────────────────────────────────────────

export class CaseAggregate {
  private state: PatentCase | null = null;
  private uncommittedEvents: DomainEvent[] = [];

  get currentState(): PatentCase | null {
    return this.state;
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
   * Create a new patent case.
   */
  createCase(cmd: CreateCaseCommand): void {
    if (this.state) {
      throw new Error('Case already exists');
    }

    const caseId = ulid() as CaseId;
    const eventId = ulid();
    const now = new Date().toISOString();

    const payload: CaseCreatedPayload = {
      title: cmd.title,
      patent_type: cmd.patent_type,
      applicant_id: cmd.applicant_id,
      inventor_ids: cmd.inventor_ids,
      assigned_attorney_id: cmd.assigned_attorney_id,
      jurisdiction: cmd.jurisdiction,
      priority_date: cmd.priority_date,
      parent_case_id: cmd.parent_case_id,
    };

    const event = this.buildEvent(
      eventId, cmd.tenant_id, caseId,
      'CASE_CREATED', payload,
      cmd.actor_id, cmd.actor_role,
      cmd.correlation_id, eventId as unknown as CausationId,
      now,
    );

    this.applyEvent(event);
    this.uncommittedEvents.push(event);
  }

  /**
   * Change case status with state machine validation.
   */
  changeStatus(cmd: ChangeCaseStatusCommand): void {
    this.ensureExists();

    const result = validateTransition(
      this.state!.status,
      cmd.to_state,
      cmd.actor_role,
    );

    if (!result.valid) {
      throw new Error(result.error!);
    }

    const eventId = ulid();
    const now = new Date().toISOString();

    const payload: CaseStatusChangedPayload = {
      from_state: this.state!.status,
      to_state: cmd.to_state,
      reason: cmd.reason,
    };

    const event = this.buildEvent(
      eventId, cmd.tenant_id, cmd.case_id,
      'CASE_STATUS_CHANGED', payload,
      cmd.actor_id, cmd.actor_role,
      cmd.correlation_id, cmd.causation_id,
      now,
    );

    this.applyEvent(event);
    this.uncommittedEvents.push(event);
  }

  /**
   * Record filing receipt from patent office.
   */
  recordFilingReceipt(cmd: RecordFilingReceiptCommand): void {
    this.ensureExists();
    this.ensureStatus('FILED', 'FILING');

    const eventId = ulid();
    const now = new Date().toISOString();

    const payload: FilingReceiptPayload = {
      application_number: cmd.application_number,
      filing_date: cmd.filing_date,
      filing_reference: cmd.filing_reference,
    };

    const event = this.buildEvent(
      eventId, cmd.tenant_id, cmd.case_id,
      'FILING_RECEIPT_RECORDED', payload,
      cmd.actor_id, cmd.actor_role,
      cmd.correlation_id, cmd.causation_id,
      now,
    );

    this.applyEvent(event);
    this.uncommittedEvents.push(event);
  }

  /**
   * Record notice of allowance.
   */
  recordAllowance(cmd: RecordAllowanceCommand): void {
    this.ensureExists();
    this.ensureStatus('ALLOWED');

    const eventId = ulid();
    const now = new Date().toISOString();

    const payload: AllowanceReceivedPayload = {
      allowance_date: cmd.allowance_date,
      issue_fee_due_date: cmd.issue_fee_due_date,
      conditions: cmd.conditions,
    };

    const event = this.buildEvent(
      eventId, cmd.tenant_id, cmd.case_id,
      'ALLOWANCE_RECEIVED', payload,
      cmd.actor_id, cmd.actor_role,
      cmd.correlation_id, cmd.causation_id,
      now,
    );

    this.applyEvent(event);
    this.uncommittedEvents.push(event);
  }

  /**
   * Record patent grant.
   */
  recordGrant(cmd: RecordGrantCommand): void {
    this.ensureExists();
    this.ensureStatus('GRANTED');

    const eventId = ulid();
    const now = new Date().toISOString();

    const payload: PatentGrantedPayload = {
      patent_number: cmd.patent_number,
      grant_date: cmd.grant_date,
      first_annuity_due_date: cmd.first_annuity_due_date,
    };

    const event = this.buildEvent(
      eventId, cmd.tenant_id, cmd.case_id,
      'PATENT_GRANTED', payload,
      cmd.actor_id, cmd.actor_role,
      cmd.correlation_id, cmd.causation_id,
      now,
    );

    this.applyEvent(event);
    this.uncommittedEvents.push(event);
  }

  /**
   * Close case with reason.
   */
  closeCase(cmd: CloseCaseCommand): void {
    this.ensureExists();

    const result = validateTransition(
      this.state!.status,
      'CLOSED',
      cmd.actor_role,
    );

    if (!result.valid) {
      throw new Error(result.error!);
    }

    const eventId = ulid();
    const now = new Date().toISOString();

    const event = this.buildEvent(
      eventId, cmd.tenant_id, cmd.case_id,
      'CASE_CLOSED', {
        from_state: this.state!.status,
        close_reason: cmd.close_reason,
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
      case 'CASE_CREATED':
        this.applyCaseCreated(event);
        break;
      case 'CASE_STATUS_CHANGED':
        this.applyCaseStatusChanged(event);
        break;
      case 'CASE_CLOSED':
        this.applyCaseClosed(event);
        break;
      case 'FILING_RECEIPT_RECORDED':
        this.applyFilingReceipt(event);
        break;
      case 'ALLOWANCE_RECEIVED':
        this.applyAllowance(event);
        break;
      case 'PATENT_GRANTED':
        this.applyPatentGranted(event);
        break;
    }
  }

  private applyCaseCreated(event: DomainEvent): void {
    const p = event.payload as CaseCreatedPayload;
    this.state = {
      case_id: event.case_id as CaseId,
      tenant_id: event.tenant_id as TenantId,
      case_number: null,
      patent_type: p.patent_type,
      title: p.title,
      status: 'INTAKE',
      applicant_id: p.applicant_id,
      inventor_ids: p.inventor_ids,
      assigned_attorney_id: p.assigned_attorney_id,
      assigned_associate_id: null,
      assigned_paralegal_id: null,
      foreign_associate_id: null,
      jurisdiction: p.jurisdiction,
      filing_date: null,
      priority_date: p.priority_date,
      application_number: null,
      patent_number: null,
      grant_date: null,
      examination_requested_date: null,
      parent_case_id: p.parent_case_id,
      family_id: null,
      current_version: 1,
      close_reason: null,
      created_at: event.timestamp,
    };
  }

  private applyCaseStatusChanged(event: DomainEvent): void {
    const p = event.payload as CaseStatusChangedPayload;
    this.state!.status = p.to_state;
    this.state!.current_version++;
  }

  private applyCaseClosed(event: DomainEvent): void {
    const p = event.payload as { from_state: CaseStatus; close_reason: CaseCloseReason };
    this.state!.status = 'CLOSED';
    this.state!.close_reason = p.close_reason;
    this.state!.current_version++;
  }

  private applyFilingReceipt(event: DomainEvent): void {
    const p = event.payload as FilingReceiptPayload;
    this.state!.application_number = p.application_number;
    this.state!.filing_date = p.filing_date;
    this.state!.current_version++;
  }

  private applyAllowance(event: DomainEvent): void {
    this.state!.current_version++;
  }

  private applyPatentGranted(event: DomainEvent): void {
    const p = event.payload as PatentGrantedPayload;
    this.state!.patent_number = p.patent_number;
    this.state!.grant_date = p.grant_date;
    this.state!.current_version++;
  }

  // ─── Helpers ────────────────────────────────────────────────────

  private ensureExists(): void {
    if (!this.state) {
      throw new Error('Case does not exist');
    }
  }

  private ensureStatus(...allowed: CaseStatus[]): void {
    if (!allowed.includes(this.state!.status)) {
      throw new Error(
        `Case is in status '${this.state!.status}', expected one of: ${allowed.join(', ')}`,
      );
    }
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
