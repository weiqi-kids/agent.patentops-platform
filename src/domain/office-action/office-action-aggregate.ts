/**
 * Office Action Aggregate — Domain Logic
 *
 * Manages the OA response sub-workflow as a domain aggregate.
 * Each OfficeAction has its own lifecycle:
 *   RECEIVED → ANALYZING → STRATEGIZING → AMENDING → REVIEW → FILED
 *
 * State is reconstructed by replaying OA-related events from the event store.
 */

import { ulid } from 'ulid';
import type {
  CaseId,
  TenantId,
  ActorId,
  ActorRole,
  CorrelationId,
  CausationId,
  OfficeActionId,
  OfficeActionStatus,
  OfficeActionCategory,
  RejectionBasis,
  RiskRating,
  CitedReference,
  ClaimId,
  DocumentId,
} from '../../shared/types/index.js';
import type {
  DomainEvent,
  OaReceivedPayload,
  OaAnalysisCompletedPayload,
} from '../../shared/events/index.js';
import { validateOaTransition } from '../../workflow/states/oa-response-state-machine.js';

// ─── OA State ──────────────────────────────────────────────────────

export interface OfficeActionState {
  oa_id: OfficeActionId;
  case_id: CaseId;
  tenant_id: TenantId;
  oa_category: OfficeActionCategory;
  oa_type_label: string;
  mailing_date: string;
  received_date: string;
  response_deadline: string;
  rejection_bases: RejectionBasis[];
  statutory_references: string[];
  cited_references: CitedReference[];
  sequence_number: number;
  status: OfficeActionStatus;
  risk_rating: RiskRating | null;
  selected_strategy_id: string | null;
  amendment_claim_ids: ClaimId[];
  review_approved: boolean | null;
  filed_document_id: DocumentId | null;
  filed_hash: string | null;
  created_at: string;
}

// ─── Commands ─────────────────────────────────────────────────────

export interface ReceiveOaCommand {
  tenant_id: TenantId;
  case_id: CaseId;
  oa_category: OfficeActionCategory;
  oa_type_label: string;
  mailing_date: string;
  received_date: string;
  response_deadline: string;
  rejection_bases: RejectionBasis[];
  statutory_references: string[];
  cited_references: CitedReference[];
  sequence_number: number;
  actor_id: ActorId;
  actor_role: ActorRole;
  correlation_id: CorrelationId;
  causation_id: CausationId;
}

export interface TransitionOaStatusCommand {
  tenant_id: TenantId;
  case_id: CaseId;
  oa_id: OfficeActionId;
  to_status: OfficeActionStatus;
  actor_id: ActorId;
  actor_role: ActorRole;
  correlation_id: CorrelationId;
  causation_id: CausationId;
}

export interface RecordAnalysisCommand {
  tenant_id: TenantId;
  case_id: CaseId;
  oa_id: OfficeActionId;
  rejection_classification: string;
  claim_limitation_mapping: Record<string, string[]>;
  amendment_strategies: Array<{
    strategy_id: string;
    description: string;
    risk_rating: RiskRating;
    reasoning: string;
  }>;
  ai_model_used: string;
  actor_id: ActorId;
  actor_role: ActorRole;
  correlation_id: CorrelationId;
  causation_id: CausationId;
}

export interface SelectStrategyCommand {
  tenant_id: TenantId;
  case_id: CaseId;
  oa_id: OfficeActionId;
  selected_strategy_id: string;
  actor_id: ActorId;
  actor_role: ActorRole;
  correlation_id: CorrelationId;
  causation_id: CausationId;
}

export interface RecordAmendmentDraftCommand {
  tenant_id: TenantId;
  case_id: CaseId;
  oa_id: OfficeActionId;
  claim_ids: ClaimId[];
  ai_assisted: boolean;
  actor_id: ActorId;
  actor_role: ActorRole;
  correlation_id: CorrelationId;
  causation_id: CausationId;
}

export interface RecordReviewCommand {
  tenant_id: TenantId;
  case_id: CaseId;
  oa_id: OfficeActionId;
  approved: boolean;
  comments: string | null;
  actor_id: ActorId;
  actor_role: ActorRole;
  correlation_id: CorrelationId;
  causation_id: CausationId;
}

export interface FileOaResponseCommand {
  tenant_id: TenantId;
  case_id: CaseId;
  oa_id: OfficeActionId;
  document_id: DocumentId;
  filed_hash: string;
  actor_id: ActorId;
  actor_role: ActorRole;
  correlation_id: CorrelationId;
  causation_id: CausationId;
}

// ─── Office Action Aggregate ──────────────────────────────────────

export class OfficeActionAggregate {
  private state: OfficeActionState | null = null;
  private uncommittedEvents: DomainEvent[] = [];

  get currentState(): OfficeActionState | null {
    return this.state;
  }

  get pendingEvents(): DomainEvent[] {
    return [...this.uncommittedEvents];
  }

  clearPendingEvents(): void {
    this.uncommittedEvents = [];
  }

  /**
   * Reconstruct state from event history (filtered to this OA).
   */
  loadFromHistory(events: DomainEvent[]): void {
    for (const event of events) {
      this.applyEvent(event);
    }
  }

  /**
   * Receive a new office action.
   */
  receiveOa(cmd: ReceiveOaCommand): void {
    if (this.state) {
      throw new Error('Office action already exists in this aggregate');
    }

    const oaId = ulid() as OfficeActionId;
    const eventId = ulid();
    const now = new Date().toISOString();

    const payload: OaReceivedPayload = {
      oa_id: oaId,
      oa_category: cmd.oa_category,
      oa_type_label: cmd.oa_type_label,
      mailing_date: cmd.mailing_date,
      received_date: cmd.received_date,
      response_deadline: cmd.response_deadline,
      rejection_bases: cmd.rejection_bases,
      statutory_references: cmd.statutory_references,
      cited_references: cmd.cited_references,
      sequence_number: cmd.sequence_number,
    };

    const event = this.buildEvent(
      eventId, cmd.tenant_id, cmd.case_id,
      'OA_RECEIVED', payload,
      cmd.actor_id, cmd.actor_role,
      cmd.correlation_id, cmd.causation_id, now,
    );

    this.applyEvent(event);
    this.uncommittedEvents.push(event);
  }

  /**
   * Transition OA status using the OA response state machine.
   */
  transitionStatus(cmd: TransitionOaStatusCommand): void {
    this.ensureExists();
    this.ensureOaId(cmd.oa_id);

    const result = validateOaTransition(
      this.state!.status,
      cmd.to_status,
      cmd.actor_role,
    );

    if (!result.valid) {
      throw new Error(result.error!);
    }

    const eventId = ulid();
    const now = new Date().toISOString();

    const event = this.buildEvent(
      eventId, cmd.tenant_id, cmd.case_id,
      'OA_CLASSIFIED',
      {
        oa_id: cmd.oa_id,
        from_status: this.state!.status,
        to_status: cmd.to_status,
      },
      cmd.actor_id, cmd.actor_role,
      cmd.correlation_id, cmd.causation_id, now,
    );

    this.applyEvent(event);
    this.uncommittedEvents.push(event);
  }

  /**
   * Record AI analysis completion.
   */
  recordAnalysis(cmd: RecordAnalysisCommand): void {
    this.ensureExists();
    this.ensureOaId(cmd.oa_id);
    this.ensureStatus('analyzing');

    const eventId = ulid();
    const now = new Date().toISOString();

    const payload: OaAnalysisCompletedPayload = {
      oa_id: cmd.oa_id,
      rejection_classification: cmd.rejection_classification,
      claim_limitation_mapping: cmd.claim_limitation_mapping,
      amendment_strategies: cmd.amendment_strategies,
      ai_model_used: cmd.ai_model_used,
    };

    const event = this.buildEvent(
      eventId, cmd.tenant_id, cmd.case_id,
      'OA_ANALYSIS_COMPLETED', payload,
      cmd.actor_id, cmd.actor_role,
      cmd.correlation_id, cmd.causation_id, now,
    );

    this.applyEvent(event);
    this.uncommittedEvents.push(event);
  }

  /**
   * Select an amendment strategy (attorney decision).
   */
  selectStrategy(cmd: SelectStrategyCommand): void {
    this.ensureExists();
    this.ensureOaId(cmd.oa_id);
    this.ensureStatus('strategizing');

    const eventId = ulid();
    const now = new Date().toISOString();

    const event = this.buildEvent(
      eventId, cmd.tenant_id, cmd.case_id,
      'OA_STRATEGY_SELECTED',
      {
        oa_id: cmd.oa_id,
        selected_strategy_id: cmd.selected_strategy_id,
        selected_by: cmd.actor_id,
      },
      cmd.actor_id, cmd.actor_role,
      cmd.correlation_id, cmd.causation_id, now,
    );

    this.applyEvent(event);
    this.uncommittedEvents.push(event);
  }

  /**
   * Record that amendments have been drafted.
   */
  recordAmendmentDraft(cmd: RecordAmendmentDraftCommand): void {
    this.ensureExists();
    this.ensureOaId(cmd.oa_id);
    this.ensureStatus('amending');

    const eventId = ulid();
    const now = new Date().toISOString();

    const event = this.buildEvent(
      eventId, cmd.tenant_id, cmd.case_id,
      'OA_AMENDMENT_DRAFTED',
      {
        oa_id: cmd.oa_id,
        claim_ids: cmd.claim_ids,
        ai_assisted: cmd.ai_assisted,
      },
      cmd.actor_id, cmd.actor_role,
      cmd.correlation_id, cmd.causation_id, now,
    );

    this.applyEvent(event);
    this.uncommittedEvents.push(event);
  }

  /**
   * Record review decision for the OA response.
   */
  recordReview(cmd: RecordReviewCommand): void {
    this.ensureExists();
    this.ensureOaId(cmd.oa_id);
    this.ensureStatus('review');

    const eventId = ulid();
    const now = new Date().toISOString();

    const event = this.buildEvent(
      eventId, cmd.tenant_id, cmd.case_id,
      'OA_RESPONSE_REVIEWED',
      {
        oa_id: cmd.oa_id,
        reviewed_by: cmd.actor_id,
        approved: cmd.approved,
        comments: cmd.comments,
      },
      cmd.actor_id, cmd.actor_role,
      cmd.correlation_id, cmd.causation_id, now,
    );

    this.applyEvent(event);
    this.uncommittedEvents.push(event);
  }

  /**
   * File the OA response (final step, mandatory human review).
   */
  fileResponse(cmd: FileOaResponseCommand): void {
    this.ensureExists();
    this.ensureOaId(cmd.oa_id);

    // Must be in review status and approved
    if (this.state!.status !== 'review') {
      throw new Error(`Cannot file response: OA is in status '${this.state!.status}', expected 'review'`);
    }

    const result = validateOaTransition(
      this.state!.status,
      'filed',
      cmd.actor_role,
    );
    if (!result.valid) {
      throw new Error(result.error!);
    }

    const eventId = ulid();
    const now = new Date().toISOString();

    const event = this.buildEvent(
      eventId, cmd.tenant_id, cmd.case_id,
      'OA_RESPONSE_FILED',
      {
        oa_id: cmd.oa_id,
        document_id: cmd.document_id,
        filed_hash: cmd.filed_hash,
      },
      cmd.actor_id, cmd.actor_role,
      cmd.correlation_id, cmd.causation_id, now,
    );

    this.applyEvent(event);
    this.uncommittedEvents.push(event);
  }

  // ─── Event Application ──────────────────────────────────────────

  private applyEvent(event: DomainEvent): void {
    switch (event.event_type) {
      case 'OA_RECEIVED':
        this.applyOaReceived(event);
        break;
      case 'OA_CLASSIFIED':
        this.applyOaClassified(event);
        break;
      case 'OA_ANALYSIS_COMPLETED':
        this.applyAnalysisCompleted(event);
        break;
      case 'OA_STRATEGY_SELECTED':
        this.applyStrategySelected(event);
        break;
      case 'OA_AMENDMENT_DRAFTED':
        this.applyAmendmentDrafted(event);
        break;
      case 'OA_RESPONSE_REVIEWED':
        this.applyResponseReviewed(event);
        break;
      case 'OA_RESPONSE_FILED':
        this.applyResponseFiled(event);
        break;
    }
  }

  private applyOaReceived(event: DomainEvent): void {
    const p = event.payload as OaReceivedPayload;
    this.state = {
      oa_id: p.oa_id,
      case_id: event.case_id as CaseId,
      tenant_id: event.tenant_id as TenantId,
      oa_category: p.oa_category,
      oa_type_label: p.oa_type_label,
      mailing_date: p.mailing_date,
      received_date: p.received_date,
      response_deadline: p.response_deadline,
      rejection_bases: p.rejection_bases,
      statutory_references: p.statutory_references,
      cited_references: p.cited_references,
      sequence_number: p.sequence_number,
      status: 'received',
      risk_rating: null,
      selected_strategy_id: null,
      amendment_claim_ids: [],
      review_approved: null,
      filed_document_id: null,
      filed_hash: null,
      created_at: event.timestamp,
    };
  }

  private applyOaClassified(event: DomainEvent): void {
    const p = event.payload as { to_status: OfficeActionStatus };
    this.state!.status = p.to_status;
  }

  private applyAnalysisCompleted(event: DomainEvent): void {
    const p = event.payload as OaAnalysisCompletedPayload;
    // Derive risk from strategies
    if (p.amendment_strategies.length > 0) {
      this.state!.risk_rating = p.amendment_strategies[0].risk_rating;
    }
  }

  private applyStrategySelected(event: DomainEvent): void {
    const p = event.payload as { selected_strategy_id: string };
    this.state!.selected_strategy_id = p.selected_strategy_id;
  }

  private applyAmendmentDrafted(event: DomainEvent): void {
    const p = event.payload as { claim_ids: ClaimId[] };
    this.state!.amendment_claim_ids = p.claim_ids;
  }

  private applyResponseReviewed(event: DomainEvent): void {
    const p = event.payload as { approved: boolean };
    this.state!.review_approved = p.approved;
  }

  private applyResponseFiled(event: DomainEvent): void {
    const p = event.payload as { document_id: DocumentId; filed_hash: string };
    this.state!.status = 'filed';
    this.state!.filed_document_id = p.document_id;
    this.state!.filed_hash = p.filed_hash;
  }

  // ─── Helpers ────────────────────────────────────────────────────

  private ensureExists(): void {
    if (!this.state) {
      throw new Error('Office action does not exist');
    }
  }

  private ensureOaId(oaId: OfficeActionId): void {
    if (this.state!.oa_id !== oaId) {
      throw new Error(`OA ID mismatch: expected ${this.state!.oa_id}, got ${oaId}`);
    }
  }

  private ensureStatus(...allowed: OfficeActionStatus[]): void {
    if (!allowed.includes(this.state!.status)) {
      throw new Error(
        `OA is in status '${this.state!.status}', expected one of: ${allowed.join(', ')}`,
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
