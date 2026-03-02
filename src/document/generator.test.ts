/**
 * Document Generation Pipeline — Unit Tests
 */

import { describe, it, expect } from 'vitest';
import { DocumentGenerator, computeHash } from './generator.js';
import type { TemplateRegistry, DocumentStorage } from './generator.js';
import type { DocumentTemplate } from './types.js';
import type {
  TenantId,
  CaseId,
  ActorId,
  DocumentId,
} from '../shared/types/index.js';

const T = 'tenant_1' as TenantId;
const CASE = 'case_1' as CaseId;
const ACTOR = 'actor_1' as ActorId;

const TEST_TEMPLATE: DocumentTemplate = {
  template_id: 'tmpl_001',
  jurisdiction: 'US',
  document_type: 'application',
  version: 1,
  name: 'US Patent Application',
  description: 'Standard US patent application template',
  template_content: 'Title: {{title}}\nApplicant: {{applicant_name}}\nFiling Date: {{filing_date}}',
  data_schema: {},
  created_at: '2026-01-01T00:00:00Z',
  is_active: true,
};

class InMemoryTemplateRegistry implements TemplateRegistry {
  private templates = new Map<string, DocumentTemplate>();

  constructor(templates: DocumentTemplate[] = []) {
    for (const t of templates) {
      this.templates.set(t.template_id, t);
    }
  }

  async getTemplate(templateId: string) {
    return this.templates.get(templateId) ?? null;
  }

  async getActiveTemplate(jurisdiction: string, documentType: string) {
    for (const t of this.templates.values()) {
      if (t.jurisdiction === jurisdiction && t.document_type === documentType && t.is_active) {
        return t;
      }
    }
    return null;
  }
}

class InMemoryDocumentStorage implements DocumentStorage {
  private stored = new Map<string, string>();

  async store(tenantId: TenantId, caseId: CaseId, documentId: DocumentId, content: string) {
    const path = `/cases/${caseId}/documents/${documentId}`;
    this.stored.set(path, content);
    return path;
  }

  getStored(path: string) {
    return this.stored.get(path);
  }
}

describe('Document Generator', () => {
  describe('generate', () => {
    it('generates a document from template and data binding', async () => {
      const registry = new InMemoryTemplateRegistry([TEST_TEMPLATE]);
      const storage = new InMemoryDocumentStorage();
      const generator = new DocumentGenerator(registry, storage);

      const result = await generator.generate({
        tenant_id: T,
        case_id: CASE,
        document_type: 'application',
        template_id: 'tmpl_001',
        data_binding: {
          case_number: 'P-2026-001',
          title: 'Widget Optimizer',
          applicant_name: 'Acme Corp',
          applicant_address: '123 Main St',
          attorney_name: 'Jane Attorney',
          attorney_registration_number: '12345',
          filing_date: '2026-03-01',
          priority_date: null,
          specification_text: 'Detailed spec...',
          abstract_text: 'An abstract...',
          claims: [],
          drawings_references: [],
        },
        requested_by: ACTOR,
      });

      expect(result.document_id).toBeDefined();
      expect(result.version).toBe(1);
      expect(result.status).toBe('draft');
      expect(result.content_hash).toBeDefined();
      expect(result.file_path).toContain(CASE);

      // Verify content was rendered
      const content = storage.getStored(result.file_path);
      expect(content).toContain('Widget Optimizer');
      expect(content).toContain('Acme Corp');
      expect(content).toContain('2026-03-01');
    });

    it('throws when template not found', async () => {
      const registry = new InMemoryTemplateRegistry([]);
      const storage = new InMemoryDocumentStorage();
      const generator = new DocumentGenerator(registry, storage);

      await expect(
        generator.generate({
          tenant_id: T,
          case_id: CASE,
          document_type: 'application',
          template_id: 'nonexistent',
          data_binding: {} as any,
          requested_by: ACTOR,
        }),
      ).rejects.toThrow('Template nonexistent not found');
    });

    it('throws when template type does not match', async () => {
      const registry = new InMemoryTemplateRegistry([TEST_TEMPLATE]);
      const storage = new InMemoryDocumentStorage();
      const generator = new DocumentGenerator(registry, storage);

      await expect(
        generator.generate({
          tenant_id: T,
          case_id: CASE,
          document_type: 'response', // Mismatch!
          template_id: 'tmpl_001',
          data_binding: {} as any,
          requested_by: ACTOR,
        }),
      ).rejects.toThrow('Template type');
    });
  });

  describe('seal', () => {
    it('seals a document with hash and returns final status', async () => {
      const registry = new InMemoryTemplateRegistry([TEST_TEMPLATE]);
      const storage = new InMemoryDocumentStorage();
      const generator = new DocumentGenerator(registry, storage);

      const content = 'Final document content';
      const documentId = 'doc_001' as DocumentId;

      const result = await generator.seal(documentId, content, ACTOR);

      expect(result.document_id).toBe(documentId);
      expect(result.status).toBe('final');
      expect(result.sealed_by).toBe(ACTOR);
      expect(result.content_hash).toBe(computeHash(content));
    });
  });

  describe('computeHash', () => {
    it('produces consistent SHA-256 hash', () => {
      const hash1 = computeHash('hello world');
      const hash2 = computeHash('hello world');
      expect(hash1).toBe(hash2);
      expect(hash1).toHaveLength(64); // SHA-256 hex
    });

    it('different content produces different hash', () => {
      const hash1 = computeHash('content A');
      const hash2 = computeHash('content B');
      expect(hash1).not.toBe(hash2);
    });
  });
});
