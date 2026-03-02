/**
 * PatentOps Platform — Core Shared Types
 *
 * These types are the foundation of the entire system.
 * Every module depends on these definitions.
 */

// ─── Branded ID Types ────────────────────────────────────────────────
// Using branded types to prevent accidental ID mixing at compile time.

export type TenantId = string & { readonly __brand: 'TenantId' };
export type CaseId = string & { readonly __brand: 'CaseId' };
export type ClaimId = string & { readonly __brand: 'ClaimId' };
export type EventId = string & { readonly __brand: 'EventId' };
export type ActorId = string & { readonly __brand: 'ActorId' };
export type DeadlineId = string & { readonly __brand: 'DeadlineId' };
export type OfficeActionId = string & { readonly __brand: 'OfficeActionId' };
export type DocumentId = string & { readonly __brand: 'DocumentId' };
export type ConflictCheckId = string & { readonly __brand: 'ConflictCheckId' };
export type CorrelationId = string & { readonly __brand: 'CorrelationId' };
export type CausationId = string & { readonly __brand: 'CausationId' };

// ─── Actor & Roles ──────────────────────────────────────────────────

export const ACTOR_ROLES = [
  'client',
  'associate',
  'reviewer',
  'partner',
  'admin',
  'system',
] as const;

export type ActorRole = (typeof ACTOR_ROLES)[number];

export interface Actor {
  actor_id: ActorId;
  tenant_id: TenantId;
  email: string;
  name: string;
  role: ActorRole;
  license_number: string | null;
  is_active: boolean;
  created_at: string;
}

// ─── Tenant ─────────────────────────────────────────────────────────

export const PLAN_TIERS = ['starter', 'professional', 'enterprise'] as const;
export type PlanTier = (typeof PLAN_TIERS)[number];

export interface Tenant {
  tenant_id: TenantId;
  name: string;
  plan_tier: PlanTier;
  settings: Record<string, unknown>;
  created_at: string;
}

// ─── Case ───────────────────────────────────────────────────────────

export const CASE_STATUSES = [
  'INTAKE',
  'DRAFTING',
  'REVIEW',
  'FILING',
  'PENDING',
  'OA_RECEIVED',
  'CLOSED',
] as const;

export type CaseStatus = (typeof CASE_STATUSES)[number];

export const CASE_CLOSE_REASONS = [
  'granted',
  'withdrawn',
  'abandoned',
] as const;

export type CaseCloseReason = (typeof CASE_CLOSE_REASONS)[number];

export interface PatentCase {
  case_id: CaseId;
  tenant_id: TenantId;
  case_number: string | null;
  title: string;
  status: CaseStatus;
  applicant_id: ActorId;
  assigned_attorney_id: ActorId;
  assigned_associate_id: ActorId | null;
  jurisdiction: string;
  filing_date: string | null;
  priority_date: string | null;
  current_version: number;
  close_reason: CaseCloseReason | null;
  created_at: string;
}

// ─── Claim ──────────────────────────────────────────────────────────

export const CLAIM_TYPES = ['independent', 'dependent'] as const;
export type ClaimType = (typeof CLAIM_TYPES)[number];

export const CLAIM_STATUSES = [
  'draft',
  'reviewed',
  'filed',
  'amended',
  'cancelled',
] as const;

export type ClaimStatus = (typeof CLAIM_STATUSES)[number];

export interface Claim {
  claim_id: ClaimId;
  case_id: CaseId;
  tenant_id: TenantId;
  version: number;
  claim_number: number;
  claim_type: ClaimType;
  depends_on_claim_id: ClaimId | null;
  claim_text: string;
  status: ClaimStatus;
  breadth_score: number | null;
  ai_generated: boolean;
  created_by_actor_id: ActorId;
  created_at: string;
}

// ─── Office Action ──────────────────────────────────────────────────

export const OA_TYPES = [
  'non_final',
  'final',
  'restriction',
  'advisory',
] as const;

export type OfficeActionType = (typeof OA_TYPES)[number];

export const REJECTION_TYPES = ['102', '103', '112', 'other'] as const;
export type RejectionType = (typeof REJECTION_TYPES)[number];

export const OA_STATUSES = [
  'received',
  'analyzing',
  'strategizing',
  'amending',
  'review',
  'filed',
] as const;

export type OfficeActionStatus = (typeof OA_STATUSES)[number];

export const RISK_RATINGS = ['high', 'medium', 'low'] as const;
export type RiskRating = (typeof RISK_RATINGS)[number];

export interface CitedReference {
  reference_id: string;
  publication_number: string;
  title: string;
  relevant_claims: number[];
  relevance_summary: string;
}

export interface OfficeAction {
  oa_id: OfficeActionId;
  case_id: CaseId;
  tenant_id: TenantId;
  oa_type: OfficeActionType;
  received_date: string;
  response_deadline: string;
  extended_deadline: string | null;
  cited_references: CitedReference[];
  rejection_type: RejectionType;
  status: OfficeActionStatus;
  risk_rating: RiskRating | null;
  created_at: string;
}

// ─── Deadline ───────────────────────────────────────────────────────

export const DEADLINE_TYPES = [
  'statutory',
  'procedural',
  'internal',
] as const;

export type DeadlineType = (typeof DEADLINE_TYPES)[number];

export const DEADLINE_SOURCE_ENTITY_TYPES = [
  'case',
  'office_action',
  'maintenance',
] as const;

export type DeadlineSourceEntityType =
  (typeof DEADLINE_SOURCE_ENTITY_TYPES)[number];

export const DEADLINE_STATUSES = [
  'active',
  'completed',
  'waived',
  'missed',
] as const;

export type DeadlineStatus = (typeof DEADLINE_STATUSES)[number];

export const ESCALATION_LEVELS = [0, 1, 2, 3, 4, 5] as const;
export type EscalationLevel = (typeof ESCALATION_LEVELS)[number];

export interface Deadline {
  deadline_id: DeadlineId;
  case_id: CaseId;
  tenant_id: TenantId;
  deadline_type: DeadlineType;
  source_entity_type: DeadlineSourceEntityType;
  source_entity_id: string;
  due_date: string;
  warning_sent_at: string[];
  escalation_level: EscalationLevel;
  status: DeadlineStatus;
  created_at: string;
}

// ─── Conflict Check ────────────────────────────────────────────────

export const CONFLICT_RESULTS = [
  'clear',
  'conflict_found',
  'review_needed',
] as const;

export type ConflictResult = (typeof CONFLICT_RESULTS)[number];

export interface ConflictCheck {
  check_id: ConflictCheckId;
  tenant_id: TenantId;
  case_id: CaseId;
  checked_against_parties: string[];
  result: ConflictResult;
  reviewed_by_actor_id: ActorId | null;
  reviewed_at: string | null;
  created_at: string;
}

// ─── Document ──────────────────────────────────────────────────────

export const DOCUMENT_TYPES = [
  'application',
  'response',
  'amendment',
  'ids',
  'declaration',
] as const;

export type DocumentType = (typeof DOCUMENT_TYPES)[number];

export const DOCUMENT_STATUSES = ['draft', 'final', 'filed'] as const;
export type DocumentStatus = (typeof DOCUMENT_STATUSES)[number];

export interface Document {
  document_id: DocumentId;
  case_id: CaseId;
  tenant_id: TenantId;
  document_type: DocumentType;
  version: number;
  template_id: string;
  content_hash: string;
  status: DocumentStatus;
  generated_at: string;
  finalized_by_actor_id: ActorId | null;
  finalized_at: string | null;
  file_path: string;
}

// ─── AI Draft Marker ───────────────────────────────────────────────

export const AI_DRAFT_WATERMARK =
  'AI-GENERATED DRAFT — NOT LEGAL ADVICE' as const;

export interface AiDraftOutput {
  watermark: typeof AI_DRAFT_WATERMARK;
  generated_by_model: string;
  generated_at: string;
  confidence_score: number | null;
  content: unknown;
}
