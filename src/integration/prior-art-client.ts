/**
 * Prior Art Database Integration — Client Implementation
 *
 * Provides a unified interface for searching external patent databases.
 * Each adapter connects to a different database (USPTO, EPO, WIPO, Google Patents).
 *
 * Phase 1: Manual upload (no HTTP calls)
 * Phase 2: HTTP adapters for patent database APIs
 */

import type {
  PatentDatabaseAdapter,
  PatentSearchQuery,
  PatentSearchResult,
  PriorArtReference,
} from './types.js';

// ─── Unified Search Client ─────────────────────────────────────────

export class PriorArtSearchClient {
  private adapters: Map<string, PatentDatabaseAdapter> = new Map();

  registerAdapter(adapter: PatentDatabaseAdapter): void {
    this.adapters.set(adapter.source, adapter);
  }

  async searchAll(query: PatentSearchQuery): Promise<PatentSearchResult[]> {
    const results: PatentSearchResult[] = [];

    for (const adapter of this.adapters.values()) {
      const isAvailable = await adapter.isAvailable();
      if (!isAvailable) continue;

      try {
        const result = await adapter.search(query);
        results.push(result);
      } catch {
        // Log error but continue with other adapters
      }
    }

    return results;
  }

  async fetchByNumber(
    source: string,
    publicationNumber: string,
  ): Promise<PriorArtReference | null> {
    const adapter = this.adapters.get(source);
    if (!adapter) return null;

    const isAvailable = await adapter.isAvailable();
    if (!isAvailable) return null;

    return adapter.fetchByPublicationNumber(publicationNumber);
  }

  getAvailableSources(): string[] {
    return [...this.adapters.keys()];
  }
}

// ─── Generic HTTP Patent Database Adapter ────────────────────────────

export interface HttpAdapterConfig {
  source: string;
  baseUrl: string;
  apiKey: string;
  timeoutMs: number;
}

export class HttpPatentDatabaseAdapter implements PatentDatabaseAdapter {
  readonly source: string;
  private readonly config: HttpAdapterConfig;

  constructor(config: HttpAdapterConfig) {
    this.source = config.source;
    this.config = config;
  }

  async isAvailable(): Promise<boolean> {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);
      const response = await fetch(`${this.config.baseUrl}/health`, {
        signal: controller.signal,
      });
      clearTimeout(timeoutId);
      return response.ok;
    } catch {
      return false;
    }
  }

  async search(query: PatentSearchQuery): Promise<PatentSearchResult> {
    const response = await this.fetchWithTimeout(
      `${this.config.baseUrl}/search`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.config.apiKey}`,
        },
        body: JSON.stringify(query),
      },
    );

    if (!response.ok) {
      throw new Error(`Patent search failed: ${response.status}`);
    }

    const data = await response.json() as { results: PriorArtReference[]; total_count: number };

    return {
      source: this.source as PatentSearchResult['source'],
      results: data.results,
      total_count: data.total_count,
      query_timestamp: new Date().toISOString(),
    };
  }

  async fetchByPublicationNumber(
    publicationNumber: string,
  ): Promise<PriorArtReference | null> {
    const response = await this.fetchWithTimeout(
      `${this.config.baseUrl}/publications/${encodeURIComponent(publicationNumber)}`,
      {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${this.config.apiKey}`,
        },
      },
    );

    if (response.status === 404) return null;
    if (!response.ok) {
      throw new Error(`Fetch publication failed: ${response.status}`);
    }

    return response.json() as Promise<PriorArtReference>;
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
}
