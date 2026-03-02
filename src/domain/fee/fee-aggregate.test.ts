import { describe, it, expect, beforeEach } from 'vitest';
import { FeeAggregate } from './fee-aggregate.js';
import type {
  CaseId,
  TenantId,
  ActorId,
  CorrelationId,
  CausationId,
  FeeId,
  DeadlineId,
} from '../../shared/types/index.js';

const TENANT = 'tenant_01' as TenantId;
const CASE_ID = 'case_01' as CaseId;
const ACTOR = 'actor_01' as ActorId;
const CORR = 'corr_01' as CorrelationId;
const CAUS = 'caus_01' as CausationId;

function createCmd(overrides: Partial<Parameters<FeeAggregate['createFee']>[0]> = {}) {
  return {
    tenant_id: TENANT,
    case_id: CASE_ID,
    fee_type: 'filing' as const,
    fee_label: 'Patent Filing Fee',
    amount: 1500,
    currency: 'USD',
    due_date: '2025-06-01T00:00:00.000Z',
    grace_period_end: '2025-07-01T00:00:00.000Z',
    late_surcharge_amount: 300,
    deadline_id: null as DeadlineId | null,
    actor_id: ACTOR,
    actor_role: 'paralegal' as const,
    correlation_id: CORR,
    causation_id: CAUS,
    ...overrides,
  };
}

describe('FeeAggregate', () => {
  let agg: FeeAggregate;

  beforeEach(() => {
    agg = new FeeAggregate();
  });

  describe('createFee', () => {
    it('creates a fee in PENDING status', () => {
      agg.createFee(createCmd());
      const state = agg.currentState!;
      expect(state.status).toBe('pending');
      expect(state.fee_type).toBe('filing');
      expect(state.amount).toBe(1500);
      expect(state.currency).toBe('USD');
      expect(state.tenant_id).toBe(TENANT);
    });

    it('emits FEE_CREATED event', () => {
      agg.createFee(createCmd());
      expect(agg.pendingEvents).toHaveLength(1);
      expect(agg.pendingEvents[0].event_type).toBe('FEE_CREATED');
    });

    it('throws on duplicate creation', () => {
      agg.createFee(createCmd());
      expect(() => agg.createFee(createCmd())).toThrow('already exists');
    });

    it('throws on non-positive amount', () => {
      expect(() => agg.createFee(createCmd({ amount: 0 }))).toThrow('must be positive');
      expect(() => agg.createFee(createCmd({ amount: -100 }))).toThrow('must be positive');
    });

    it('stores grace period and late surcharge', () => {
      agg.createFee(createCmd());
      expect(agg.currentState!.grace_period_end).toBe('2025-07-01T00:00:00.000Z');
      expect(agg.currentState!.late_surcharge_amount).toBe(300);
    });
  });

  describe('recordPayment', () => {
    it('marks fee as paid', () => {
      agg.createFee(createCmd());
      const feeId = agg.currentState!.fee_id;

      agg.recordPayment({
        tenant_id: TENANT, case_id: CASE_ID, fee_id: feeId,
        payment_reference: 'PAY-2025-001', paid_at: '2025-05-15T10:00:00.000Z',
        actor_id: ACTOR, actor_role: 'paralegal',
        correlation_id: CORR, causation_id: CAUS,
      });

      expect(agg.currentState!.status).toBe('paid');
      expect(agg.currentState!.paid_at).toBe('2025-05-15T10:00:00.000Z');
      expect(agg.currentState!.payment_reference).toBe('PAY-2025-001');
    });

    it('emits FEE_PAYMENT_RECORDED event', () => {
      agg.createFee(createCmd());
      agg.clearPendingEvents();

      agg.recordPayment({
        tenant_id: TENANT, case_id: CASE_ID, fee_id: agg.currentState!.fee_id,
        payment_reference: 'PAY-001', paid_at: '2025-05-15T10:00:00.000Z',
        actor_id: ACTOR, actor_role: 'paralegal',
        correlation_id: CORR, causation_id: CAUS,
      });

      expect(agg.pendingEvents).toHaveLength(1);
      expect(agg.pendingEvents[0].event_type).toBe('FEE_PAYMENT_RECORDED');
    });

    it('throws when already paid', () => {
      agg.createFee(createCmd());
      const feeId = agg.currentState!.fee_id;
      const payCmd = {
        tenant_id: TENANT, case_id: CASE_ID, fee_id: feeId,
        payment_reference: 'PAY-001', paid_at: '2025-05-15T10:00:00.000Z',
        actor_id: ACTOR, actor_role: 'paralegal' as const,
        correlation_id: CORR, causation_id: CAUS,
      };

      agg.recordPayment(payCmd);
      expect(() => agg.recordPayment(payCmd)).toThrow('already been paid');
    });

    it('throws when fee is waived', () => {
      agg.createFee(createCmd());
      const feeId = agg.currentState!.fee_id;

      agg.waiveFee({
        tenant_id: TENANT, case_id: CASE_ID, fee_id: feeId,
        reason: 'Small entity waiver', actor_id: ACTOR, actor_role: 'partner',
        correlation_id: CORR, causation_id: CAUS,
      });

      expect(() =>
        agg.recordPayment({
          tenant_id: TENANT, case_id: CASE_ID, fee_id: feeId,
          payment_reference: 'PAY-001', paid_at: '2025-05-15T10:00:00.000Z',
          actor_id: ACTOR, actor_role: 'paralegal',
          correlation_id: CORR, causation_id: CAUS,
        }),
      ).toThrow('waived and cannot be paid');
    });
  });

  describe('waiveFee', () => {
    it('marks fee as waived', () => {
      agg.createFee(createCmd());
      const feeId = agg.currentState!.fee_id;

      agg.waiveFee({
        tenant_id: TENANT, case_id: CASE_ID, fee_id: feeId,
        reason: 'Small entity waiver', actor_id: ACTOR, actor_role: 'partner',
        correlation_id: CORR, causation_id: CAUS,
      });

      expect(agg.currentState!.status).toBe('waived');
      expect(agg.currentState!.waived_by).toBe(ACTOR);
      expect(agg.currentState!.waive_reason).toBe('Small entity waiver');
    });

    it('emits FEE_WAIVED event', () => {
      agg.createFee(createCmd());
      agg.clearPendingEvents();

      agg.waiveFee({
        tenant_id: TENANT, case_id: CASE_ID, fee_id: agg.currentState!.fee_id,
        reason: 'test', actor_id: ACTOR, actor_role: 'partner',
        correlation_id: CORR, causation_id: CAUS,
      });

      expect(agg.pendingEvents).toHaveLength(1);
      expect(agg.pendingEvents[0].event_type).toBe('FEE_WAIVED');
    });

    it('throws when already paid', () => {
      agg.createFee(createCmd());
      const feeId = agg.currentState!.fee_id;

      agg.recordPayment({
        tenant_id: TENANT, case_id: CASE_ID, fee_id: feeId,
        payment_reference: 'PAY-001', paid_at: '2025-05-15T10:00:00.000Z',
        actor_id: ACTOR, actor_role: 'paralegal',
        correlation_id: CORR, causation_id: CAUS,
      });

      expect(() =>
        agg.waiveFee({
          tenant_id: TENANT, case_id: CASE_ID, fee_id: feeId,
          reason: 'test', actor_id: ACTOR, actor_role: 'partner',
          correlation_id: CORR, causation_id: CAUS,
        }),
      ).toThrow('already been paid');
    });

    it('throws when already waived', () => {
      agg.createFee(createCmd());
      const feeId = agg.currentState!.fee_id;
      const waiveCmd = {
        tenant_id: TENANT, case_id: CASE_ID, fee_id: feeId,
        reason: 'test', actor_id: ACTOR, actor_role: 'partner' as const,
        correlation_id: CORR, causation_id: CAUS,
      };

      agg.waiveFee(waiveCmd);
      expect(() => agg.waiveFee(waiveCmd)).toThrow('already been waived');
    });
  });

  describe('isOverdue', () => {
    it('returns true when past due date and still pending', () => {
      agg.createFee(createCmd({ due_date: '2024-01-01T00:00:00.000Z' }));
      expect(agg.isOverdue(new Date('2024-06-01'))).toBe(true);
    });

    it('returns false when before due date', () => {
      agg.createFee(createCmd({ due_date: '2030-01-01T00:00:00.000Z' }));
      expect(agg.isOverdue(new Date('2025-01-01'))).toBe(false);
    });

    it('returns false when already paid', () => {
      agg.createFee(createCmd({ due_date: '2024-01-01T00:00:00.000Z' }));
      agg.recordPayment({
        tenant_id: TENANT, case_id: CASE_ID, fee_id: agg.currentState!.fee_id,
        payment_reference: 'PAY-001', paid_at: '2023-12-15T10:00:00.000Z',
        actor_id: ACTOR, actor_role: 'paralegal',
        correlation_id: CORR, causation_id: CAUS,
      });
      expect(agg.isOverdue(new Date('2024-06-01'))).toBe(false);
    });
  });

  describe('isInGracePeriod', () => {
    it('returns true when past due date but within grace period', () => {
      agg.createFee(createCmd({
        due_date: '2025-06-01T00:00:00.000Z',
        grace_period_end: '2025-07-01T00:00:00.000Z',
      }));
      expect(agg.isInGracePeriod(new Date('2025-06-15'))).toBe(true);
    });

    it('returns false when past grace period', () => {
      agg.createFee(createCmd({
        due_date: '2025-06-01T00:00:00.000Z',
        grace_period_end: '2025-07-01T00:00:00.000Z',
      }));
      expect(agg.isInGracePeriod(new Date('2025-08-01'))).toBe(false);
    });

    it('returns false when no grace period defined', () => {
      agg.createFee(createCmd({ grace_period_end: null }));
      expect(agg.isInGracePeriod(new Date('2025-06-15'))).toBe(false);
    });
  });

  describe('loadFromHistory', () => {
    it('reconstructs state from events', () => {
      agg.createFee(createCmd());
      const feeId = agg.currentState!.fee_id;

      agg.recordPayment({
        tenant_id: TENANT, case_id: CASE_ID, fee_id: feeId,
        payment_reference: 'PAY-001', paid_at: '2025-05-15T10:00:00.000Z',
        actor_id: ACTOR, actor_role: 'paralegal',
        correlation_id: CORR, causation_id: CAUS,
      });

      const events = agg.pendingEvents;

      const newAgg = new FeeAggregate();
      newAgg.loadFromHistory(events);

      expect(newAgg.currentState!.status).toBe('paid');
      expect(newAgg.currentState!.fee_id).toBe(feeId);
      expect(newAgg.currentState!.payment_reference).toBe('PAY-001');
    });
  });
});
