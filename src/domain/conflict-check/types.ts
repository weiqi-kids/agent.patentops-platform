/**
 * Conflict of Interest Check — Domain Types
 *
 * Automatically triggered at case INTAKE.
 * Case cannot proceed to DRAFTING without completed conflict check.
 * CONFLICT_FOUND requires partner-level override with documented justification.
 */

import type {
  ConflictCheckId,
  CaseId,
  TenantId,
  ActorId,
  ConflictResult,
} from '../../shared/types/index.js';

// ─── Check Request ─────────────────────────────────────────────────

export interface ConflictCheckRequest {
  tenant_id: TenantId;
  case_id: CaseId;
  initiated_by: ActorId;
  /** Parties to check: applicant names, inventors, assignees */
  parties: PartyInfo[];
  /** Technology area keywords for technology-conflict detection */
  technology_keywords: string[];
}

export interface PartyInfo {
  name: string;
  role: 'applicant' | 'inventor' | 'assignee' | 'opposing_party';
  aliases: string[]; // known alternative names
  entity_type: 'individual' | 'corporation' | 'government';
}

// ─── Check Result ──────────────────────────────────────────────────

export interface ConflictCheckResult {
  check_id: ConflictCheckId;
  case_id: CaseId;
  tenant_id: TenantId;
  result: ConflictResult;
  checked_at: string;
  matches: ConflictMatch[];
  summary: string;
}

export interface ConflictMatch {
  match_id: string;
  matched_party: string;
  matched_against_party: string;
  matched_case_id: CaseId;
  matched_case_title: string;
  match_type: ConflictMatchType;
  match_confidence: number; // 0.0 - 1.0
  details: string;
}

export const CONFLICT_MATCH_TYPES = [
  'exact_name',           // Exact party name match
  'fuzzy_name',           // Similar party name (edit distance threshold)
  'same_entity',          // Same corporate entity (different name forms)
  'opposing_party',       // Party is opposing party in another case
  'technology_overlap',   // Overlapping technology area with competing applicants
] as const;

export type ConflictMatchType = (typeof CONFLICT_MATCH_TYPES)[number];

// ─── Override ──────────────────────────────────────────────────────

export interface ConflictOverrideRequest {
  check_id: ConflictCheckId;
  override_by: ActorId; // must be partner role
  justification: string; // mandatory, documented in ledger
  ethical_wall_measures: string | null; // description of information barriers
}

// ─── Fuzzy Matching Configuration ──────────────────────────────────

export interface FuzzyMatchConfig {
  /** Maximum Levenshtein edit distance for name matching */
  max_edit_distance: number;
  /** Minimum confidence score to flag as potential match */
  confidence_threshold: number;
  /** Whether to check technology area overlap */
  check_technology_overlap: boolean;
  /** Maximum number of cases to search (0 = all) */
  search_limit: number;
}

export const DEFAULT_FUZZY_MATCH_CONFIG: FuzzyMatchConfig = {
  max_edit_distance: 3,
  confidence_threshold: 0.7,
  check_technology_overlap: true,
  search_limit: 0, // search all cases in tenant
};
