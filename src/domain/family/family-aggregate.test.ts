import { describe, it, expect, beforeEach } from 'vitest';
import {
  FamilyAggregate,
  validatePriorityDate,
} from './family-aggregate.js';
import type {
  CaseId,
  TenantId,
  ActorId,
  CorrelationId,
  CausationId,
} from '../../shared/types/index.js';

const TENANT = 'tenant_01' as TenantId;
const PARENT_CASE = 'case_parent' as CaseId;
const CHILD_CASE = 'case_child' as CaseId;
const ACTOR = 'actor_01' as ActorId;
const CORR = 'corr_01' as CorrelationId;
const CAUS = 'caus_01' as CausationId;

function baseLinkCmd(overrides: Partial<Parameters<FamilyAggregate['linkFamily']>[0]> = {}) {
  return {
    tenant_id: TENANT,
    parent_case_id: PARENT_CASE,
    child_case_id: CHILD_CASE,
    relationship_type: 'continuation' as const,
    priority_date: '2024-06-15T00:00:00.000Z',
    parent_filing_date: '2024-01-15T00:00:00.000Z',
    actor_id: ACTOR,
    actor_role: 'partner' as const,
    correlation_id: CORR,
    causation_id: CAUS,
    ...overrides,
  };
}

describe('FamilyAggregate', () => {
  let agg: FamilyAggregate;

  beforeEach(() => {
    agg = new FamilyAggregate();
  });

  describe('linkFamily', () => {
    it('creates a family link between parent and child cases', () => {
      agg.linkFamily(baseLinkCmd());

      expect(agg.currentLinks).toHaveLength(1);
      const link = agg.currentLinks[0];
      expect(link.parent_case_id).toBe(PARENT_CASE);
      expect(link.child_case_id).toBe(CHILD_CASE);
      expect(link.relationship_type).toBe('continuation');
      expect(link.tenant_id).toBe(TENANT);
      expect(link.family_id).toBeDefined();
    });

    it('emits PATENT_FAMILY_LINKED event', () => {
      agg.linkFamily(baseLinkCmd());

      const events = agg.pendingEvents;
      expect(events).toHaveLength(1);
      expect(events[0].event_type).toBe('PATENT_FAMILY_LINKED');
    });

    it('throws when linking a case to itself', () => {
      expect(() =>
        agg.linkFamily(baseLinkCmd({ child_case_id: PARENT_CASE })),
      ).toThrow('Cannot link a case to itself');
    });

    it('throws on duplicate link', () => {
      agg.linkFamily(baseLinkCmd());
      expect(() => agg.linkFamily(baseLinkCmd())).toThrow('already exists');
    });

    it('detects bidirectional duplicate (reversed parent/child)', () => {
      agg.linkFamily(baseLinkCmd());
      expect(() =>
        agg.linkFamily(baseLinkCmd({
          parent_case_id: CHILD_CASE,
          child_case_id: PARENT_CASE,
        })),
      ).toThrow('already exists');
    });

    it('reuses existing family ID for related cases', () => {
      agg.linkFamily(baseLinkCmd());
      const thirdCase = 'case_third' as CaseId;
      agg.linkFamily(baseLinkCmd({
        child_case_id: thirdCase,
        priority_date: '2024-08-01T00:00:00.000Z',
      }));

      const links = agg.currentLinks;
      expect(links).toHaveLength(2);
      expect(links[0].family_id).toBe(links[1].family_id);
    });

    it('throws when priority date is before parent filing date', () => {
      expect(() =>
        agg.linkFamily(baseLinkCmd({
          priority_date: '2023-12-01T00:00:00.000Z',
          parent_filing_date: '2024-01-15T00:00:00.000Z',
        })),
      ).toThrow('cannot be before parent filing date');
    });
  });

  describe('unlinkFamily', () => {
    it('removes an existing family link', () => {
      agg.linkFamily(baseLinkCmd());
      expect(agg.currentLinks).toHaveLength(1);

      agg.unlinkFamily({
        tenant_id: TENANT,
        parent_case_id: PARENT_CASE,
        child_case_id: CHILD_CASE,
        reason: 'Incorrect relationship',
        actor_id: ACTOR,
        actor_role: 'partner',
        correlation_id: CORR,
        causation_id: CAUS,
      });

      expect(agg.currentLinks).toHaveLength(0);
    });

    it('throws when no link exists', () => {
      expect(() =>
        agg.unlinkFamily({
          tenant_id: TENANT,
          parent_case_id: PARENT_CASE,
          child_case_id: CHILD_CASE,
          reason: 'test',
          actor_id: ACTOR,
          actor_role: 'partner',
          correlation_id: CORR,
          causation_id: CAUS,
        }),
      ).toThrow('No family link found');
    });

    it('emits PATENT_FAMILY_UNLINKED event', () => {
      agg.linkFamily(baseLinkCmd());
      agg.clearPendingEvents();

      agg.unlinkFamily({
        tenant_id: TENANT,
        parent_case_id: PARENT_CASE,
        child_case_id: CHILD_CASE,
        reason: 'test',
        actor_id: ACTOR,
        actor_role: 'partner',
        correlation_id: CORR,
        causation_id: CAUS,
      });

      const events = agg.pendingEvents;
      expect(events).toHaveLength(1);
      expect(events[0].event_type).toBe('PATENT_FAMILY_UNLINKED');
    });
  });

  describe('recordPriorityClaim', () => {
    it('emits PRIORITY_CLAIM_RECORDED event', () => {
      agg.recordPriorityClaim({
        tenant_id: TENANT,
        claiming_case_id: CHILD_CASE,
        parent_case_id: PARENT_CASE,
        priority_date: '2024-06-15T00:00:00.000Z',
        basis: 'Paris Convention',
        parent_filing_date: '2024-01-15T00:00:00.000Z',
        actor_id: ACTOR,
        actor_role: 'associate',
        correlation_id: CORR,
        causation_id: CAUS,
      });

      const events = agg.pendingEvents;
      expect(events).toHaveLength(1);
      expect(events[0].event_type).toBe('PRIORITY_CLAIM_RECORDED');
    });

    it('throws when claiming priority from itself', () => {
      expect(() =>
        agg.recordPriorityClaim({
          tenant_id: TENANT,
          claiming_case_id: PARENT_CASE,
          parent_case_id: PARENT_CASE,
          priority_date: '2024-06-15T00:00:00.000Z',
          basis: 'Paris Convention',
          parent_filing_date: '2024-01-15T00:00:00.000Z',
          actor_id: ACTOR,
          actor_role: 'associate',
          correlation_id: CORR,
          causation_id: CAUS,
        }),
      ).toThrow('cannot claim priority from itself');
    });
  });

  describe('isCaseInFamily', () => {
    it('returns true for linked cases', () => {
      agg.linkFamily(baseLinkCmd());
      expect(agg.isCaseInFamily(PARENT_CASE)).toBe(true);
      expect(agg.isCaseInFamily(CHILD_CASE)).toBe(true);
    });

    it('returns false for unlinked cases', () => {
      expect(agg.isCaseInFamily(PARENT_CASE)).toBe(false);
    });
  });

  describe('getLinkedCases', () => {
    it('returns all links for a case (bidirectional)', () => {
      const thirdCase = 'case_third' as CaseId;
      agg.linkFamily(baseLinkCmd());
      agg.linkFamily(baseLinkCmd({
        parent_case_id: CHILD_CASE,
        child_case_id: thirdCase,
        priority_date: '2024-08-01T00:00:00.000Z',
        parent_filing_date: '2024-06-15T00:00:00.000Z',
      }));

      // CHILD_CASE appears in both links
      const links = agg.getLinkedCases(CHILD_CASE);
      expect(links).toHaveLength(2);
    });
  });

  describe('loadFromHistory', () => {
    it('reconstructs state from events', () => {
      agg.linkFamily(baseLinkCmd());
      const events = agg.pendingEvents;

      const newAgg = new FamilyAggregate();
      newAgg.loadFromHistory(events);

      expect(newAgg.currentLinks).toHaveLength(1);
      expect(newAgg.currentLinks[0].parent_case_id).toBe(PARENT_CASE);
    });
  });
});

describe('validatePriorityDate', () => {
  it('passes when priority date is after parent filing date', () => {
    const result = validatePriorityDate(
      '2024-06-15T00:00:00.000Z',
      '2024-01-15T00:00:00.000Z',
    );
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('fails when priority date is before parent filing date', () => {
    const result = validatePriorityDate(
      '2023-12-01T00:00:00.000Z',
      '2024-01-15T00:00:00.000Z',
    );
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain('cannot be before');
  });

  it('warns when priority date exceeds 12-month window', () => {
    const result = validatePriorityDate(
      '2025-06-15T00:00:00.000Z',
      '2024-01-15T00:00:00.000Z',
    );
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain('more than 12 months');
  });

  it('passes when parent filing date is null', () => {
    const result = validatePriorityDate(
      '2024-06-15T00:00:00.000Z',
      null,
    );
    expect(result.valid).toBe(true);
  });
});
