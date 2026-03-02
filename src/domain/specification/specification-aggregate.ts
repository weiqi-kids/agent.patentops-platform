/**
 * Specification Aggregate — Domain Logic
 *
 * Manages the patent specification (description, drawings, abstract)
 * and validates that claim amendments do not introduce new matter.
 *
 * New matter validation: any claim amendment must be supported by
 * the original specification disclosure. This is a jurisdiction-agnostic
 * rule enforced at the domain level.
 */

import { ulid } from 'ulid';
import type {
  CaseId,
  TenantId,
  ActorId,
  ActorRole,
  CorrelationId,
  CausationId,
} from '../../shared/types/index.js';

// ─── Specification State ──────────────────────────────────────────

export interface Specification {
  case_id: CaseId;
  tenant_id: TenantId;
  title: string;
  abstract_text: string;
  description_text: string;
  drawing_references: string[];
  original_disclosure_hash: string;
  current_version: number;
  created_at: string;
}

// ─── Commands ─────────────────────────────────────────────────────

export interface CreateSpecificationCommand {
  tenant_id: TenantId;
  case_id: CaseId;
  title: string;
  abstract_text: string;
  description_text: string;
  drawing_references: string[];
  actor_id: ActorId;
  actor_role: ActorRole;
  correlation_id: CorrelationId;
  causation_id: CausationId;
}

export interface UpdateSpecificationCommand {
  tenant_id: TenantId;
  case_id: CaseId;
  abstract_text?: string;
  description_text?: string;
  drawing_references?: string[];
  amendment_reason: string;
  actor_id: ActorId;
  actor_role: ActorRole;
  correlation_id: CorrelationId;
  causation_id: CausationId;
}

// ─── New Matter Validation ────────────────────────────────────────

export interface NewMatterCheckResult {
  has_new_matter: boolean;
  unsupported_elements: string[];
  analysis_summary: string;
}

/**
 * Check whether an amendment introduces new matter.
 *
 * This is a simple keyword-based check. In production, the AI sidecar
 * would perform deeper semantic analysis. The AI output is always DRAFT
 * and must be reviewed by a licensed professional.
 */
export function checkNewMatter(
  originalDescription: string,
  amendedClaimText: string,
): NewMatterCheckResult {
  const descriptionWords = new Set(
    extractSignificantWords(originalDescription),
  );
  const unsupported: string[] = [];

  // Extract key phrases from the amended claim
  const claimPhrases = extractKeyPhrases(amendedClaimText);

  for (const phrase of claimPhrases) {
    const phraseWords = extractSignificantWords(phrase);
    if (phraseWords.length === 0) continue;

    const missingWords = phraseWords.filter((w) => !descriptionWords.has(w));
    // If more than half of meaningful words in a phrase are missing, flag it
    if (missingWords.length > phraseWords.length / 2) {
      unsupported.push(phrase);
    }
  }

  return {
    has_new_matter: unsupported.length > 0,
    unsupported_elements: unsupported,
    analysis_summary: unsupported.length === 0
      ? 'No new matter detected. All claim elements appear to be supported by the original disclosure.'
      : `Potential new matter: ${unsupported.length} element(s) not found in original disclosure. Manual review required.`,
  };
}

const STOP_WORDS = new Set([
  'a', 'an', 'the', 'and', 'or', 'of', 'for', 'to', 'in', 'on', 'at',
  'by', 'is', 'are', 'was', 'were', 'be', 'been', 'being', 'has', 'have',
  'had', 'do', 'does', 'did', 'with', 'from', 'that', 'this', 'which',
  'said', 'configured', 'comprising', 'wherein', 'including', 'consists',
  'consisting', 'further', 'least', 'one', 'based', 'uses',
]);

/**
 * Extract significant words from text, filtering out stop words and short tokens.
 */
function extractSignificantWords(text: string): string[] {
  return text
    .toLowerCase()
    .split(/\W+/)
    .filter((w) => w.length > 2 && !STOP_WORDS.has(w));
}

/**
 * Extract key technical phrases from claim text.
 * Simple heuristic: split by common claim delimiters and filter short tokens.
 */
function extractKeyPhrases(claimText: string): string[] {
  const delimiters = /[;,]|\bcomprising\b|\bwherein\b|\bconsisting of\b|\bincluding\b|\bfurther comprising\b/gi;
  const segments = claimText.split(delimiters);

  return segments
    .map((s) => s.trim())
    .map((s) => s.replace(/^(a|an|the|said|at least one)\s+/i, ''))
    .filter((s) => s.length > 5);
}

// ─── Specification Aggregate ──────────────────────────────────────

export class SpecificationAggregate {
  private state: Specification | null = null;

  get currentState(): Specification | null {
    return this.state;
  }

  createSpecification(cmd: CreateSpecificationCommand): void {
    if (this.state) {
      throw new Error('Specification already exists for this case');
    }

    const { createHash } = require('node:crypto');
    const disclosureContent = `${cmd.title}\n${cmd.abstract_text}\n${cmd.description_text}`;
    const hash = createHash('sha256').update(disclosureContent, 'utf8').digest('hex');

    this.state = {
      case_id: cmd.case_id,
      tenant_id: cmd.tenant_id,
      title: cmd.title,
      abstract_text: cmd.abstract_text,
      description_text: cmd.description_text,
      drawing_references: cmd.drawing_references,
      original_disclosure_hash: hash,
      current_version: 1,
      created_at: new Date().toISOString(),
    };
  }

  updateSpecification(cmd: UpdateSpecificationCommand): void {
    if (!this.state) {
      throw new Error('Specification does not exist');
    }

    if (cmd.abstract_text !== undefined) {
      this.state.abstract_text = cmd.abstract_text;
    }
    if (cmd.description_text !== undefined) {
      this.state.description_text = cmd.description_text;
    }
    if (cmd.drawing_references !== undefined) {
      this.state.drawing_references = cmd.drawing_references;
    }
    this.state.current_version++;
  }

  /**
   * Validate that a claim amendment doesn't introduce new matter
   * relative to the original specification.
   */
  validateNoNewMatter(amendedClaimText: string): NewMatterCheckResult {
    if (!this.state) {
      throw new Error('Specification does not exist');
    }

    return checkNewMatter(this.state.description_text, amendedClaimText);
  }
}
