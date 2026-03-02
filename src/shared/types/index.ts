/**
 * PatentOps Platform — Core Shared Types
 *
 * These types are the foundation of the entire system.
 * Every module depends on these definitions.
 *
 * IMPORTANT: This is the CORE platform. Types here must be
 * jurisdiction-agnostic. Jurisdiction-specific values (e.g., US §102,
 * TW §22) belong in jurisdiction plugin projects.
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
export type PatentFamilyId = string & { readonly __brand: 'PatentFamilyId' };
export type FeeId = string & { readonly __brand: 'FeeId' };

// ─── Actor & Roles ──────────────────────────────────────────────────

export const ACTOR_ROLES = [
  'client',
  'inventor',
  'paralegal',
  'associate',
  'reviewer',
  'partner',
  'foreign_associate',
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
  jurisdiction: string | null;
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
  default_jurisdiction: string;
  settings: Record<string, unknown>;
  created_at: string;
}

// ─── Patent Type ────────────────────────────────────────────────────
// Universal patent types across jurisdictions.

export const PATENT_TYPES = [
  'invention',       // 發明 (TW), Utility Patent (US), Patent (EP)
  'utility_model',   // 新型 (TW), Gebrauchsmuster (DE), not available in US
  'design',          // 設計 (TW), Design Patent (US), Registered Design (EP)
] as const;

export type PatentType = (typeof PATENT_TYPES)[number];

// ─── Case ───────────────────────────────────────────────────────────

export const CASE_STATUSES = [
  'INTAKE',                // Case received, conflict check pending
  'DRAFTING',              // Application being drafted
  'REVIEW',                // Internal review
  'FILING',                // Approved, filing package being prepared
  'FILED',                 // Submitted to patent office, awaiting examination
  'EXAMINATION_REQUESTED', // Substantive examination requested (TW/EP/JP)
  'OA_RECEIVED',           // Office action received, response workflow active
  'ALLOWED',               // Notice of allowance / 核准審定
  'GRANTED',               // Patent issued / 公告, maintenance phase active
  'CLOSED',                // Terminated (abandoned, withdrawn, rejected, expired, lapsed)
] as const;

export type CaseStatus = (typeof CASE_STATUSES)[number];

export const CASE_CLOSE_REASONS = [
  'abandoned',           // Applicant chose not to continue
  'withdrawn',           // Applicant withdrew before examination
  'rejected',            // Final rejection upheld, appeal exhausted
  'lapsed',              // Failed to pay annuity/maintenance fee
  'expired',             // Patent term expired naturally
] as const;

export type CaseCloseReason = (typeof CASE_CLOSE_REASONS)[number];

export interface PatentCase {
  case_id: CaseId;
  tenant_id: TenantId;
  case_number: string | null;
  patent_type: PatentType;
  title: string;
  status: CaseStatus;
  applicant_id: ActorId;
  inventor_ids: ActorId[];
  assigned_attorney_id: ActorId;
  assigned_associate_id: ActorId | null;
  assigned_paralegal_id: ActorId | null;
  foreign_associate_id: ActorId | null;
  jurisdiction: string;
  filing_date: string | null;
  priority_date: string | null;
  application_number: string | null;
  patent_number: string | null;
  grant_date: string | null;
  examination_requested_date: string | null;
  parent_case_id: CaseId | null;
  family_id: PatentFamilyId | null;
  current_version: number;
  close_reason: CaseCloseReason | null;
  created_at: string;
}

// ─── Claim ──────────────────────────────────────────────────────────

export const CLAIM_TYPES = ['independent', 'dependent'] as const;
export type ClaimType = (typeof CLAIM_TYPES)[number];

export const CLAIM_CATEGORIES = [
  'method',
  'apparatus',
  'system',
  'composition',
  'use',
] as const;
export type ClaimCategory = (typeof CLAIM_CATEGORIES)[number];

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
  claim_category: ClaimCategory | null;
  depends_on_claim_id: ClaimId | null;
  claim_text: string;
  status: ClaimStatus;
  breadth_score: number | null;
  ai_generated: boolean;
  created_by_actor_id: ActorId;
  created_at: string;
}

// ─── Office Action ──────────────────────────────────────────────────
// Generic OA categories that map to jurisdiction-specific terminology.
// Examples:
//   'substantive_rejection' → US non-final OA, TW 審查意見通知
//   'final_rejection'       → US final OA, TW 核駁審定
//   'restriction'           → US restriction requirement, TW 限制
//   'search_report'         → EP search report, TW 檢索報告
//   'allowance'             → US notice of allowance, TW 核准審定

export const OA_CATEGORIES = [
  'substantive_rejection',
  'final_rejection',
  'restriction',
  'advisory',
  'search_report',
  'allowance',
] as const;

export type OfficeActionCategory = (typeof OA_CATEGORIES)[number];

// Generic rejection bases that map to jurisdiction-specific statutes.
// Jurisdiction plugins provide the mapping (e.g., 'novelty' → 'TW §22-I-1' or 'US §102').
export const REJECTION_BASES = [
  'novelty',                  // US §102, TW §22-I-1
  'inventive_step',           // US §103, TW §22-II
  'clarity',                  // US §112, TW §26
  'industrial_applicability', // TW §22-I, EP Art.57
  'patent_eligibility',       // US §101
  'new_matter',               // US §132, TW §67
  'double_patenting',         // US, TW §31
  'unity_of_invention',       // TW §33, EP Rule 44
  'other',
] as const;

export type RejectionBasis = (typeof REJECTION_BASES)[number];

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
  oa_category: OfficeActionCategory;
  /** Jurisdiction-specific OA type label (e.g., "non_final", "審查意見通知") */
  oa_type_label: string;
  mailing_date: string;
  received_date: string;
  response_deadline: string;
  extended_deadline: string | null;
  cited_references: CitedReference[];
  rejection_bases: RejectionBasis[];
  /** Jurisdiction-specific statutory references (e.g., ["35 USC §102", "35 USC §103"]) */
  statutory_references: string[];
  status: OfficeActionStatus;
  risk_rating: RiskRating | null;
  sequence_number: number;
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
  'fee',
  'examination_request',
  'priority_claim',
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
  /** Statutory/regulatory source for this deadline */
  rule_reference: string | null;
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
  'declaration',
  'power_of_attorney',
  'ids',                 // US-specific: Information Disclosure Statement
  'search_report',
  'fee_receipt',
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
  template_id: string | null;
  content_hash: string;
  status: DocumentStatus;
  generated_at: string;
  finalized_by_actor_id: ActorId | null;
  finalized_at: string | null;
  file_path: string;
}

// ─── Patent Family ─────────────────────────────────────────────────

export const FAMILY_RELATIONSHIP_TYPES = [
  'continuation',
  'divisional',
  'continuation_in_part',
  'provisional_to_nonprovisional',
  'pct_national_phase',
] as const;

export type FamilyRelationshipType =
  (typeof FAMILY_RELATIONSHIP_TYPES)[number];

export interface PatentFamilyLink {
  family_id: PatentFamilyId;
  tenant_id: TenantId;
  parent_case_id: CaseId;
  child_case_id: CaseId;
  relationship_type: FamilyRelationshipType;
  priority_date: string;
  created_at: string;
}

// ─── Fee Tracking ──────────────────────────────────────────────────
// Generic fee types. Jurisdiction plugins define fee schedules and amounts.

export const FEE_TYPES = [
  'filing',
  'search',
  'examination',
  'issue',             // Certificate fee / 證書費
  'annuity',           // Annual/maintenance fee — generic for all jurisdictions
  'extension',
  'petition',
  'foreign_filing',
  'late_surcharge',
  'reexamination',
] as const;

export type FeeType = (typeof FEE_TYPES)[number];

export const FEE_STATUSES = [
  'pending',
  'paid',
  'overdue',
  'waived',
] as const;

export type FeeStatus = (typeof FEE_STATUSES)[number];

export interface Fee {
  fee_id: FeeId;
  case_id: CaseId;
  tenant_id: TenantId;
  fee_type: FeeType;
  /** Jurisdiction-specific fee label (e.g., "3.5-year maintenance", "第3年年費") */
  fee_label: string;
  amount: number;
  currency: string;
  due_date: string;
  grace_period_end: string | null;
  late_surcharge_amount: number | null;
  status: FeeStatus;
  paid_at: string | null;
  payment_reference: string | null;
  deadline_id: DeadlineId | null;
  created_at: string;
}

// ─── Prior Art Reference ────────────────────────────────────────────
// Jurisdiction-agnostic prior art tracking.
// IDS (Information Disclosure Statement) is US-specific and handled
// by the US jurisdiction plugin. Core platform tracks references generically.

export interface PriorArtReference {
  reference_id: string;
  case_id: CaseId;
  tenant_id: TenantId;
  reference_type: 'patent' | 'publication' | 'npl';
  document_number: string;
  title: string;
  inventor: string | null;
  publication_date: string | null;
  jurisdiction: string | null;
  source: 'oa_citation' | 'applicant_disclosure' | 'search_result';
  added_at: string;
  added_by_actor_id: ActorId;
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
