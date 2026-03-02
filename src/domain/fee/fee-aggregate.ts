/**
 * Fee Aggregate — Domain Logic
 *
 * Manages fees for patent cases: creation, payment, waiver, and
 * late surcharge application. Each fee has its own lifecycle:
 *   PENDING → PAID | WAIVED | OVERDUE
 *
 * Grace period and late surcharge are jurisdiction-specific values
 * injected at fee creation time.
 */

import { ulid } from 'ulid';
import type {
  CaseId,
  TenantId,
  ActorId,
  ActorRole,
  CorrelationId,
  CausationId,
  FeeId,
  FeeType,
  FeeStatus,
  DeadlineId,
} from '../../shared/types/index.js';
import type { DomainEvent } from '../../shared/events/index.js';

// ─── Fee State ────────────────────────────────────────────────────

export interface FeeState {
  fee_id: FeeId;
  case_id: CaseId;
  tenant_id: TenantId;
  fee_type: FeeType;
  fee_label: string;
  amount: number;
  currency: string;
  due_date: string;
  grace_period_end: string | null;
  late_surcharge_amount: number | null;
  status: FeeStatus;
  paid_at: string | null;
  payment_reference: string | null;
  waived_by: ActorId | null;
  waive_reason: string | null;
  deadline_id: DeadlineId | null;
  created_at: string;
}

// ─── Commands ─────────────────────────────────────────────────────

export interface CreateFeeCommand {
  tenant_id: TenantId;
  case_id: CaseId;
  fee_type: FeeType;
  fee_label: string;
  amount: number;
  currency: string;
  due_date: string;
  grace_period_end: string | null;
  late_surcharge_amount: number | null;
  deadline_id: DeadlineId | null;
  actor_id: ActorId;
  actor_role: ActorRole;
  correlation_id: CorrelationId;
  causation_id: CausationId;
}

export interface RecordPaymentCommand {
  tenant_id: TenantId;
  case_id: CaseId;
  fee_id: FeeId;
  payment_reference: string;
  paid_at: string;
  actor_id: ActorId;
  actor_role: ActorRole;
  correlation_id: CorrelationId;
  causation_id: CausationId;
}

export interface WaiveFeeCommand {
  tenant_id: TenantId;
  case_id: CaseId;
  fee_id: FeeId;
  reason: string;
  actor_id: ActorId;
  actor_role: ActorRole;
  correlation_id: CorrelationId;
  causation_id: CausationId;
}

// ─── Fee Aggregate ─────────────────────────────────────────────────

export class FeeAggregate {
  private state: FeeState | null = null;
  private uncommittedEvents: DomainEvent[] = [];

  get currentState(): FeeState | null {
    return this.state;
  }

  get pendingEvents(): DomainEvent[] {
    return [...this.uncommittedEvents];
  }

  clearPendingEvents(): void {
    this.uncommittedEvents = [];
  }

  /**
   * Reconstruct state from event history (filtered to this fee).
   */
  loadFromHistory(events: DomainEvent[]): void {
    for (const event of events) {
      this.applyEvent(event);
    }
  }

  /**
   * Create a new fee for a case.
   */
  createFee(cmd: CreateFeeCommand): void {
    if (this.state) {
      throw new Error('Fee already exists in this aggregate');
    }

    if (cmd.amount <= 0) {
      throw new Error('Fee amount must be positive');
    }

    const feeId = ulid() as FeeId;
    const eventId = ulid();
    const now = new Date().toISOString();

    const event = this.buildEvent(
      eventId, cmd.tenant_id, cmd.case_id,
      'FEE_CREATED',
      {
        fee_id: feeId,
        fee_type: cmd.fee_type,
        fee_label: cmd.fee_label,
        amount: cmd.amount,
        currency: cmd.currency,
        due_date: cmd.due_date,
        deadline_id: cmd.deadline_id,
      },
      cmd.actor_id, cmd.actor_role,
      cmd.correlation_id, cmd.causation_id, now,
    );

    this.applyEvent(event);
    this.uncommittedEvents.push(event);

    // Store grace period and surcharge in state (not in event — these are fee-level metadata)
    this.state!.grace_period_end = cmd.grace_period_end;
    this.state!.late_surcharge_amount = cmd.late_surcharge_amount;
  }

  /**
   * Record a payment for this fee.
   */
  recordPayment(cmd: RecordPaymentCommand): void {
    this.ensureExists();
    this.ensureFeeId(cmd.fee_id);

    if (this.state!.status === 'paid') {
      throw new Error('Fee has already been paid');
    }
    if (this.state!.status === 'waived') {
      throw new Error('Fee has been waived and cannot be paid');
    }

    const eventId = ulid();
    const now = new Date().toISOString();

    const event = this.buildEvent(
      eventId, cmd.tenant_id, cmd.case_id,
      'FEE_PAYMENT_RECORDED',
      {
        fee_id: cmd.fee_id,
        fee_type: this.state!.fee_type,
        amount: this.state!.amount,
        currency: this.state!.currency,
        payment_reference: cmd.payment_reference,
        paid_at: cmd.paid_at,
      },
      cmd.actor_id, cmd.actor_role,
      cmd.correlation_id, cmd.causation_id, now,
    );

    this.applyEvent(event);
    this.uncommittedEvents.push(event);
  }

  /**
   * Waive a fee.
   */
  waiveFee(cmd: WaiveFeeCommand): void {
    this.ensureExists();
    this.ensureFeeId(cmd.fee_id);

    if (this.state!.status === 'paid') {
      throw new Error('Fee has already been paid and cannot be waived');
    }
    if (this.state!.status === 'waived') {
      throw new Error('Fee has already been waived');
    }

    const eventId = ulid();
    const now = new Date().toISOString();

    const event = this.buildEvent(
      eventId, cmd.tenant_id, cmd.case_id,
      'FEE_WAIVED',
      {
        fee_id: cmd.fee_id,
        fee_type: this.state!.fee_type,
        waived_by: cmd.actor_id,
        reason: cmd.reason,
      },
      cmd.actor_id, cmd.actor_role,
      cmd.correlation_id, cmd.causation_id, now,
    );

    this.applyEvent(event);
    this.uncommittedEvents.push(event);
  }

  /**
   * Check if the fee is overdue (past due date and not yet paid/waived).
   */
  isOverdue(now: Date = new Date()): boolean {
    if (!this.state) return false;
    if (this.state.status !== 'pending') return false;
    return now > new Date(this.state.due_date);
  }

  /**
   * Check if the fee is within the grace period.
   */
  isInGracePeriod(now: Date = new Date()): boolean {
    if (!this.state) return false;
    if (!this.state.grace_period_end) return false;
    if (this.state.status !== 'pending') return false;
    const dueDate = new Date(this.state.due_date);
    const graceEnd = new Date(this.state.grace_period_end);
    return now > dueDate && now <= graceEnd;
  }

  // ─── Event Application ──────────────────────────────────────────

  private applyEvent(event: DomainEvent): void {
    switch (event.event_type) {
      case 'FEE_CREATED':
        this.applyFeeCreated(event);
        break;
      case 'FEE_PAYMENT_RECORDED':
        this.applyFeePaymentRecorded(event);
        break;
      case 'FEE_WAIVED':
        this.applyFeeWaived(event);
        break;
    }
  }

  private applyFeeCreated(event: DomainEvent): void {
    const p = event.payload as {
      fee_id: FeeId; fee_type: FeeType; fee_label: string;
      amount: number; currency: string; due_date: string;
      deadline_id: DeadlineId | null;
    };
    this.state = {
      fee_id: p.fee_id,
      case_id: event.case_id as CaseId,
      tenant_id: event.tenant_id as TenantId,
      fee_type: p.fee_type,
      fee_label: p.fee_label,
      amount: p.amount,
      currency: p.currency,
      due_date: p.due_date,
      grace_period_end: null,
      late_surcharge_amount: null,
      status: 'pending',
      paid_at: null,
      payment_reference: null,
      waived_by: null,
      waive_reason: null,
      deadline_id: p.deadline_id,
      created_at: event.timestamp,
    };
  }

  private applyFeePaymentRecorded(event: DomainEvent): void {
    const p = event.payload as { paid_at: string; payment_reference: string };
    this.state!.status = 'paid';
    this.state!.paid_at = p.paid_at;
    this.state!.payment_reference = p.payment_reference;
  }

  private applyFeeWaived(event: DomainEvent): void {
    const p = event.payload as { waived_by: ActorId; reason: string };
    this.state!.status = 'waived';
    this.state!.waived_by = p.waived_by;
    this.state!.waive_reason = p.reason;
  }

  // ─── Helpers ────────────────────────────────────────────────────

  private ensureExists(): void {
    if (!this.state) {
      throw new Error('Fee does not exist');
    }
  }

  private ensureFeeId(feeId: FeeId): void {
    if (this.state!.fee_id !== feeId) {
      throw new Error(`Fee ID mismatch: expected ${this.state!.fee_id}, got ${feeId}`);
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
