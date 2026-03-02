/**
 * Filing Pre-Check Validation
 *
 * Validates document completeness before allowing a case to transition
 * from REVIEW → FILING. Checks that all required documents are present
 * and in the correct status.
 *
 * Required documents vary by jurisdiction and patent type.
 * Core platform defines the interface; jurisdiction plugins provide rules.
 */

import type {
  CaseId,
  TenantId,
  PatentType,
  DocumentType,
} from '../../shared/types/index.js';

// ─── Validation Rule Interface ─────────────────────────────────────

export interface FilingRequirement {
  document_type: DocumentType;
  required: boolean;
  description: string;
}

export interface JurisdictionFilingRules {
  jurisdiction: string;
  patent_type: PatentType;
  requirements: FilingRequirement[];
}

// ─── Pre-Check Result ───────────────────────────────────────────────

export interface FilingPreCheckResult {
  case_id: CaseId;
  tenant_id: TenantId;
  is_ready: boolean;
  checked_at: string;
  missing_documents: FilingRequirement[];
  warnings: string[];
}

// ─── Filing Document Record ─────────────────────────────────────────

export interface FiledDocumentRecord {
  document_type: DocumentType;
  status: 'draft' | 'final' | 'filed';
  content_hash: string;
}

// ─── Pre-Check Validator ────────────────────────────────────────────

/**
 * Default filing requirements (jurisdiction-agnostic minimum).
 * Jurisdiction plugins extend these with their own rules.
 */
export const DEFAULT_FILING_REQUIREMENTS: FilingRequirement[] = [
  {
    document_type: 'application',
    required: true,
    description: 'Patent application document (specification, claims, abstract)',
  },
  {
    document_type: 'declaration',
    required: true,
    description: 'Inventor declaration / oath',
  },
  {
    document_type: 'power_of_attorney',
    required: true,
    description: 'Power of attorney authorizing the attorney to act',
  },
];

export class FilingPreChecker {
  constructor(
    private readonly jurisdictionRules: JurisdictionFilingRules[] = [],
  ) {}

  /**
   * Validate that all required documents are present and finalized.
   */
  check(
    caseId: CaseId,
    tenantId: TenantId,
    patentType: PatentType,
    jurisdiction: string,
    existingDocuments: FiledDocumentRecord[],
  ): FilingPreCheckResult {
    const rules = this.getRequirements(jurisdiction, patentType);
    const missing: FilingRequirement[] = [];
    const warnings: string[] = [];

    for (const requirement of rules) {
      const doc = existingDocuments.find(
        (d) => d.document_type === requirement.document_type,
      );

      if (!doc) {
        if (requirement.required) {
          missing.push(requirement);
        } else {
          warnings.push(
            `Optional document '${requirement.document_type}' not found: ${requirement.description}`,
          );
        }
      } else if (doc.status === 'draft') {
        warnings.push(
          `Document '${requirement.document_type}' is still in draft status. Must be finalized before filing.`,
        );
        if (requirement.required) {
          missing.push({
            ...requirement,
            description: `${requirement.description} (exists but not finalized)`,
          });
        }
      }
    }

    // Check claims exist
    // (Claims are tracked in the claim aggregate, not the document table.)
    // This check would be performed separately by the caller.

    return {
      case_id: caseId,
      tenant_id: tenantId,
      is_ready: missing.length === 0,
      checked_at: new Date().toISOString(),
      missing_documents: missing,
      warnings,
    };
  }

  private getRequirements(
    jurisdiction: string,
    patentType: PatentType,
  ): FilingRequirement[] {
    const jurisdictionRule = this.jurisdictionRules.find(
      (r) => r.jurisdiction === jurisdiction && r.patent_type === patentType,
    );

    return jurisdictionRule?.requirements ?? DEFAULT_FILING_REQUIREMENTS;
  }
}
