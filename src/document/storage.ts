/**
 * Document Storage — Concrete Implementations
 *
 * Provides local filesystem storage and in-memory template registry
 * for the DocumentGenerator pipeline.
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';
import type {
  DocumentId,
  CaseId,
  TenantId,
  DocumentType,
} from '../shared/types/index.js';
import type { TemplateRegistry, DocumentStorage } from './generator.js';
import type { DocumentTemplate } from './types.js';

// ─── Local File Document Storage ──────────────────────────────────

export class LocalFileDocumentStorage implements DocumentStorage {
  constructor(private readonly basePath: string) {}

  async store(
    tenantId: TenantId,
    caseId: CaseId,
    documentId: DocumentId,
    content: string,
  ): Promise<string> {
    const dir = path.join(this.basePath, tenantId, 'cases', caseId, 'documents');
    await fs.mkdir(dir, { recursive: true });

    const filePath = path.join(dir, `${documentId}.txt`);
    await fs.writeFile(filePath, content, 'utf8');

    // Return relative path for portability
    return path.relative(this.basePath, filePath);
  }
}

// ─── In-Memory Template Registry ──────────────────────────────────

export class InMemoryTemplateRegistry implements TemplateRegistry {
  private templates: Map<string, DocumentTemplate> = new Map();

  register(template: DocumentTemplate): void {
    this.templates.set(template.template_id, template);
  }

  async getTemplate(templateId: string): Promise<DocumentTemplate | null> {
    return this.templates.get(templateId) ?? null;
  }

  async getActiveTemplate(
    jurisdiction: string,
    documentType: DocumentType,
  ): Promise<DocumentTemplate | null> {
    for (const template of this.templates.values()) {
      if (
        template.jurisdiction === jurisdiction &&
        template.document_type === documentType &&
        template.is_active
      ) {
        return template;
      }
    }
    return null;
  }
}
