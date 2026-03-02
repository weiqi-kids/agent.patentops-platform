/**
 * Prior Art Integration — Types
 *
 * Phase 1: Manual upload + AI analysis
 * Phase 2: API integration with patent databases
 * Phase 3: Proactive monitoring for new publications
 */

import type { CaseId, TenantId, ClaimId } from '../shared/types/index.js';

// ─── Phase 1: Manual Upload + AI Analysis ──────────────────────────

export interface PriorArtReference {
  reference_id: string;
  source: 'manual_upload' | 'uspto' | 'epo' | 'wipo' | 'google_patents';
  publication_number: string;
  title: string;
  abstract: string;
  inventors: string[];
  assignee: string | null;
  publication_date: string;
  classification_codes: string[];
  full_text_available: boolean;
  file_path: string | null; // path to uploaded PDF
}

export interface ClaimLimitationMapping {
  claim_id: ClaimId;
  claim_number: number;
  claim_text: string;
  limitations: Array<{
    limitation_text: string;
    mapped_references: Array<{
      reference_id: string;
      relevant_passage: string;
      relevance_score: number; // 0.0 - 1.0
      mapping_type: 'anticipation' | 'obvious_combination' | 'analogous';
    }>;
    overall_vulnerability: 'high' | 'medium' | 'low';
  }>;
}

export interface PriorArtAnalysisRequest {
  tenant_id: TenantId;
  case_id: CaseId;
  claims: Array<{
    claim_id: ClaimId;
    claim_number: number;
    claim_text: string;
  }>;
  references: PriorArtReference[];
}

export interface PriorArtAnalysisResult {
  analysis_id: string;
  case_id: CaseId;
  analyzed_at: string;
  ai_model_used: string;
  watermark: 'AI-GENERATED DRAFT — NOT LEGAL ADVICE';
  claim_mappings: ClaimLimitationMapping[];
  overall_risk_assessment: {
    risk_rating: 'high' | 'medium' | 'low';
    summary: string;
    recommended_actions: string[];
  };
}

// ─── Phase 2: Patent Database API Integration ──────────────────────

export interface PatentSearchQuery {
  keywords: string[];
  classification_codes: string[];
  date_range: {
    from: string;
    to: string;
  };
  inventor: string | null;
  assignee: string | null;
  max_results: number;
}

export interface PatentSearchResult {
  source: 'uspto' | 'epo' | 'wipo' | 'google_patents';
  results: PriorArtReference[];
  total_count: number;
  query_timestamp: string;
}

/**
 * Interface for patent database adapters.
 * Each jurisdiction project implements its own adapters.
 */
export interface PatentDatabaseAdapter {
  readonly source: string;
  search(query: PatentSearchQuery): Promise<PatentSearchResult>;
  fetchByPublicationNumber(number: string): Promise<PriorArtReference | null>;
  isAvailable(): Promise<boolean>;
}

// ─── Phase 3: Proactive Monitoring ────────────────────────────────

export interface MonitoringWatch {
  watch_id: string;
  tenant_id: TenantId;
  case_id: CaseId;
  classification_codes: string[];
  keywords: string[];
  check_frequency: 'daily' | 'weekly';
  last_checked_at: string | null;
  is_active: boolean;
  created_at: string;
}

export interface MonitoringAlert {
  alert_id: string;
  watch_id: string;
  case_id: CaseId;
  tenant_id: TenantId;
  matched_reference: PriorArtReference;
  match_reason: string;
  relevance_score: number;
  acknowledged: boolean;
  created_at: string;
}
