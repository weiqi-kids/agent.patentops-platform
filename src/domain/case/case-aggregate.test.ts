import { describe, it, expect } from 'vitest';
import { CaseAggregate } from './case-aggregate.js';
import type {
  TenantId,
  ActorId,
  CorrelationId,
  CausationId,
  CaseId,
} from '../../shared/types/index.js';

const T = 'tenant_1' as TenantId;
const ACTOR = 'actor_1' as ActorId;
const CORR = 'corr_1' as CorrelationId;
const CAUS = 'caus_1' as CausationId;

function createTestCase(): CaseAggregate {
  const agg = new CaseAggregate();
  agg.createCase({
    tenant_id: T,
    title: '測試專利申請案',
    patent_type: 'invention',
    applicant_id: ACTOR,
    inventor_ids: [ACTOR],
    assigned_attorney_id: ACTOR,
    jurisdiction: 'TW',
    priority_date: null,
    parent_case_id: null,
    actor_id: ACTOR,
    actor_role: 'partner',
    correlation_id: CORR,
  });
  return agg;
}

describe('Case Aggregate', () => {
  describe('createCase', () => {
    it('creates case in INTAKE status', () => {
      const agg = createTestCase();
      expect(agg.currentState).not.toBeNull();
      expect(agg.currentState!.status).toBe('INTAKE');
      expect(agg.currentState!.title).toBe('測試專利申請案');
      expect(agg.currentState!.patent_type).toBe('invention');
      expect(agg.currentState!.jurisdiction).toBe('TW');
    });

    it('emits CASE_CREATED event', () => {
      const agg = createTestCase();
      expect(agg.pendingEvents).toHaveLength(1);
      expect(agg.pendingEvents[0].event_type).toBe('CASE_CREATED');
    });

    it('throws if case already exists', () => {
      const agg = createTestCase();
      expect(() => agg.createCase({
        tenant_id: T,
        title: '另一個案件',
        patent_type: 'invention',
        applicant_id: ACTOR,
        inventor_ids: [ACTOR],
        assigned_attorney_id: ACTOR,
        jurisdiction: 'TW',
        priority_date: null,
        parent_case_id: null,
        actor_id: ACTOR,
        actor_role: 'partner',
        correlation_id: CORR,
      })).toThrow('Case already exists');
    });

    it('sets new fields correctly (application_number, patent_number, etc.)', () => {
      const agg = createTestCase();
      expect(agg.currentState!.application_number).toBeNull();
      expect(agg.currentState!.patent_number).toBeNull();
      expect(agg.currentState!.grant_date).toBeNull();
      expect(agg.currentState!.examination_requested_date).toBeNull();
    });
  });

  describe('changeStatus', () => {
    it('transitions INTAKE → DRAFTING', () => {
      const agg = createTestCase();
      agg.clearPendingEvents();
      agg.changeStatus({
        tenant_id: T,
        case_id: agg.currentState!.case_id,
        to_state: 'DRAFTING',
        reason: null,
        actor_id: ACTOR,
        actor_role: 'partner',
        correlation_id: CORR,
        causation_id: CAUS,
      });
      expect(agg.currentState!.status).toBe('DRAFTING');
      expect(agg.pendingEvents).toHaveLength(1);
      expect(agg.pendingEvents[0].event_type).toBe('CASE_STATUS_CHANGED');
    });

    it('rejects invalid transition', () => {
      const agg = createTestCase();
      expect(() => agg.changeStatus({
        tenant_id: T,
        case_id: agg.currentState!.case_id,
        to_state: 'FILED',
        reason: null,
        actor_id: ACTOR,
        actor_role: 'partner',
        correlation_id: CORR,
        causation_id: CAUS,
      })).toThrow('Invalid state transition');
    });

    it('rejects unauthorized role', () => {
      const agg = createTestCase();
      expect(() => agg.changeStatus({
        tenant_id: T,
        case_id: agg.currentState!.case_id,
        to_state: 'DRAFTING',
        reason: null,
        actor_id: ACTOR,
        actor_role: 'client',
        correlation_id: CORR,
        causation_id: CAUS,
      })).toThrow('not permitted');
    });
  });

  describe('full lifecycle', () => {
    it('follows INTAKE → DRAFTING → REVIEW → FILING → FILED → ALLOWED → GRANTED', () => {
      const agg = createTestCase();
      const caseId = agg.currentState!.case_id;

      const transition = (to: string, role: string = 'partner') => {
        agg.changeStatus({
          tenant_id: T,
          case_id: caseId,
          to_state: to as any,
          reason: null,
          actor_id: ACTOR,
          actor_role: role as any,
          correlation_id: CORR,
          causation_id: CAUS,
        });
      };

      transition('DRAFTING');
      expect(agg.currentState!.status).toBe('DRAFTING');

      transition('REVIEW');
      expect(agg.currentState!.status).toBe('REVIEW');

      transition('FILING', 'reviewer');
      expect(agg.currentState!.status).toBe('FILING');

      transition('FILED', 'paralegal');
      expect(agg.currentState!.status).toBe('FILED');

      transition('ALLOWED', 'system');
      expect(agg.currentState!.status).toBe('ALLOWED');

      transition('GRANTED', 'system');
      expect(agg.currentState!.status).toBe('GRANTED');
    });

    it('supports OA cycle: FILED → OA_RECEIVED → FILED → ALLOWED', () => {
      const agg = createTestCase();
      const caseId = agg.currentState!.case_id;

      const transition = (to: string, role: string = 'partner') => {
        agg.changeStatus({
          tenant_id: T,
          case_id: caseId,
          to_state: to as any,
          reason: null,
          actor_id: ACTOR,
          actor_role: role as any,
          correlation_id: CORR,
          causation_id: CAUS,
        });
      };

      transition('DRAFTING');
      transition('REVIEW');
      transition('FILING', 'reviewer');
      transition('FILED', 'system');

      // First OA
      transition('OA_RECEIVED', 'system');
      expect(agg.currentState!.status).toBe('OA_RECEIVED');

      // Response filed
      transition('FILED', 'reviewer');
      expect(agg.currentState!.status).toBe('FILED');

      // Allowed
      transition('ALLOWED', 'system');
      expect(agg.currentState!.status).toBe('ALLOWED');
    });
  });

  describe('closeCase', () => {
    it('closes case with reason', () => {
      const agg = createTestCase();
      agg.closeCase({
        tenant_id: T,
        case_id: agg.currentState!.case_id,
        close_reason: 'withdrawn',
        actor_id: ACTOR,
        actor_role: 'partner',
        correlation_id: CORR,
        causation_id: CAUS,
      });
      expect(agg.currentState!.status).toBe('CLOSED');
      expect(agg.currentState!.close_reason).toBe('withdrawn');
    });
  });

  describe('recordFilingReceipt', () => {
    it('records application number and filing date', () => {
      const agg = createTestCase();
      const caseId = agg.currentState!.case_id;

      // Move to FILED first
      agg.changeStatus({ tenant_id: T, case_id: caseId, to_state: 'DRAFTING', reason: null, actor_id: ACTOR, actor_role: 'partner', correlation_id: CORR, causation_id: CAUS });
      agg.changeStatus({ tenant_id: T, case_id: caseId, to_state: 'REVIEW', reason: null, actor_id: ACTOR, actor_role: 'partner', correlation_id: CORR, causation_id: CAUS });
      agg.changeStatus({ tenant_id: T, case_id: caseId, to_state: 'FILING', reason: null, actor_id: ACTOR, actor_role: 'reviewer', correlation_id: CORR, causation_id: CAUS });
      agg.changeStatus({ tenant_id: T, case_id: caseId, to_state: 'FILED', reason: null, actor_id: ACTOR, actor_role: 'system', correlation_id: CORR, causation_id: CAUS });

      agg.recordFilingReceipt({
        tenant_id: T,
        case_id: caseId,
        application_number: '111234567',
        filing_date: '2026-03-01T00:00:00Z',
        filing_reference: null,
        actor_id: ACTOR,
        actor_role: 'paralegal',
        correlation_id: CORR,
        causation_id: CAUS,
      });

      expect(agg.currentState!.application_number).toBe('111234567');
      expect(agg.currentState!.filing_date).toBe('2026-03-01T00:00:00Z');
    });
  });

  describe('event replay', () => {
    it('reconstructs state from event history', () => {
      const agg1 = createTestCase();
      const caseId = agg1.currentState!.case_id;
      agg1.changeStatus({
        tenant_id: T,
        case_id: caseId,
        to_state: 'DRAFTING',
        reason: 'Accepted',
        actor_id: ACTOR,
        actor_role: 'partner',
        correlation_id: CORR,
        causation_id: CAUS,
      });

      const events = agg1.pendingEvents;

      // Replay into new aggregate
      const agg2 = new CaseAggregate();
      agg2.loadFromHistory(events);

      expect(agg2.currentState).not.toBeNull();
      expect(agg2.currentState!.case_id).toBe(caseId);
      expect(agg2.currentState!.status).toBe('DRAFTING');
      expect(agg2.currentState!.title).toBe('測試專利申請案');
    });
  });
});
