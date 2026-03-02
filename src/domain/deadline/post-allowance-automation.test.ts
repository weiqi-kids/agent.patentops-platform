/**
 * Post-Allowance Automation — Unit Tests
 */

import { describe, it, expect } from 'vitest';
import {
  generateAllowanceDeadlines,
  generateGrantDeadlines,
} from './post-allowance-automation.js';
import type {
  AllowanceDeadlineRule,
  GrantDeadlineRule,
} from './post-allowance-automation.js';
import type {
  CaseId,
  TenantId,
  ActorId,
  CorrelationId,
  CausationId,
} from '../../shared/types/index.js';

const CASE = 'case_1' as CaseId;
const T = 'tenant_1' as TenantId;
const ACTOR = 'actor_1' as ActorId;
const CORR = 'corr_1' as CorrelationId;
const CAUS = 'caus_1' as CausationId;

const US_ALLOWANCE_RULES: AllowanceDeadlineRule[] = [
  {
    jurisdiction: 'US',
    issue_fee_period_months: 3,
    issue_fee_rule_reference: '37 CFR 1.311',
  },
];

const US_GRANT_RULES: GrantDeadlineRule[] = [
  {
    jurisdiction: 'US',
    first_annuity_months_after_grant: 42, // 3.5 years
    annuity_rule_reference: '35 USC §41(b)',
  },
];

describe('Post-Allowance Automation', () => {
  describe('generateAllowanceDeadlines', () => {
    it('generates issue fee deadline and fee events', () => {
      const events = generateAllowanceDeadlines(
        CASE, T, 'US', '2026-03-01T00:00:00Z',
        US_ALLOWANCE_RULES,
        ACTOR, 'system', CORR, CAUS,
      );

      expect(events).toHaveLength(2);
      expect(events[0].event_type).toBe('DEADLINE_CREATED');
      expect(events[1].event_type).toBe('FEE_CREATED');

      // Deadline should be 3 months after allowance date
      const deadlinePayload = events[0].payload as any;
      const dueDate = new Date(deadlinePayload.due_date);
      expect(dueDate.getMonth()).toBe(5); // June (0-indexed)
      expect(deadlinePayload.rule_reference).toBe('37 CFR 1.311');
      expect(deadlinePayload.deadline_type).toBe('statutory');
      expect(deadlinePayload.source_entity_type).toBe('fee');

      // Fee should reference the deadline
      const feePayload = events[1].payload as any;
      expect(feePayload.fee_type).toBe('issue');
      expect(feePayload.deadline_id).toBe(deadlinePayload.deadline_id);
    });

    it('returns empty array for unknown jurisdiction', () => {
      const events = generateAllowanceDeadlines(
        CASE, T, 'XX', '2026-03-01T00:00:00Z',
        US_ALLOWANCE_RULES,
        ACTOR, 'system', CORR, CAUS,
      );

      expect(events).toHaveLength(0);
    });

    it('all events have correct tenant and case IDs', () => {
      const events = generateAllowanceDeadlines(
        CASE, T, 'US', '2026-03-01T00:00:00Z',
        US_ALLOWANCE_RULES,
        ACTOR, 'system', CORR, CAUS,
      );

      for (const event of events) {
        expect(event.tenant_id).toBe(T);
        expect(event.case_id).toBe(CASE);
        expect(event.actor_id).toBe(ACTOR);
      }
    });
  });

  describe('generateGrantDeadlines', () => {
    it('generates first annuity deadline and fee events', () => {
      const events = generateGrantDeadlines(
        CASE, T, 'US', '2026-06-01T00:00:00Z',
        US_GRANT_RULES,
        ACTOR, 'system', CORR, CAUS,
      );

      expect(events).toHaveLength(2);
      expect(events[0].event_type).toBe('DEADLINE_CREATED');
      expect(events[1].event_type).toBe('FEE_CREATED');

      const deadlinePayload = events[0].payload as any;
      expect(deadlinePayload.rule_reference).toBe('35 USC §41(b)');

      const feePayload = events[1].payload as any;
      expect(feePayload.fee_type).toBe('annuity');
      expect(feePayload.fee_label).toContain('Annuity');
    });

    it('returns empty array for unknown jurisdiction', () => {
      const events = generateGrantDeadlines(
        CASE, T, 'XX', '2026-06-01T00:00:00Z',
        US_GRANT_RULES,
        ACTOR, 'system', CORR, CAUS,
      );

      expect(events).toHaveLength(0);
    });
  });
});
