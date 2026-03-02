/**
 * AI Sidecar HTTP Client — Implementation
 *
 * Communicates with the external AI sidecar service via HTTP.
 * AI outputs are always watermarked as DRAFT.
 * The client handles retries, timeouts, and health checks.
 */

import { AI_DRAFT_WATERMARK } from '../shared/types/index.js';
import type {
  AiSidecarClient,
  ClaimSuggestionRequest,
  ClaimSuggestionResponse,
  OaAnalysisRequest,
  OaAnalysisResponse,
  BreadthScoreRequest,
  BreadthScoreResponse,
  AmendmentSuggestionRequest,
  AmendmentSuggestionResponse,
} from './types.js';

export interface AiSidecarConfig {
  baseUrl: string;
  apiKey: string;
  timeoutMs: number;
  maxRetries: number;
}

const DEFAULT_CONFIG: AiSidecarConfig = {
  baseUrl: process.env['AI_SIDECAR_URL'] ?? 'http://localhost:8081',
  apiKey: process.env['AI_SIDECAR_API_KEY'] ?? '',
  timeoutMs: 60_000,
  maxRetries: 2,
};

export class HttpAiSidecarClient implements AiSidecarClient {
  private readonly config: AiSidecarConfig;

  constructor(config?: Partial<AiSidecarConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  async healthCheck(): Promise<boolean> {
    try {
      const response = await this.fetchWithTimeout(
        `${this.config.baseUrl}/health`,
        { method: 'GET' },
      );
      return response.ok;
    } catch {
      return false;
    }
  }

  async suggestClaims(request: ClaimSuggestionRequest): Promise<ClaimSuggestionResponse> {
    return this.postWithRetry<ClaimSuggestionResponse>(
      '/api/v1/claims/suggest',
      request,
    );
  }

  async analyzeOfficeAction(request: OaAnalysisRequest): Promise<OaAnalysisResponse> {
    return this.postWithRetry<OaAnalysisResponse>(
      '/api/v1/office-actions/analyze',
      request,
    );
  }

  async scoreClaimBreadth(request: BreadthScoreRequest): Promise<BreadthScoreResponse> {
    return this.postWithRetry<BreadthScoreResponse>(
      '/api/v1/claims/breadth-score',
      request,
    );
  }

  async suggestAmendments(request: AmendmentSuggestionRequest): Promise<AmendmentSuggestionResponse> {
    return this.postWithRetry<AmendmentSuggestionResponse>(
      '/api/v1/amendments/suggest',
      request,
    );
  }

  // ─── HTTP Helpers ─────────────────────────────────────────────────

  private async postWithRetry<T>(path: string, body: unknown): Promise<T> {
    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= this.config.maxRetries; attempt++) {
      try {
        const response = await this.fetchWithTimeout(
          `${this.config.baseUrl}${path}`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${this.config.apiKey}`,
              'X-Watermark': AI_DRAFT_WATERMARK,
            },
            body: JSON.stringify(body),
          },
        );

        if (!response.ok) {
          const errorText = await response.text();
          throw new Error(
            `AI sidecar returned ${response.status}: ${errorText}`,
          );
        }

        const result = await response.json() as T;
        return result;
      } catch (err) {
        lastError = err as Error;
        if (attempt < this.config.maxRetries) {
          // Exponential backoff: 1s, 2s
          await this.sleep(1000 * (attempt + 1));
        }
      }
    }

    throw new Error(
      `AI sidecar request failed after ${this.config.maxRetries + 1} attempts: ${lastError?.message}`,
    );
  }

  private async fetchWithTimeout(
    url: string,
    init: RequestInit,
  ): Promise<Response> {
    const controller = new AbortController();
    const timeoutId = setTimeout(
      () => controller.abort(),
      this.config.timeoutMs,
    );

    try {
      return await fetch(url, { ...init, signal: controller.signal });
    } finally {
      clearTimeout(timeoutId);
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
