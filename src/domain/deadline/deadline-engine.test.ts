import { describe, it, expect } from 'vitest';
import {
  calculateDeadline,
  evaluateDeadline,
  resolveStartDate,
} from './deadline-engine.js';
import type { JurisdictionDeadlineRule } from './types.js';
import type { DeadlineId, CaseId, TenantId, ActorId } from '../../shared/types/index.js';

// ─── Test Fixtures ─────────────────────────────────────────────────

const TW_RULES: JurisdictionDeadlineRule[] = [
  {
    jurisdiction: 'TW',
    trigger_type: 'substantive_rejection',
    base_response_period_months: 3,
    max_extensions: 1,
    extension_period_months: 3,
    extension_requires_fee: true,
    absolute_max_months: 6,
    start_date_basis: 'service_date',
    service_date_offset_days: 5,
    rule_reference: '專利法施行細則第28條',
  },
];

const US_RULES: JurisdictionDeadlineRule[] = [
  {
    jurisdiction: 'US',
    trigger_type: 'substantive_rejection',
    base_response_period_months: 3,
    max_extensions: 3,
    extension_period_months: 1,
    extension_requires_fee: true,
    absolute_max_months: 6,
    start_date_basis: 'mailing_date',
    service_date_offset_days: 0,
    rule_reference: '37 CFR 1.111; MPEP 710.02(e)',
  },
];

const EP_RULES: JurisdictionDeadlineRule[] = [
  {
    jurisdiction: 'EP',
    trigger_type: 'substantive_rejection',
    base_response_period_months: 4,
    max_extensions: 1,
    extension_period_months: 2,
    extension_requires_fee: false,
    absolute_max_months: 6,
    start_date_basis: 'received_date',
    service_date_offset_days: 0,
    rule_reference: 'EPC Rule 132',
  },
];

describe('Deadline Engine', () => {
  describe('resolveStartDate', () => {
    it('uses mailing_date for US jurisdiction', () => {
      const input = {
        jurisdiction: 'US',
        trigger_type: 'substantive_rejection',
        mailing_date: '2026-01-10T00:00:00Z',
        received_date: '2026-01-15T00:00:00Z',
        extensions_used: 0,
      };
      const startDate = resolveStartDate(input, US_RULES[0]);
      expect(startDate.toISOString()).toBe('2026-01-10T00:00:00.000Z');
    });

    it('uses received_date for EP jurisdiction', () => {
      const input = {
        jurisdiction: 'EP',
        trigger_type: 'substantive_rejection',
        mailing_date: '2026-01-10T00:00:00Z',
        received_date: '2026-01-20T00:00:00Z',
        extensions_used: 0,
      };
      const startDate = resolveStartDate(input, EP_RULES[0]);
      expect(startDate.toISOString()).toBe('2026-01-20T00:00:00.000Z');
    });

    it('uses mailing_date + offset for TW jurisdiction (constructive service)', () => {
      const input = {
        jurisdiction: 'TW',
        trigger_type: 'substantive_rejection',
        mailing_date: '2026-01-10T00:00:00Z',
        received_date: '2026-01-18T00:00:00Z',
        extensions_used: 0,
      };
      const startDate = resolveStartDate(input, TW_RULES[0]);
      // mailing_date (Jan 10) + 5 days = Jan 15
      expect(startDate.toISOString()).toBe('2026-01-15T00:00:00.000Z');
    });
  });

  describe('calculateDeadline', () => {
    it('calculates TW deadline correctly with constructive service date', () => {
      const result = calculateDeadline(
        {
          jurisdiction: 'TW',
          trigger_type: 'substantive_rejection',
          mailing_date: '2026-01-10T00:00:00Z',
          received_date: '2026-01-18T00:00:00Z',
          extensions_used: 0,
        },
        TW_RULES,
      );

      expect(result).not.toBeNull();
      // Start: Jan 15 (mailing + 5 days)
      // Base due: Apr 15 (+ 3 months)
      expect(result!.start_date).toBe('2026-01-15T00:00:00.000Z');
      expect(result!.base_due_date).toBe('2026-04-15T00:00:00.000Z');
      expect(result!.current_due_date).toBe('2026-04-15T00:00:00.000Z');
      expect(result!.extensions_remaining).toBe(1);
      expect(result!.rule_reference).toBe('專利法施行細則第28條');
    });

    it('calculates US deadline from mailing_date', () => {
      const result = calculateDeadline(
        {
          jurisdiction: 'US',
          trigger_type: 'substantive_rejection',
          mailing_date: '2026-02-01T00:00:00Z',
          received_date: '2026-02-06T00:00:00Z',
          extensions_used: 0,
        },
        US_RULES,
      );

      expect(result).not.toBeNull();
      expect(result!.start_date).toBe('2026-02-01T00:00:00.000Z');
      // Base due: May 1 (+ 3 months)
      expect(result!.base_due_date).toBe('2026-05-01T00:00:00.000Z');
      expect(result!.extensions_remaining).toBe(3);
    });

    it('correctly applies extensions', () => {
      const result = calculateDeadline(
        {
          jurisdiction: 'US',
          trigger_type: 'substantive_rejection',
          mailing_date: '2026-02-01T00:00:00Z',
          received_date: '2026-02-06T00:00:00Z',
          extensions_used: 2,
        },
        US_RULES,
      );

      expect(result).not.toBeNull();
      // 3 months base + 2 * 1 month extension = 5 months
      expect(result!.current_due_date).toBe('2026-07-01T00:00:00.000Z');
      expect(result!.extensions_remaining).toBe(1);
    });

    it('caps at absolute max', () => {
      const result = calculateDeadline(
        {
          jurisdiction: 'US',
          trigger_type: 'substantive_rejection',
          mailing_date: '2026-02-01T00:00:00Z',
          received_date: '2026-02-06T00:00:00Z',
          extensions_used: 3,
        },
        US_RULES,
      );

      expect(result).not.toBeNull();
      // 3 + 3*1 = 6, capped at 6
      expect(result!.current_due_date).toBe('2026-08-01T00:00:00.000Z');
      expect(result!.extensions_remaining).toBe(0);
      expect(result!.next_extension_due_date).toBeNull();
    });

    it('returns null for unknown jurisdiction', () => {
      const result = calculateDeadline(
        {
          jurisdiction: 'JP',
          trigger_type: 'substantive_rejection',
          mailing_date: '2026-02-01T00:00:00Z',
          received_date: '2026-02-06T00:00:00Z',
          extensions_used: 0,
        },
        US_RULES,
      );

      expect(result).toBeNull();
    });
  });

  describe('evaluateDeadline', () => {
    const makeDeadline = (daysFromNow: number, level: number = 0) => ({
      deadline_id: 'dl_1' as DeadlineId,
      case_id: 'case_1' as CaseId,
      tenant_id: 'tenant_1' as TenantId,
      deadline_type: 'statutory' as const,
      source_entity_type: 'office_action' as const,
      source_entity_id: 'oa_1',
      due_date: new Date(Date.now() + daysFromNow * 24 * 60 * 60 * 1000).toISOString(),
      escalation_level: level,
      assigned_attorney_id: 'atty_1' as ActorId,
      assigned_associate_id: null,
    });

    it('returns null when deadline is far away', () => {
      const result = evaluateDeadline(makeDeadline(60), new Date());
      expect(result).toBeNull();
    });

    it('returns warning at 30 days (level 0)', () => {
      const result = evaluateDeadline(makeDeadline(29), new Date());
      expect(result).not.toBeNull();
      // At 29 days, deadline is within 30-day threshold (level 0).
      // Since current level is already 0, it sends a WARNING, not ESCALATION.
      expect(result!.type).toBe('DEADLINE_WARNING_SENT');
    });

    it('escalates from level 0 to level 1 at 14 days', () => {
      const result = evaluateDeadline(makeDeadline(13), new Date());
      expect(result).not.toBeNull();
      expect(result!.type).toBe('DEADLINE_ESCALATED');
      if (result!.type === 'DEADLINE_ESCALATED') {
        expect(result!.to_level).toBeGreaterThanOrEqual(1);
      }
    });

    it('detects missed deadline', () => {
      const result = evaluateDeadline(makeDeadline(-1), new Date());
      expect(result).not.toBeNull();
      expect(result!.type).toBe('DEADLINE_MISSED');
    });

    it('sends warning at current level', () => {
      const result = evaluateDeadline(makeDeadline(5, 2), new Date());
      expect(result).not.toBeNull();
      // At 5 days and level 2, should send warning at level 2
      expect(result!.type).toBe('DEADLINE_WARNING_SENT');
    });
  });
});
