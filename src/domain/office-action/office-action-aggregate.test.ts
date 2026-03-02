import { describe, it, expect, beforeEach } from 'vitest';
import { OfficeActionAggregate } from './office-action-aggregate.js';
import type {
  CaseId,
  TenantId,
  ActorId,
  CorrelationId,
  CausationId,
  OfficeActionId,
  ClaimId,
  DocumentId,
} from '../../shared/types/index.js';

const TENANT = 'tenant_01' as TenantId;
const CASE_ID = 'case_01' as CaseId;
const ACTOR = 'actor_01' as ActorId;
const CORR = 'corr_01' as CorrelationId;
const CAUS = 'caus_01' as CausationId;

function receiveCmd() {
  return {
    tenant_id: TENANT,
    case_id: CASE_ID,
    oa_category: 'substantive_rejection' as const,
    oa_type_label: 'Non-Final Office Action',
    mailing_date: '2024-06-01T00:00:00.000Z',
    received_date: '2024-06-05T00:00:00.000Z',
    response_deadline: '2024-09-05T00:00:00.000Z',
    rejection_bases: ['novelty' as const, 'inventive_step' as const],
    statutory_references: ['35 USC §102', '35 USC §103'],
    cited_references: [
      {
        reference_id: 'ref_01',
        publication_number: 'US-1234567-A1',
        title: 'Prior Art Patent',
        relevant_claims: [1, 3],
        relevance_summary: 'Teaches claimed method',
      },
    ],
    sequence_number: 1,
    actor_id: ACTOR,
    actor_role: 'paralegal' as const,
    correlation_id: CORR,
    causation_id: CAUS,
  };
}

describe('OfficeActionAggregate', () => {
  let agg: OfficeActionAggregate;

  beforeEach(() => {
    agg = new OfficeActionAggregate();
  });

  describe('receiveOa', () => {
    it('creates an office action in RECEIVED status', () => {
      agg.receiveOa(receiveCmd());

      const state = agg.currentState!;
      expect(state.status).toBe('received');
      expect(state.oa_category).toBe('substantive_rejection');
      expect(state.rejection_bases).toEqual(['novelty', 'inventive_step']);
      expect(state.cited_references).toHaveLength(1);
      expect(state.sequence_number).toBe(1);
      expect(state.tenant_id).toBe(TENANT);
    });

    it('emits OA_RECEIVED event', () => {
      agg.receiveOa(receiveCmd());
      expect(agg.pendingEvents).toHaveLength(1);
      expect(agg.pendingEvents[0].event_type).toBe('OA_RECEIVED');
    });

    it('throws if OA already exists', () => {
      agg.receiveOa(receiveCmd());
      expect(() => agg.receiveOa(receiveCmd())).toThrow('already exists');
    });
  });

  describe('transitionStatus', () => {
    it('transitions from received to analyzing', () => {
      agg.receiveOa(receiveCmd());
      const oaId = agg.currentState!.oa_id;

      agg.transitionStatus({
        tenant_id: TENANT,
        case_id: CASE_ID,
        oa_id: oaId,
        to_status: 'analyzing',
        actor_id: ACTOR,
        actor_role: 'associate',
        correlation_id: CORR,
        causation_id: CAUS,
      });

      expect(agg.currentState!.status).toBe('analyzing');
    });

    it('rejects invalid transitions', () => {
      agg.receiveOa(receiveCmd());
      const oaId = agg.currentState!.oa_id;

      expect(() =>
        agg.transitionStatus({
          tenant_id: TENANT,
          case_id: CASE_ID,
          oa_id: oaId,
          to_status: 'filed',
          actor_id: ACTOR,
          actor_role: 'associate',
          correlation_id: CORR,
          causation_id: CAUS,
        }),
      ).toThrow('Invalid OA transition');
    });

    it('rejects transitions for unauthorized roles', () => {
      agg.receiveOa(receiveCmd());
      const oaId = agg.currentState!.oa_id;

      expect(() =>
        agg.transitionStatus({
          tenant_id: TENANT,
          case_id: CASE_ID,
          oa_id: oaId,
          to_status: 'analyzing',
          actor_id: ACTOR,
          actor_role: 'client',
          correlation_id: CORR,
          causation_id: CAUS,
        }),
      ).toThrow("Role 'client' is not permitted");
    });
  });

  describe('recordAnalysis', () => {
    it('records AI analysis at analyzing stage', () => {
      agg.receiveOa(receiveCmd());
      const oaId = agg.currentState!.oa_id;

      // Transition to analyzing
      agg.transitionStatus({
        tenant_id: TENANT, case_id: CASE_ID, oa_id: oaId,
        to_status: 'analyzing', actor_id: ACTOR, actor_role: 'associate',
        correlation_id: CORR, causation_id: CAUS,
      });

      agg.recordAnalysis({
        tenant_id: TENANT, case_id: CASE_ID, oa_id: oaId,
        rejection_classification: 'novelty + obviousness',
        claim_limitation_mapping: { 'claim_1': ['limitation_a', 'limitation_b'] },
        amendment_strategies: [
          {
            strategy_id: 'strat_01',
            description: 'Narrow claim 1 to distinguish over prior art',
            risk_rating: 'medium',
            reasoning: 'Adds specificity while maintaining scope',
          },
        ],
        ai_model_used: 'claude-opus-4-6',
        actor_id: ACTOR, actor_role: 'system',
        correlation_id: CORR, causation_id: CAUS,
      });

      expect(agg.currentState!.risk_rating).toBe('medium');
    });

    it('throws when not in analyzing status', () => {
      agg.receiveOa(receiveCmd());
      const oaId = agg.currentState!.oa_id;

      expect(() =>
        agg.recordAnalysis({
          tenant_id: TENANT, case_id: CASE_ID, oa_id: oaId,
          rejection_classification: 'test',
          claim_limitation_mapping: {},
          amendment_strategies: [],
          ai_model_used: 'test',
          actor_id: ACTOR, actor_role: 'system',
          correlation_id: CORR, causation_id: CAUS,
        }),
      ).toThrow("status 'received', expected one of: analyzing");
    });
  });

  describe('selectStrategy', () => {
    it('records selected strategy at strategizing stage', () => {
      agg.receiveOa(receiveCmd());
      const oaId = agg.currentState!.oa_id;

      // received → analyzing → strategizing
      agg.transitionStatus({
        tenant_id: TENANT, case_id: CASE_ID, oa_id: oaId,
        to_status: 'analyzing', actor_id: ACTOR, actor_role: 'associate',
        correlation_id: CORR, causation_id: CAUS,
      });
      agg.transitionStatus({
        tenant_id: TENANT, case_id: CASE_ID, oa_id: oaId,
        to_status: 'strategizing', actor_id: ACTOR, actor_role: 'associate',
        correlation_id: CORR, causation_id: CAUS,
      });

      agg.selectStrategy({
        tenant_id: TENANT, case_id: CASE_ID, oa_id: oaId,
        selected_strategy_id: 'strat_01',
        actor_id: ACTOR, actor_role: 'associate',
        correlation_id: CORR, causation_id: CAUS,
      });

      expect(agg.currentState!.selected_strategy_id).toBe('strat_01');
    });
  });

  describe('recordAmendmentDraft', () => {
    it('records drafted amendments at amending stage', () => {
      agg.receiveOa(receiveCmd());
      const oaId = agg.currentState!.oa_id;

      // Skip to amending (received → amending allowed for reviewer/partner)
      agg.transitionStatus({
        tenant_id: TENANT, case_id: CASE_ID, oa_id: oaId,
        to_status: 'amending', actor_id: ACTOR, actor_role: 'partner',
        correlation_id: CORR, causation_id: CAUS,
      });

      const claimIds = ['claim_01' as ClaimId, 'claim_03' as ClaimId];
      agg.recordAmendmentDraft({
        tenant_id: TENANT, case_id: CASE_ID, oa_id: oaId,
        claim_ids: claimIds, ai_assisted: true,
        actor_id: ACTOR, actor_role: 'associate',
        correlation_id: CORR, causation_id: CAUS,
      });

      expect(agg.currentState!.amendment_claim_ids).toEqual(claimIds);
    });
  });

  describe('recordReview', () => {
    it('records review decision at review stage', () => {
      agg.receiveOa(receiveCmd());
      const oaId = agg.currentState!.oa_id;

      // received → amending → review
      agg.transitionStatus({
        tenant_id: TENANT, case_id: CASE_ID, oa_id: oaId,
        to_status: 'amending', actor_id: ACTOR, actor_role: 'partner',
        correlation_id: CORR, causation_id: CAUS,
      });
      agg.transitionStatus({
        tenant_id: TENANT, case_id: CASE_ID, oa_id: oaId,
        to_status: 'review', actor_id: ACTOR, actor_role: 'associate',
        correlation_id: CORR, causation_id: CAUS,
      });

      agg.recordReview({
        tenant_id: TENANT, case_id: CASE_ID, oa_id: oaId,
        approved: true, comments: 'Looks good, approved for filing',
        actor_id: ACTOR, actor_role: 'reviewer',
        correlation_id: CORR, causation_id: CAUS,
      });

      expect(agg.currentState!.review_approved).toBe(true);
    });
  });

  describe('fileResponse', () => {
    it('files OA response from review status', () => {
      agg.receiveOa(receiveCmd());
      const oaId = agg.currentState!.oa_id;

      // received → amending → review → filed
      agg.transitionStatus({
        tenant_id: TENANT, case_id: CASE_ID, oa_id: oaId,
        to_status: 'amending', actor_id: ACTOR, actor_role: 'partner',
        correlation_id: CORR, causation_id: CAUS,
      });
      agg.transitionStatus({
        tenant_id: TENANT, case_id: CASE_ID, oa_id: oaId,
        to_status: 'review', actor_id: ACTOR, actor_role: 'associate',
        correlation_id: CORR, causation_id: CAUS,
      });

      agg.fileResponse({
        tenant_id: TENANT, case_id: CASE_ID, oa_id: oaId,
        document_id: 'doc_01' as DocumentId,
        filed_hash: 'abc123hash',
        actor_id: ACTOR, actor_role: 'partner',
        correlation_id: CORR, causation_id: CAUS,
      });

      expect(agg.currentState!.status).toBe('filed');
      expect(agg.currentState!.filed_document_id).toBe('doc_01');
      expect(agg.currentState!.filed_hash).toBe('abc123hash');
    });

    it('rejects filing from non-review status', () => {
      agg.receiveOa(receiveCmd());
      const oaId = agg.currentState!.oa_id;

      expect(() =>
        agg.fileResponse({
          tenant_id: TENANT, case_id: CASE_ID, oa_id: oaId,
          document_id: 'doc_01' as DocumentId,
          filed_hash: 'abc123hash',
          actor_id: ACTOR, actor_role: 'partner',
          correlation_id: CORR, causation_id: CAUS,
        }),
      ).toThrow("status 'received', expected 'review'");
    });
  });

  describe('loadFromHistory', () => {
    it('reconstructs state from event replay', () => {
      agg.receiveOa(receiveCmd());
      const oaId = agg.currentState!.oa_id;

      agg.transitionStatus({
        tenant_id: TENANT, case_id: CASE_ID, oa_id: oaId,
        to_status: 'amending', actor_id: ACTOR, actor_role: 'partner',
        correlation_id: CORR, causation_id: CAUS,
      });

      const events = agg.pendingEvents;

      const newAgg = new OfficeActionAggregate();
      newAgg.loadFromHistory(events);

      expect(newAgg.currentState!.status).toBe('amending');
      expect(newAgg.currentState!.oa_id).toBe(oaId);
      expect(newAgg.currentState!.oa_category).toBe('substantive_rejection');
    });
  });

  describe('full workflow', () => {
    it('completes the entire OA response lifecycle', () => {
      // 1. Receive OA
      agg.receiveOa(receiveCmd());
      const oaId = agg.currentState!.oa_id;
      expect(agg.currentState!.status).toBe('received');

      // 2. Start analysis
      agg.transitionStatus({
        tenant_id: TENANT, case_id: CASE_ID, oa_id: oaId,
        to_status: 'analyzing', actor_id: ACTOR, actor_role: 'associate',
        correlation_id: CORR, causation_id: CAUS,
      });
      expect(agg.currentState!.status).toBe('analyzing');

      // 3. Record analysis
      agg.recordAnalysis({
        tenant_id: TENANT, case_id: CASE_ID, oa_id: oaId,
        rejection_classification: 'novelty',
        claim_limitation_mapping: { 'claim_1': ['limitation_a'] },
        amendment_strategies: [{
          strategy_id: 'strat_01', description: 'Narrow claims',
          risk_rating: 'low', reasoning: 'Strong distinguishing features',
        }],
        ai_model_used: 'claude-opus-4-6',
        actor_id: ACTOR, actor_role: 'system',
        correlation_id: CORR, causation_id: CAUS,
      });

      // 4. Move to strategizing
      agg.transitionStatus({
        tenant_id: TENANT, case_id: CASE_ID, oa_id: oaId,
        to_status: 'strategizing', actor_id: ACTOR, actor_role: 'associate',
        correlation_id: CORR, causation_id: CAUS,
      });

      // 5. Select strategy
      agg.selectStrategy({
        tenant_id: TENANT, case_id: CASE_ID, oa_id: oaId,
        selected_strategy_id: 'strat_01',
        actor_id: ACTOR, actor_role: 'associate',
        correlation_id: CORR, causation_id: CAUS,
      });

      // 6. Move to amending
      agg.transitionStatus({
        tenant_id: TENANT, case_id: CASE_ID, oa_id: oaId,
        to_status: 'amending', actor_id: ACTOR, actor_role: 'associate',
        correlation_id: CORR, causation_id: CAUS,
      });

      // 7. Draft amendments
      agg.recordAmendmentDraft({
        tenant_id: TENANT, case_id: CASE_ID, oa_id: oaId,
        claim_ids: ['claim_01' as ClaimId], ai_assisted: false,
        actor_id: ACTOR, actor_role: 'associate',
        correlation_id: CORR, causation_id: CAUS,
      });

      // 8. Submit for review
      agg.transitionStatus({
        tenant_id: TENANT, case_id: CASE_ID, oa_id: oaId,
        to_status: 'review', actor_id: ACTOR, actor_role: 'associate',
        correlation_id: CORR, causation_id: CAUS,
      });

      // 9. Review and approve
      agg.recordReview({
        tenant_id: TENANT, case_id: CASE_ID, oa_id: oaId,
        approved: true, comments: null,
        actor_id: ACTOR, actor_role: 'reviewer',
        correlation_id: CORR, causation_id: CAUS,
      });

      // 10. File response
      agg.fileResponse({
        tenant_id: TENANT, case_id: CASE_ID, oa_id: oaId,
        document_id: 'doc_response' as DocumentId,
        filed_hash: 'sha256_filed_response',
        actor_id: ACTOR, actor_role: 'partner',
        correlation_id: CORR, causation_id: CAUS,
      });

      expect(agg.currentState!.status).toBe('filed');
      expect(agg.currentState!.filed_hash).toBe('sha256_filed_response');
      // 10 commands = at least 10 events
      expect(agg.pendingEvents.length).toBeGreaterThanOrEqual(10);
    });
  });
});
