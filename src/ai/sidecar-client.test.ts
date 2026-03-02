/**
 * AI Sidecar Client — Unit Tests
 *
 * Tests HTTP client behavior using mocked fetch.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { HttpAiSidecarClient } from './sidecar-client.js';

// Mock global fetch
const mockFetch = vi.fn();

describe('HttpAiSidecarClient', () => {
  let client: HttpAiSidecarClient;

  beforeEach(() => {
    vi.stubGlobal('fetch', mockFetch);
    client = new HttpAiSidecarClient({
      baseUrl: 'http://test-ai:8081',
      apiKey: 'test-key',
      timeoutMs: 5000,
      maxRetries: 1,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('healthCheck', () => {
    it('returns true when service is healthy', async () => {
      mockFetch.mockResolvedValue({ ok: true });
      const result = await client.healthCheck();
      expect(result).toBe(true);
      expect(mockFetch).toHaveBeenCalledWith(
        'http://test-ai:8081/health',
        expect.objectContaining({ method: 'GET' }),
      );
    });

    it('returns false when service is unhealthy', async () => {
      mockFetch.mockResolvedValue({ ok: false });
      const result = await client.healthCheck();
      expect(result).toBe(false);
    });

    it('returns false when fetch throws', async () => {
      mockFetch.mockRejectedValue(new Error('Connection refused'));
      const result = await client.healthCheck();
      expect(result).toBe(false);
    });
  });

  describe('suggestClaims', () => {
    it('sends POST with correct headers and body', async () => {
      const response = {
        watermark: 'AI-GENERATED DRAFT — NOT LEGAL ADVICE',
        model_id: 'claude-opus-4-6',
        generated_at: '2025-01-15T10:00:00.000Z',
        suggestions: [],
      };

      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(response),
      });

      const result = await client.suggestClaims({
        tenant_id: 'tenant_01' as any,
        case_id: 'case_01' as any,
        specification_summary: 'A novel widget...',
        existing_claims: [],
        prior_art_summary: null,
        instructions: null,
      });

      expect(result).toEqual(response);
      expect(mockFetch).toHaveBeenCalledWith(
        'http://test-ai:8081/api/v1/claims/suggest',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'Content-Type': 'application/json',
            'Authorization': 'Bearer test-key',
            'X-Watermark': 'AI-GENERATED DRAFT — NOT LEGAL ADVICE',
          }),
        }),
      );
    });
  });

  describe('analyzeOfficeAction', () => {
    it('returns analysis response on success', async () => {
      const response = {
        watermark: 'AI-GENERATED DRAFT — NOT LEGAL ADVICE',
        model_id: 'claude-opus-4-6',
        generated_at: '2025-01-15T10:00:00.000Z',
        rejection_classification: { primary_type: 'novelty', statutory_basis: [], examiner_reasoning_summary: '' },
        claim_limitation_mapping: [],
        amendment_strategies: [],
        overall_risk_assessment: 'medium',
      };

      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(response),
      });

      const result = await client.analyzeOfficeAction({
        tenant_id: 'tenant_01' as any,
        case_id: 'case_01' as any,
        oa_id: 'oa_01' as any,
        oa_document_text: 'Office action text...',
        current_claims: [],
        cited_art: [],
      });

      expect(result.overall_risk_assessment).toBe('medium');
    });
  });

  describe('retry logic', () => {
    it('retries on failure up to maxRetries', async () => {
      mockFetch
        .mockRejectedValueOnce(new Error('Network error'))
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ scores: [] }),
        });

      const result = await client.scoreClaimBreadth({
        tenant_id: 'tenant_01' as any,
        case_id: 'case_01' as any,
        claims: [],
        technology_area: 'software',
      });

      expect(result).toEqual({ scores: [] });
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it('throws after exhausting retries', async () => {
      mockFetch.mockRejectedValue(new Error('Network error'));

      await expect(
        client.scoreClaimBreadth({
          tenant_id: 'tenant_01' as any,
          case_id: 'case_01' as any,
          claims: [],
          technology_area: 'software',
        }),
      ).rejects.toThrow('failed after 2 attempts');
    });

    it('throws on non-ok HTTP response', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 500,
        text: () => Promise.resolve('Internal Server Error'),
      });

      await expect(
        client.suggestAmendments({
          tenant_id: 'tenant_01' as any,
          case_id: 'case_01' as any,
          oa_id: 'oa_01' as any,
          selected_strategy_id: 'strat_01',
          claims_to_amend: [],
          rejection_details: 'test',
          attorney_instructions: null,
        }),
      ).rejects.toThrow('AI sidecar returned 500');
    });
  });
});
