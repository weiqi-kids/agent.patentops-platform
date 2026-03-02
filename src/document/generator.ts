/**
 * Document Generation Pipeline — Implementation
 *
 * Flow: Template Selection → Data Binding → Render → Hash → Store
 *
 * Uses Handlebars for template rendering.
 * Every generated document is a new version, never overwritten.
 * Filed documents are SHA-256 hash-locked.
 */

import { createHash } from 'node:crypto';
import { ulid } from 'ulid';
import type {
  DocumentId,
  CaseId,
  TenantId,
  ActorId,
  DocumentType,
} from '../shared/types/index.js';
import type {
  DocumentTemplate,
  GenerationRequest,
  GenerationResult,
  SealResult,
  DocumentDataBinding,
} from './types.js';

// ─── Template Registry ────────────────────────────────────────────

export interface TemplateRegistry {
  getTemplate(templateId: string): Promise<DocumentTemplate | null>;
  getActiveTemplate(
    jurisdiction: string,
    documentType: DocumentType,
  ): Promise<DocumentTemplate | null>;
}

// ─── Document Storage ─────────────────────────────────────────────

export interface DocumentStorage {
  store(
    tenantId: TenantId,
    caseId: CaseId,
    documentId: DocumentId,
    content: string,
  ): Promise<string>; // returns file_path
}

// ─── Document Generator ──────────────────────────────────────────

export class DocumentGenerator {
  constructor(
    private readonly templateRegistry: TemplateRegistry,
    private readonly storage: DocumentStorage,
  ) {}

  /**
   * Generate a document from a template and data binding.
   * Returns a DRAFT document — must be sealed by a licensed professional.
   */
  async generate(request: GenerationRequest): Promise<GenerationResult> {
    const template = await this.templateRegistry.getTemplate(request.template_id);
    if (!template) {
      throw new Error(`Template ${request.template_id} not found`);
    }

    if (template.document_type !== request.document_type) {
      throw new Error(
        `Template type '${template.document_type}' does not match requested type '${request.document_type}'`,
      );
    }

    // Render template with data binding
    const rendered = renderTemplate(template.template_content, request.data_binding);

    // Compute content hash
    const contentHash = computeHash(rendered);

    // Generate document ID
    const documentId = ulid() as DocumentId;

    // Store the document
    const filePath = await this.storage.store(
      request.tenant_id,
      request.case_id,
      documentId,
      rendered,
    );

    return {
      document_id: documentId,
      version: 1,
      content_hash: contentHash,
      file_path: filePath,
      status: 'draft',
      generated_at: new Date().toISOString(),
    };
  }

  /**
   * Seal a document (finalize). Must be done by a licensed professional.
   * Hash-locks the content — any modification after sealing is detectable.
   */
  async seal(
    documentId: DocumentId,
    content: string,
    sealedBy: ActorId,
  ): Promise<SealResult> {
    const contentHash = computeHash(content);

    return {
      document_id: documentId,
      content_hash: contentHash,
      sealed_at: new Date().toISOString(),
      sealed_by: sealedBy,
      status: 'final',
    };
  }
}

// ─── Template Rendering ──────────────────────────────────────────

/**
 * Simple Handlebars-style template rendering.
 * Replaces {{key}} with values from the data binding.
 * For production, use the full Handlebars library.
 */
function renderTemplate(
  templateContent: string,
  data: DocumentDataBinding,
): string {
  let rendered = templateContent;
  const flatData = flattenObject(data as Record<string, unknown>);

  for (const [key, value] of Object.entries(flatData)) {
    const placeholder = new RegExp(`\\{\\{\\s*${escapeRegex(key)}\\s*\\}\\}`, 'g');
    rendered = rendered.replace(placeholder, String(value ?? ''));
  }

  return rendered;
}

/**
 * Compute SHA-256 hash of content.
 */
export function computeHash(content: string): string {
  return createHash('sha256').update(content, 'utf8').digest('hex');
}

// ─── Utility ────────────────────────────────────────────────────

function flattenObject(
  obj: Record<string, unknown>,
  prefix: string = '',
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    const fullKey = prefix ? `${prefix}.${key}` : key;
    if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      Object.assign(result, flattenObject(value as Record<string, unknown>, fullKey));
    } else {
      result[fullKey] = value;
    }
  }
  return result;
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
