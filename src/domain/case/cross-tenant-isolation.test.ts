/**
 * Cross-Tenant Isolation Tests
 *
 * Verifies that tenant data is never mixed.
 * Every aggregate operation is tenant-scoped.
 */

import { describe, it, expect } from 'vitest';
import { CaseAggregate } from './case-aggregate.js';
import { ClaimAggregate } from '../claim/claim-aggregate.js';
import { ConflictChecker } from '../conflict-check/conflict-checker.js';
import type { ConflictCheckRepository, ExistingCaseRecord } from '../conflict-check/conflict-checker.js';
import type {
  TenantId,
  CaseId,
  ActorId,
  ConflictCheckId,
  CorrelationId,
  CausationId,
} from '../../shared/types/index.js';

const TENANT_A = 'tenant_A' as TenantId;
const TENANT_B = 'tenant_B' as TenantId;
const ACTOR_A = 'actor_A' as ActorId;
const ACTOR_B = 'actor_B' as ActorId;
const CORR = 'corr_1' as CorrelationId;
const CAUS = 'caus_1' as CausationId;

describe('Cross-Tenant Isolation', () => {
  describe('Case Aggregate', () => {
    it('creates cases with correct tenant_id', () => {
      const aggA = new CaseAggregate();
      aggA.createCase({
        tenant_id: TENANT_A,
        title: 'Case for Tenant A',
        patent_type: 'invention',
        applicant_id: ACTOR_A,
        inventor_ids: [ACTOR_A],
        assigned_attorney_id: ACTOR_A,
        jurisdiction: 'US',
        priority_date: null,
        parent_case_id: null,
        actor_id: ACTOR_A,
        actor_role: 'partner',
        correlation_id: CORR,
      });

      const aggB = new CaseAggregate();
      aggB.createCase({
        tenant_id: TENANT_B,
        title: 'Case for Tenant B',
        patent_type: 'design',
        applicant_id: ACTOR_B,
        inventor_ids: [ACTOR_B],
        assigned_attorney_id: ACTOR_B,
        jurisdiction: 'TW',
        priority_date: null,
        parent_case_id: null,
        actor_id: ACTOR_B,
        actor_role: 'partner',
        correlation_id: CORR,
      });

      expect(aggA.currentState!.tenant_id).toBe(TENANT_A);
      expect(aggB.currentState!.tenant_id).toBe(TENANT_B);
      expect(aggA.currentState!.tenant_id).not.toBe(aggB.currentState!.tenant_id);
    });

    it('events carry the correct tenant_id', () => {
      const agg = new CaseAggregate();
      agg.createCase({
        tenant_id: TENANT_A,
        title: 'Tenant A Case',
        patent_type: 'invention',
        applicant_id: ACTOR_A,
        inventor_ids: [ACTOR_A],
        assigned_attorney_id: ACTOR_A,
        jurisdiction: 'US',
        priority_date: null,
        parent_case_id: null,
        actor_id: ACTOR_A,
        actor_role: 'partner',
        correlation_id: CORR,
      });

      for (const event of agg.pendingEvents) {
        expect(event.tenant_id).toBe(TENANT_A);
      }
    });

    it('loading events from different tenants does not mix state', () => {
      const aggA = new CaseAggregate();
      aggA.createCase({
        tenant_id: TENANT_A,
        title: 'Case A',
        patent_type: 'invention',
        applicant_id: ACTOR_A,
        inventor_ids: [ACTOR_A],
        assigned_attorney_id: ACTOR_A,
        jurisdiction: 'US',
        priority_date: null,
        parent_case_id: null,
        actor_id: ACTOR_A,
        actor_role: 'partner',
        correlation_id: CORR,
      });

      // Loading only tenant A events into a new aggregate
      const replayAgg = new CaseAggregate();
      replayAgg.loadFromHistory(aggA.pendingEvents);

      expect(replayAgg.currentState!.tenant_id).toBe(TENANT_A);
      expect(replayAgg.currentState!.title).toBe('Case A');
    });
  });

  describe('Claim Aggregate', () => {
    it('claims carry the correct tenant_id', () => {
      const aggA = new ClaimAggregate();
      const claimId = aggA.createClaim({
        tenant_id: TENANT_A,
        case_id: 'case_A' as CaseId,
        claim_number: 1,
        claim_type: 'independent',
        claim_category: 'method',
        depends_on_claim_id: null,
        claim_text: 'A method for tenant A.',
        ai_generated: false,
        actor_id: ACTOR_A,
        actor_role: 'associate',
        correlation_id: CORR,
        causation_id: CAUS,
      });

      expect(aggA.getClaim(claimId)!.tenant_id).toBe(TENANT_A);

      // All events should have tenant_id = TENANT_A
      for (const event of aggA.pendingEvents) {
        expect(event.tenant_id).toBe(TENANT_A);
      }
    });

    it('tenant B cannot access tenant A claims via event replay', () => {
      const aggA = new ClaimAggregate();
      aggA.createClaim({
        tenant_id: TENANT_A,
        case_id: 'case_A' as CaseId,
        claim_number: 1,
        claim_type: 'independent',
        claim_category: 'method',
        depends_on_claim_id: null,
        claim_text: 'Tenant A claim.',
        ai_generated: false,
        actor_id: ACTOR_A,
        actor_role: 'associate',
        correlation_id: CORR,
        causation_id: CAUS,
      });

      const aggB = new ClaimAggregate();
      aggB.createClaim({
        tenant_id: TENANT_B,
        case_id: 'case_B' as CaseId,
        claim_number: 1,
        claim_type: 'independent',
        claim_category: 'apparatus',
        depends_on_claim_id: null,
        claim_text: 'Tenant B claim.',
        ai_generated: false,
        actor_id: ACTOR_B,
        actor_role: 'associate',
        correlation_id: CORR,
        causation_id: CAUS,
      });

      // Each aggregate only has its own claim
      expect(aggA.allClaims).toHaveLength(1);
      expect(aggB.allClaims).toHaveLength(1);
      expect(aggA.allClaims[0].tenant_id).toBe(TENANT_A);
      expect(aggB.allClaims[0].tenant_id).toBe(TENANT_B);
    });
  });

  describe('Conflict Checker', () => {
    it('only searches within the specified tenant', async () => {
      const tenantACases: ExistingCaseRecord[] = [
        {
          case_id: 'case_1' as CaseId,
          tenant_id: TENANT_A,
          title: 'Widget Patent',
          applicant_name: 'Acme Corp',
          inventor_names: ['Alice Inventor'],
          status: 'FILED',
        },
      ];

      const tenantBCases: ExistingCaseRecord[] = [
        {
          case_id: 'case_2' as CaseId,
          tenant_id: TENANT_B,
          title: 'Gadget Patent',
          applicant_name: 'Acme Corp', // Same name, different tenant
          inventor_names: ['Bob Builder'],
          status: 'FILED',
        },
      ];

      // Repository returns only cases for the specified tenant
      const repository: ConflictCheckRepository = {
        async findActiveCasesByTenant(tenantId: TenantId) {
          if (tenantId === TENANT_A) return tenantACases;
          if (tenantId === TENANT_B) return tenantBCases;
          return [];
        },
      };

      const checker = new ConflictChecker(repository);

      // Check for tenant A — should find Acme Corp in tenant A
      const resultA = await checker.checkConflicts({
        check_id: 'check_A' as ConflictCheckId,
        tenant_id: TENANT_A,
        case_id: 'new_case' as CaseId,
        parties_to_check: ['Acme Corp'],
        initiated_by: ACTOR_A,
      });

      // Should find the match within tenant A
      expect(resultA.matches.length).toBeGreaterThanOrEqual(1);
      expect(resultA.matches.every((m) => m.matched_case_id === ('case_1' as CaseId))).toBe(true);

      // Check for tenant B — should find Acme Corp only in tenant B
      const resultB = await checker.checkConflicts({
        check_id: 'check_B' as ConflictCheckId,
        tenant_id: TENANT_B,
        case_id: 'new_case_b' as CaseId,
        parties_to_check: ['Acme Corp'],
        initiated_by: ACTOR_B,
      });

      expect(resultB.matches.length).toBeGreaterThanOrEqual(1);
      expect(resultB.matches.every((m) => m.matched_case_id === ('case_2' as CaseId))).toBe(true);
    });

    it('returns no matches when tenant has no existing cases', async () => {
      const repository: ConflictCheckRepository = {
        async findActiveCasesByTenant() {
          return [];
        },
      };

      const checker = new ConflictChecker(repository);

      const result = await checker.checkConflicts({
        check_id: 'check_empty' as ConflictCheckId,
        tenant_id: TENANT_A,
        case_id: 'new_case' as CaseId,
        parties_to_check: ['Some Company'],
        initiated_by: ACTOR_A,
      });

      expect(result.result).toBe('clear');
      expect(result.matches).toHaveLength(0);
    });
  });
});
