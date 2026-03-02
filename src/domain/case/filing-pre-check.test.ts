/**
 * Filing Pre-Check — Unit Tests
 */

import { describe, it, expect } from 'vitest';
import {
  FilingPreChecker,
  DEFAULT_FILING_REQUIREMENTS,
} from './filing-pre-check.js';
import type { FiledDocumentRecord } from './filing-pre-check.js';
import type { CaseId, TenantId } from '../../shared/types/index.js';

const CASE = 'case_1' as CaseId;
const T = 'tenant_1' as TenantId;

describe('Filing Pre-Check', () => {
  const checker = new FilingPreChecker();

  it('passes when all required documents are present and finalized', () => {
    const docs: FiledDocumentRecord[] = [
      { document_type: 'application', status: 'final', content_hash: 'abc' },
      { document_type: 'declaration', status: 'final', content_hash: 'def' },
      { document_type: 'power_of_attorney', status: 'final', content_hash: 'ghi' },
    ];

    const result = checker.check(CASE, T, 'invention', 'US', docs);
    expect(result.is_ready).toBe(true);
    expect(result.missing_documents).toHaveLength(0);
  });

  it('fails when required documents are missing', () => {
    const docs: FiledDocumentRecord[] = [
      { document_type: 'application', status: 'final', content_hash: 'abc' },
    ];

    const result = checker.check(CASE, T, 'invention', 'US', docs);
    expect(result.is_ready).toBe(false);
    expect(result.missing_documents.length).toBeGreaterThanOrEqual(2);
  });

  it('warns when documents are still in draft status', () => {
    const docs: FiledDocumentRecord[] = [
      { document_type: 'application', status: 'draft', content_hash: 'abc' },
      { document_type: 'declaration', status: 'final', content_hash: 'def' },
      { document_type: 'power_of_attorney', status: 'final', content_hash: 'ghi' },
    ];

    const result = checker.check(CASE, T, 'invention', 'US', docs);
    expect(result.is_ready).toBe(false);
    expect(result.warnings.length).toBeGreaterThanOrEqual(1);
    expect(result.warnings[0]).toContain('draft');
  });

  it('fails with no documents at all', () => {
    const result = checker.check(CASE, T, 'invention', 'US', []);
    expect(result.is_ready).toBe(false);
    expect(result.missing_documents).toHaveLength(DEFAULT_FILING_REQUIREMENTS.length);
  });

  it('uses jurisdiction-specific rules when available', () => {
    const checker = new FilingPreChecker([
      {
        jurisdiction: 'TW',
        patent_type: 'invention',
        requirements: [
          { document_type: 'application', required: true, description: '專利申請書' },
          { document_type: 'power_of_attorney', required: true, description: '委任書' },
          // No declaration required for TW in this example
        ],
      },
    ]);

    const docs: FiledDocumentRecord[] = [
      { document_type: 'application', status: 'final', content_hash: 'abc' },
      { document_type: 'power_of_attorney', status: 'final', content_hash: 'def' },
    ];

    const result = checker.check(CASE, T, 'invention', 'TW', docs);
    expect(result.is_ready).toBe(true);
    expect(result.missing_documents).toHaveLength(0);
  });

  it('falls back to default rules for unknown jurisdictions', () => {
    const checker = new FilingPreChecker([
      {
        jurisdiction: 'TW',
        patent_type: 'invention',
        requirements: [
          { document_type: 'application', required: true, description: 'App' },
        ],
      },
    ]);

    // US not in custom rules, should use defaults
    const docs: FiledDocumentRecord[] = [
      { document_type: 'application', status: 'final', content_hash: 'abc' },
    ];

    const result = checker.check(CASE, T, 'invention', 'US', docs);
    expect(result.is_ready).toBe(false); // Missing declaration + POA
  });
});
