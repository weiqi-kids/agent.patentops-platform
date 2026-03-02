/**
 * PatentOps Platform — Event Schema Definitions
 *
 * All events are immutable, append-only records.
 * Events are the single source of truth. All database tables are projections.
 */

import type {
  EventId,
  TenantId,
  CaseId,
  ActorId,
  CorrelationId,
  CausationId,
  ActorRole,
  CaseStatus,
  ClaimId,
  ClaimStatus,
  OfficeActionId,
  OfficeActionStatus,
  RejectionType,
  RiskRating,
  DeadlineId,
  DeadlineStatus,
  EscalationLevel,
  ConflictCheckId,
  ConflictResult,
  DocumentId,
  DocumentType,
  DocumentStatus,
  CitedReference,
  PatentFamilyId,
  FamilyRelationshipType,
  FeeId,
  FeeType,
  FeeStatus,
  IdsId,
  IdsStatus,
} from '../types/index.js';

// ─── Event Type Registry ────────────────────────────────────────────

export const EVENT_TYPES = [
  // Case lifecycle
  'CASE_CREATED',
  'CASE_ACCEPTED',
  'CASE_STATUS_CHANGED',
  'CASE_WITHDRAWN',
  'CASE_CLOSED',

  // Claim management
  'CLAIM_CREATED',
  'CLAIM_AMENDED',
  'CLAIM_STATUS_CHANGED',
  'CLAIM_DELETED',

  // Office Action workflow
  'OA_RECEIVED',
  'OA_CLASSIFIED',
  'OA_ANALYSIS_COMPLETED',
  'OA_STRATEGY_SELECTED',
  'OA_AMENDMENT_DRAFTED',
  'OA_RESPONSE_REVIEWED',
  'OA_RESPONSE_FILED',

  // Deadline engine
  'DEADLINE_CREATED',
  'DEADLINE_WARNING_SENT',
  'DEADLINE_ESCALATED',
  'DEADLINE_COMPLETED',
  'DEADLINE_MISSED',
  'DEADLINE_EXTENDED',

  // Conflict check
  'CONFLICT_CHECK_INITIATED',
  'CONFLICT_CHECK_COMPLETED',
  'CONFLICT_OVERRIDE_APPROVED',

  // Document generation
  'DOCUMENT_GENERATED',
  'DOCUMENT_FINALIZED',
  'DOCUMENT_FILED',

  // AI sidecar
  'AI_DRAFT_CREATED',
  'AI_DRAFT_ACCEPTED',
  'AI_DRAFT_REJECTED',
  'AI_DRAFT_MODIFIED',

  // Patent family
  'PATENT_FAMILY_LINKED',
  'PATENT_FAMILY_UNLINKED',
  'PRIORITY_CLAIM_RECORDED',

  // Fee tracking
  'FEE_DEADLINE_CREATED',
  'FEE_PAYMENT_RECORDED',
  'FEE_WAIVED',

  // IDS (Information Disclosure Statement) / Duty of Candor
  'PRIOR_ART_REFERENCE_ADDED',
  'IDS_DRAFTED',
  'IDS_APPROVED',
  'IDS_FILED',
  'IDS_COVERAGE_WARNING',

  // Inventor declarations
  'DECLARATION_REQUESTED',
  'DECLARATION_SIGNED',

  // System
  'ARTIFACT_HASH_RECORDED',
  'INCIDENT_CREATED',
] as const;

export type EventType = (typeof EVENT_TYPES)[number];

// ─── Base Event ─────────────────────────────────────────────────────

export interface BaseEvent<T extends EventType, P> {
  event_id: EventId;
  tenant_id: TenantId;
  case_id: CaseId;
  event_type: T;
  actor_id: ActorId;
  actor_role: ActorRole;
  correlation_id: CorrelationId;
  causation_id: CausationId;
  timestamp: string; // ISO 8601 UTC
  previous_hash: string;
  new_hash: string;
  payload: P;
  metadata: Record<string, unknown>;
}

// ─── Case Events ────────────────────────────────────────────────────

export interface CaseCreatedPayload {
  title: string;
  applicant_id: ActorId;
  assigned_attorney_id: ActorId;
  jurisdiction: string;
  priority_date: string | null;
}

export interface CaseStatusChangedPayload {
  from_state: CaseStatus;
  to_state: CaseStatus;
  reason: string | null;
}

export type CaseCreatedEvent = BaseEvent<'CASE_CREATED', CaseCreatedPayload>;
export type CaseStatusChangedEvent = BaseEvent<
  'CASE_STATUS_CHANGED',
  CaseStatusChangedPayload
>;
export type CaseClosedEvent = BaseEvent<
  'CASE_CLOSED',
  { from_state: CaseStatus; close_reason: string }
>;

// ─── Claim Events ───────────────────────────────────────────────────

export interface ClaimCreatedPayload {
  claim_id: ClaimId;
  claim_number: number;
  claim_type: 'independent' | 'dependent';
  depends_on_claim_id: ClaimId | null;
  claim_text: string;
  ai_generated: boolean;
}

export interface ClaimAmendedPayload {
  claim_id: ClaimId;
  previous_version: number;
  new_version: number;
  previous_text: string;
  new_text: string;
  amendment_reason: string;
  diff: string;
}

export type ClaimCreatedEvent = BaseEvent<'CLAIM_CREATED', ClaimCreatedPayload>;
export type ClaimAmendedEvent = BaseEvent<'CLAIM_AMENDED', ClaimAmendedPayload>;
export type ClaimStatusChangedEvent = BaseEvent<
  'CLAIM_STATUS_CHANGED',
  { claim_id: ClaimId; from_status: ClaimStatus; to_status: ClaimStatus }
>;

// ─── Office Action Events ──────────────────────────────────────────

export interface OaReceivedPayload {
  oa_id: OfficeActionId;
  oa_type: 'non_final' | 'final' | 'restriction' | 'advisory';
  received_date: string;
  response_deadline: string;
  rejection_type: RejectionType;
  cited_references: CitedReference[];
}

export interface OaAnalysisCompletedPayload {
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
}

export type OaReceivedEvent = BaseEvent<'OA_RECEIVED', OaReceivedPayload>;
export type OaClassifiedEvent = BaseEvent<
  'OA_CLASSIFIED',
  {
    oa_id: OfficeActionId;
    from_status: OfficeActionStatus;
    to_status: OfficeActionStatus;
  }
>;
export type OaAnalysisCompletedEvent = BaseEvent<
  'OA_ANALYSIS_COMPLETED',
  OaAnalysisCompletedPayload
>;
export type OaStrategySelectedEvent = BaseEvent<
  'OA_STRATEGY_SELECTED',
  { oa_id: OfficeActionId; selected_strategy_id: string; selected_by: ActorId }
>;
export type OaResponseFiledEvent = BaseEvent<
  'OA_RESPONSE_FILED',
  { oa_id: OfficeActionId; document_id: DocumentId; filed_hash: string }
>;

// ─── Deadline Events ───────────────────────────────────────────────

export interface DeadlineCreatedPayload {
  deadline_id: DeadlineId;
  deadline_type: 'statutory' | 'procedural' | 'internal';
  source_entity_type: 'case' | 'office_action' | 'maintenance' | 'fee';
  source_entity_id: string;
  due_date: string;
  /** Traceable source rule (e.g., "37 CFR 1.111", "USPTO MPEP 710.02(e)") */
  rule_reference: string | null;
}

export interface DeadlineWarningSentPayload {
  deadline_id: DeadlineId;
  escalation_level: EscalationLevel;
  days_remaining: number;
  notified_actors: ActorId[];
  channels: string[];
}

export type DeadlineCreatedEvent = BaseEvent<
  'DEADLINE_CREATED',
  DeadlineCreatedPayload
>;
export type DeadlineWarningSentEvent = BaseEvent<
  'DEADLINE_WARNING_SENT',
  DeadlineWarningSentPayload
>;
export type DeadlineEscalatedEvent = BaseEvent<
  'DEADLINE_ESCALATED',
  {
    deadline_id: DeadlineId;
    from_level: EscalationLevel;
    to_level: EscalationLevel;
  }
>;
export type DeadlineCompletedEvent = BaseEvent<
  'DEADLINE_COMPLETED',
  { deadline_id: DeadlineId; completed_by: ActorId }
>;
export type DeadlineMissedEvent = BaseEvent<
  'DEADLINE_MISSED',
  { deadline_id: DeadlineId; missed_at: string; incident_created: boolean }
>;

// ─── Conflict Check Events ─────────────────────────────────────────

export interface ConflictCheckCompletedPayload {
  check_id: ConflictCheckId;
  checked_parties: string[];
  result: ConflictResult;
  matched_cases: CaseId[];
  details: string;
}

export type ConflictCheckInitiatedEvent = BaseEvent<
  'CONFLICT_CHECK_INITIATED',
  { check_id: ConflictCheckId; parties_to_check: string[] }
>;
export type ConflictCheckCompletedEvent = BaseEvent<
  'CONFLICT_CHECK_COMPLETED',
  ConflictCheckCompletedPayload
>;
export type ConflictOverrideApprovedEvent = BaseEvent<
  'CONFLICT_OVERRIDE_APPROVED',
  {
    check_id: ConflictCheckId;
    approved_by: ActorId;
    justification: string;
  }
>;

// ─── Document Events ───────────────────────────────────────────────

export interface DocumentGeneratedPayload {
  document_id: DocumentId;
  document_type: DocumentType;
  version: number;
  template_id: string;
  content_hash: string;
  file_path: string;
}

export type DocumentGeneratedEvent = BaseEvent<
  'DOCUMENT_GENERATED',
  DocumentGeneratedPayload
>;
export type DocumentFinalizedEvent = BaseEvent<
  'DOCUMENT_FINALIZED',
  {
    document_id: DocumentId;
    from_status: DocumentStatus;
    to_status: 'final';
    finalized_by: ActorId;
    content_hash: string;
  }
>;
export type DocumentFiledEvent = BaseEvent<
  'DOCUMENT_FILED',
  {
    document_id: DocumentId;
    filed_at: string;
    filing_reference: string;
    content_hash: string;
  }
>;

// ─── AI Sidecar Events ────────────────────────────────────────────

export interface AiDraftCreatedPayload {
  draft_type: 'claim_suggestion' | 'oa_analysis' | 'amendment_draft';
  ai_model: string;
  watermark: 'AI-GENERATED DRAFT — NOT LEGAL ADVICE';
  content_summary: string;
  artifact_hash: string;
}

export type AiDraftCreatedEvent = BaseEvent<
  'AI_DRAFT_CREATED',
  AiDraftCreatedPayload
>;
export type AiDraftAcceptedEvent = BaseEvent<
  'AI_DRAFT_ACCEPTED',
  { draft_event_id: EventId; accepted_by: ActorId; modifications: string | null }
>;
export type AiDraftRejectedEvent = BaseEvent<
  'AI_DRAFT_REJECTED',
  { draft_event_id: EventId; rejected_by: ActorId; reason: string }
>;

// ─── Patent Family Events ──────────────────────────────────────────

export type PatentFamilyLinkedEvent = BaseEvent<
  'PATENT_FAMILY_LINKED',
  {
    family_id: PatentFamilyId;
    parent_case_id: CaseId;
    child_case_id: CaseId;
    relationship_type: FamilyRelationshipType;
    priority_date: string;
  }
>;
export type PriorityClaimRecordedEvent = BaseEvent<
  'PRIORITY_CLAIM_RECORDED',
  {
    claiming_case_id: CaseId;
    parent_case_id: CaseId;
    priority_date: string;
    basis: string;
  }
>;

// ─── Fee Events ────────────────────────────────────────────────────

export type FeeDeadlineCreatedEvent = BaseEvent<
  'FEE_DEADLINE_CREATED',
  {
    fee_id: FeeId;
    fee_type: FeeType;
    amount: number;
    currency: string;
    due_date: string;
    deadline_id: DeadlineId;
  }
>;
export type FeePaymentRecordedEvent = BaseEvent<
  'FEE_PAYMENT_RECORDED',
  {
    fee_id: FeeId;
    fee_type: FeeType;
    amount: number;
    currency: string;
    payment_reference: string;
    paid_at: string;
  }
>;
export type FeeWaivedEvent = BaseEvent<
  'FEE_WAIVED',
  {
    fee_id: FeeId;
    fee_type: FeeType;
    waived_by: ActorId;
    reason: string;
  }
>;

// ─── IDS / Duty of Candor Events ──────────────────────────────────

export type PriorArtReferenceAddedEvent = BaseEvent<
  'PRIOR_ART_REFERENCE_ADDED',
  {
    reference_id: string;
    reference_type: 'us_patent' | 'us_publication' | 'foreign' | 'npl';
    document_number: string;
    title: string;
    source: 'oa_citation' | 'applicant_disclosure' | 'search_result';
  }
>;
export type IdsDraftedEvent = BaseEvent<
  'IDS_DRAFTED',
  {
    ids_id: IdsId;
    reference_ids: string[];
    document_id: DocumentId;
  }
>;
export type IdsApprovedEvent = BaseEvent<
  'IDS_APPROVED',
  {
    ids_id: IdsId;
    approved_by: ActorId;
  }
>;
export type IdsFiledEvent = BaseEvent<
  'IDS_FILED',
  {
    ids_id: IdsId;
    document_id: DocumentId;
    filed_at: string;
    content_hash: string;
  }
>;
export type IdsCoverageWarningEvent = BaseEvent<
  'IDS_COVERAGE_WARNING',
  {
    uncovered_reference_ids: string[];
    warning_message: string;
  }
>;

// ─── Declaration Events ───────────────────────────────────────────

export type DeclarationRequestedEvent = BaseEvent<
  'DECLARATION_REQUESTED',
  {
    inventor_id: ActorId;
    document_id: DocumentId;
  }
>;
export type DeclarationSignedEvent = BaseEvent<
  'DECLARATION_SIGNED',
  {
    inventor_id: ActorId;
    document_id: DocumentId;
    signed_at: string;
    content_hash: string;
  }
>;

// ─── Incident Events ──────────────────────────────────────────────

export type IncidentCreatedEvent = BaseEvent<
  'INCIDENT_CREATED',
  {
    incident_type: 'deadline_missed' | 'system_failure' | 'data_integrity';
    source_event_id: EventId;
    severity: 'critical' | 'high' | 'medium';
    description: string;
  }
>;

// ─── Union Type ─────────────────────────────────────────────────────

export type DomainEvent =
  | CaseCreatedEvent
  | CaseStatusChangedEvent
  | CaseClosedEvent
  | ClaimCreatedEvent
  | ClaimAmendedEvent
  | ClaimStatusChangedEvent
  | OaReceivedEvent
  | OaClassifiedEvent
  | OaAnalysisCompletedEvent
  | OaStrategySelectedEvent
  | OaResponseFiledEvent
  | DeadlineCreatedEvent
  | DeadlineWarningSentEvent
  | DeadlineEscalatedEvent
  | DeadlineCompletedEvent
  | DeadlineMissedEvent
  | ConflictCheckInitiatedEvent
  | ConflictCheckCompletedEvent
  | ConflictOverrideApprovedEvent
  | DocumentGeneratedEvent
  | DocumentFinalizedEvent
  | DocumentFiledEvent
  | AiDraftCreatedEvent
  | AiDraftAcceptedEvent
  | AiDraftRejectedEvent
  | PatentFamilyLinkedEvent
  | PriorityClaimRecordedEvent
  | FeeDeadlineCreatedEvent
  | FeePaymentRecordedEvent
  | FeeWaivedEvent
  | PriorArtReferenceAddedEvent
  | IdsDraftedEvent
  | IdsApprovedEvent
  | IdsFiledEvent
  | IdsCoverageWarningEvent
  | DeclarationRequestedEvent
  | DeclarationSignedEvent
  | IncidentCreatedEvent;
