/**
 * Conflict Check — Domain Logic
 *
 * Checks for conflicts of interest when a new case is received.
 * This is a mandatory gate at INTAKE — cases cannot proceed past
 * INTAKE without a completed conflict check.
 *
 * Conflict types:
 * - Same applicant with adverse cases in other tenants (detected at name level)
 * - Opposing parties across cases within the same tenant
 * - Technology overlap with competing applicants
 */

import type {
  TenantId,
  CaseId,
  ActorId,
  ConflictCheckId,
  ConflictResult,
} from '../../shared/types/index.js';
import type { ConflictCheckCompletedPayload } from '../../shared/events/index.js';

// ─── Types ─────────────────────────────────────────────────────────

export interface ConflictCheckRequest {
  check_id: ConflictCheckId;
  tenant_id: TenantId;
  case_id: CaseId;
  parties_to_check: string[];
  initiated_by: ActorId;
}

export interface ExistingCaseRecord {
  case_id: CaseId;
  tenant_id: TenantId;
  title: string;
  applicant_name: string;
  inventor_names: string[];
  status: string;
}

export interface ConflictMatch {
  matched_case_id: CaseId;
  match_type: 'exact_name' | 'fuzzy_name' | 'same_entity' | 'opposing_party' | 'technology_overlap';
  matched_party: string;
  queried_party: string;
  similarity_score: number;
  details: string;
}

export interface ConflictCheckResult {
  check_id: ConflictCheckId;
  result: ConflictResult;
  matches: ConflictMatch[];
  matched_cases: CaseId[];
  details: string;
}

// ─── Repository Interface ──────────────────────────────────────────

export interface ConflictCheckRepository {
  findActiveCasesByTenant(tenant_id: TenantId): Promise<ExistingCaseRecord[]>;
}

// ─── Conflict Checker ──────────────────────────────────────────────

export class ConflictChecker {
  constructor(
    private readonly repository: ConflictCheckRepository,
    private readonly similarityThreshold: number = 0.8,
  ) {}

  async checkConflicts(request: ConflictCheckRequest): Promise<ConflictCheckResult> {
    const existingCases = await this.repository.findActiveCasesByTenant(request.tenant_id);
    const matches: ConflictMatch[] = [];

    for (const partyName of request.parties_to_check) {
      const normalizedParty = normalizeName(partyName);

      for (const existing of existingCases) {
        // Skip self
        if (existing.case_id === request.case_id) continue;

        // Check applicant name
        const applicantScore = similarity(normalizedParty, normalizeName(existing.applicant_name));
        if (applicantScore >= this.similarityThreshold) {
          matches.push({
            matched_case_id: existing.case_id,
            match_type: applicantScore === 1 ? 'exact_name' : 'fuzzy_name',
            matched_party: existing.applicant_name,
            queried_party: partyName,
            similarity_score: applicantScore,
            details: `Applicant match in case "${existing.title}" (${existing.status})`,
          });
        }

        // Check inventor names
        for (const inventorName of existing.inventor_names) {
          const inventorScore = similarity(normalizedParty, normalizeName(inventorName));
          if (inventorScore >= this.similarityThreshold) {
            matches.push({
              matched_case_id: existing.case_id,
              match_type: inventorScore === 1 ? 'exact_name' : 'fuzzy_name',
              matched_party: inventorName,
              queried_party: partyName,
              similarity_score: inventorScore,
              details: `Inventor match in case "${existing.title}" (${existing.status})`,
            });
          }
        }
      }
    }

    // Deduplicate matched cases
    const matchedCases = [...new Set(matches.map((m) => m.matched_case_id))];

    let result: ConflictResult;
    let details: string;

    if (matches.length === 0) {
      result = 'clear';
      details = `No conflicts found. Checked ${request.parties_to_check.length} parties against ${existingCases.length} active cases.`;
    } else if (matches.some((m) => m.match_type === 'exact_name')) {
      result = 'conflict_found';
      details = `Exact name match found. ${matches.length} matches across ${matchedCases.length} cases. Partner review required.`;
    } else {
      result = 'review_needed';
      details = `${matches.length} fuzzy matches across ${matchedCases.length} cases. Manual review recommended.`;
    }

    return {
      check_id: request.check_id,
      result,
      matches,
      matched_cases: matchedCases,
      details,
    };
  }
}

// ─── Name Normalization ────────────────────────────────────────────

function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[,.\-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// ─── String Similarity (Levenshtein-based) ─────────────────────────

function similarity(a: string, b: string): number {
  if (a === b) return 1;
  if (a.length === 0 || b.length === 0) return 0;

  const distance = levenshteinDistance(a, b);
  const maxLen = Math.max(a.length, b.length);
  return 1 - distance / maxLen;
}

function levenshteinDistance(a: string, b: string): number {
  const matrix: number[][] = [];

  for (let i = 0; i <= a.length; i++) {
    matrix[i] = [i];
  }
  for (let j = 0; j <= b.length; j++) {
    matrix[0][j] = j;
  }

  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,      // deletion
        matrix[i][j - 1] + 1,      // insertion
        matrix[i - 1][j - 1] + cost, // substitution
      );
    }
  }

  return matrix[a.length][b.length];
}
