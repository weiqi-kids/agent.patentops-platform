/**
 * AI Intelligence Layer — Sidecar Client Types
 *
 * The AI layer is a sidecar service invoked ONLY by the Workflow Engine.
 * AI never writes directly to the Evidence Ledger.
 * All AI outputs are watermarked as DRAFT.
 */

import type {
  CaseId,
  TenantId,
  ClaimId,
  OfficeActionId,
  ActorId,
  RiskRating,
  AI_DRAFT_WATERMARK,
} from '../shared/types/index.js';

// ─── AI Sidecar Client Interface ───────────────────────────────────

export interface AiSidecarClient {
  /** Check if the AI service is available */
  healthCheck(): Promise<boolean>;

  /** Generate claim suggestions for a case */
  suggestClaims(request: ClaimSuggestionRequest): Promise<ClaimSuggestionResponse>;

  /** Analyze an Office Action */
  analyzeOfficeAction(request: OaAnalysisRequest): Promise<OaAnalysisResponse>;

  /** Score claim breadth */
  scoreClaimBreadth(request: BreadthScoreRequest): Promise<BreadthScoreResponse>;

  /** Suggest amendment strategies */
  suggestAmendments(request: AmendmentSuggestionRequest): Promise<AmendmentSuggestionResponse>;
}

// ─── Claim Suggestion ──────────────────────────────────────────────

export interface ClaimSuggestionRequest {
  tenant_id: TenantId;
  case_id: CaseId;
  specification_summary: string;
  existing_claims: Array<{
    claim_id: ClaimId;
    claim_number: number;
    claim_text: string;
    claim_type: 'independent' | 'dependent';
  }>;
  prior_art_summary: string | null;
  instructions: string | null;
}

export interface ClaimSuggestionResponse {
  watermark: typeof AI_DRAFT_WATERMARK;
  model_id: string;
  generated_at: string;
  suggestions: Array<{
    suggestion_id: string;
    claim_type: 'independent' | 'dependent';
    depends_on_claim_number: number | null;
    suggested_text: string;
    breadth_score: number | null;
    reasoning: string;
  }>;
}

// ─── Office Action Analysis ────────────────────────────────────────

export interface OaAnalysisRequest {
  tenant_id: TenantId;
  case_id: CaseId;
  oa_id: OfficeActionId;
  oa_document_text: string;
  current_claims: Array<{
    claim_id: ClaimId;
    claim_number: number;
    claim_text: string;
  }>;
  cited_art: Array<{
    publication_number: string;
    title: string;
    abstract: string;
    relevant_passages: string[];
  }>;
}

export interface OaAnalysisResponse {
  watermark: typeof AI_DRAFT_WATERMARK;
  model_id: string;
  generated_at: string;
  rejection_classification: {
    primary_type: string;
    statutory_basis: string[];
    examiner_reasoning_summary: string;
  };
  claim_limitation_mapping: Array<{
    claim_number: number;
    limitations: Array<{
      limitation_text: string;
      cited_reference: string;
      cited_passage: string;
      mapping_strength: 'strong' | 'moderate' | 'weak';
    }>;
  }>;
  amendment_strategies: Array<{
    strategy_id: string;
    strategy_name: string;
    description: string;
    risk_rating: RiskRating;
    affected_claims: number[];
    reasoning: string;
    /** Clearly separated: AI suggestion vs legal reasoning */
    ai_suggestion: string;
    legal_considerations: string;
  }>;
  overall_risk_assessment: RiskRating;
}

// ─── Breadth Scoring ───────────────────────────────────────────────

export interface BreadthScoreRequest {
  tenant_id: TenantId;
  case_id: CaseId;
  claims: Array<{
    claim_id: ClaimId;
    claim_number: number;
    claim_text: string;
    claim_type: 'independent' | 'dependent';
  }>;
  technology_area: string;
}

export interface BreadthScoreResponse {
  watermark: typeof AI_DRAFT_WATERMARK;
  model_id: string;
  generated_at: string;
  scores: Array<{
    claim_id: ClaimId;
    claim_number: number;
    breadth_score: number; // 0.0 (narrow) to 1.0 (broad)
    reasoning: string;
    key_limiting_elements: string[];
  }>;
}

// ─── Amendment Suggestion ──────────────────────────────────────────

export interface AmendmentSuggestionRequest {
  tenant_id: TenantId;
  case_id: CaseId;
  oa_id: OfficeActionId;
  selected_strategy_id: string;
  claims_to_amend: Array<{
    claim_id: ClaimId;
    claim_number: number;
    current_text: string;
  }>;
  rejection_details: string;
  attorney_instructions: string | null;
}

export interface AmendmentSuggestionResponse {
  watermark: typeof AI_DRAFT_WATERMARK;
  model_id: string;
  generated_at: string;
  amendments: Array<{
    claim_number: number;
    amendment_type: 'amend' | 'cancel' | 'add';
    original_text: string;
    suggested_text: string;
    markup_text: string; // showing additions/deletions
    reasoning: string;
  }>;
  suggested_remarks: string;
}
