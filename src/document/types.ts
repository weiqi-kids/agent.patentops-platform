/**
 * Document Generation Pipeline — Types
 *
 * Flow: Template Selection → Data Binding → Draft Preview → Human Approval → Hash + Seal → Export
 *
 * Every generated document is a new version, never overwritten.
 * Templates are also version-controlled.
 */

import type {
  DocumentId,
  CaseId,
  TenantId,
  ActorId,
  DocumentType,
  DocumentStatus,
} from '../shared/types/index.js';

// ─── Template System ───────────────────────────────────────────────

export interface DocumentTemplate {
  template_id: string;
  jurisdiction: string;
  document_type: DocumentType;
  version: number;
  name: string;
  description: string;
  /** Handlebars template content */
  template_content: string;
  /** JSON Schema defining required data bindings */
  data_schema: Record<string, unknown>;
  created_at: string;
  is_active: boolean;
}

// ─── Data Binding ──────────────────────────────────────────────────

export interface ApplicationDataBinding {
  case_number: string;
  title: string;
  applicant_name: string;
  applicant_address: string;
  attorney_name: string;
  attorney_registration_number: string;
  filing_date: string;
  priority_date: string | null;
  specification_text: string;
  abstract_text: string;
  claims: Array<{
    claim_number: number;
    claim_type: 'independent' | 'dependent';
    depends_on: number | null;
    claim_text: string;
  }>;
  drawings_references: string[];
}

export interface OaResponseDataBinding {
  case_number: string;
  oa_mailing_date: string;
  examiner_name: string;
  art_unit: string;
  attorney_name: string;
  attorney_registration_number: string;
  rejection_type: string;
  arguments: Array<{
    claim_numbers: number[];
    rejection_basis: string;
    argument_text: string;
  }>;
  amendments: Array<{
    claim_number: number;
    amendment_type: 'amend' | 'cancel' | 'add';
    previous_text: string | null;
    new_text: string;
    markup_text: string;
  }>;
  remarks: string;
}

export interface IdsDataBinding {
  case_number: string;
  attorney_name: string;
  references: Array<{
    reference_type: 'us_patent' | 'us_publication' | 'foreign' | 'npl';
    document_number: string;
    inventor: string;
    publication_date: string;
    title: string;
  }>;
}

export type DocumentDataBinding =
  | ApplicationDataBinding
  | OaResponseDataBinding
  | IdsDataBinding;

// ─── Generation Pipeline ───────────────────────────────────────────

export interface GenerationRequest {
  tenant_id: TenantId;
  case_id: CaseId;
  document_type: DocumentType;
  template_id: string;
  data_binding: DocumentDataBinding;
  requested_by: ActorId;
}

export interface GenerationResult {
  document_id: DocumentId;
  version: number;
  content_hash: string;
  file_path: string;
  status: 'draft';
  generated_at: string;
}

export interface SealResult {
  document_id: DocumentId;
  content_hash: string;
  sealed_at: string;
  sealed_by: ActorId;
  status: 'final';
}

// ─── Document Output Formats ───────────────────────────────────────

export const OUTPUT_FORMATS = ['pdf', 'docx', 'xml'] as const;
export type OutputFormat = (typeof OUTPUT_FORMATS)[number];
