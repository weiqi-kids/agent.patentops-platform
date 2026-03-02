/**
 * Claim Aggregate — Unit Tests
 *
 * Tests for claim creation, amendment, status transitions,
 * dependency validation, and event replay.
 */

import { describe, it, expect } from 'vitest';
import { ClaimAggregate } from './claim-aggregate.js';
import type {
  TenantId,
  CaseId,
  ClaimId,
  ActorId,
  CorrelationId,
  CausationId,
} from '../../shared/types/index.js';

const T = 'tenant_1' as TenantId;
const CASE = 'case_1' as CaseId;
const ACTOR = 'actor_1' as ActorId;
const CORR = 'corr_1' as CorrelationId;
const CAUS = 'caus_1' as CausationId;

function createBasicClaim(agg: ClaimAggregate, num: number = 1): ClaimId {
  return agg.createClaim({
    tenant_id: T,
    case_id: CASE,
    claim_number: num,
    claim_type: 'independent',
    claim_category: 'method',
    depends_on_claim_id: null,
    claim_text: `A method of processing data comprising step ${num}.`,
    ai_generated: false,
    actor_id: ACTOR,
    actor_role: 'associate',
    correlation_id: CORR,
    causation_id: CAUS,
  });
}

describe('Claim Aggregate', () => {
  describe('createClaim', () => {
    it('creates an independent claim', () => {
      const agg = new ClaimAggregate();
      const claimId = createBasicClaim(agg);

      expect(claimId).toBeDefined();
      expect(agg.allClaims).toHaveLength(1);

      const claim = agg.getClaim(claimId);
      expect(claim).not.toBeUndefined();
      expect(claim!.claim_number).toBe(1);
      expect(claim!.claim_type).toBe('independent');
      expect(claim!.claim_category).toBe('method');
      expect(claim!.status).toBe('draft');
      expect(claim!.version).toBe(1);
      expect(claim!.ai_generated).toBe(false);
    });

    it('emits CLAIM_CREATED event', () => {
      const agg = new ClaimAggregate();
      createBasicClaim(agg);

      expect(agg.pendingEvents).toHaveLength(1);
      expect(agg.pendingEvents[0].event_type).toBe('CLAIM_CREATED');
      expect(agg.pendingEvents[0].tenant_id).toBe(T);
      expect(agg.pendingEvents[0].case_id).toBe(CASE);
    });

    it('creates a dependent claim', () => {
      const agg = new ClaimAggregate();
      const parentId = createBasicClaim(agg);

      const depId = agg.createClaim({
        tenant_id: T,
        case_id: CASE,
        claim_number: 2,
        claim_type: 'dependent',
        claim_category: 'method',
        depends_on_claim_id: parentId,
        claim_text: 'The method of claim 1, further comprising step X.',
        ai_generated: false,
        actor_id: ACTOR,
        actor_role: 'associate',
        correlation_id: CORR,
        causation_id: CAUS,
      });

      const dep = agg.getClaim(depId);
      expect(dep).not.toBeUndefined();
      expect(dep!.claim_type).toBe('dependent');
      expect(dep!.depends_on_claim_id).toBe(parentId);
    });

    it('rejects dependent claim without parent reference', () => {
      const agg = new ClaimAggregate();
      expect(() =>
        agg.createClaim({
          tenant_id: T,
          case_id: CASE,
          claim_number: 1,
          claim_type: 'dependent',
          claim_category: 'method',
          depends_on_claim_id: null,
          claim_text: 'Depends on nothing.',
          ai_generated: false,
          actor_id: ACTOR,
          actor_role: 'associate',
          correlation_id: CORR,
          causation_id: CAUS,
        }),
      ).toThrow('Dependent claims must specify depends_on_claim_id');
    });

    it('rejects dependent claim with non-existent parent', () => {
      const agg = new ClaimAggregate();
      expect(() =>
        agg.createClaim({
          tenant_id: T,
          case_id: CASE,
          claim_number: 1,
          claim_type: 'dependent',
          claim_category: 'method',
          depends_on_claim_id: 'nonexistent' as ClaimId,
          claim_text: 'Bad parent.',
          ai_generated: false,
          actor_id: ACTOR,
          actor_role: 'associate',
          correlation_id: CORR,
          causation_id: CAUS,
        }),
      ).toThrow('Parent claim nonexistent not found');
    });

    it('rejects duplicate claim numbers', () => {
      const agg = new ClaimAggregate();
      createBasicClaim(agg, 1);

      expect(() => createBasicClaim(agg, 1)).toThrow(
        'Claim number 1 already exists',
      );
    });

    it('creates AI-generated claim', () => {
      const agg = new ClaimAggregate();
      const claimId = agg.createClaim({
        tenant_id: T,
        case_id: CASE,
        claim_number: 1,
        claim_type: 'independent',
        claim_category: 'apparatus',
        depends_on_claim_id: null,
        claim_text: 'An apparatus comprising a processor configured to...',
        ai_generated: true,
        actor_id: ACTOR,
        actor_role: 'associate',
        correlation_id: CORR,
        causation_id: CAUS,
      });

      expect(agg.getClaim(claimId)!.ai_generated).toBe(true);
    });

    it('allows reusing cancelled claim numbers', () => {
      const agg = new ClaimAggregate();
      const claimId = createBasicClaim(agg, 1);

      agg.changeClaimStatus({
        tenant_id: T,
        case_id: CASE,
        claim_id: claimId,
        to_status: 'cancelled',
        actor_id: ACTOR,
        actor_role: 'associate',
        correlation_id: CORR,
        causation_id: CAUS,
      });

      // Should not throw — number 1 is cancelled
      const newId = createBasicClaim(agg, 1);
      expect(newId).toBeDefined();
    });
  });

  describe('amendClaim', () => {
    it('amends a claim with new text', () => {
      const agg = new ClaimAggregate();
      const claimId = createBasicClaim(agg);

      agg.amendClaim({
        tenant_id: T,
        case_id: CASE,
        claim_id: claimId,
        new_text: 'A method of processing data comprising improved step 1.',
        amendment_reason: 'Narrowing to overcome prior art',
        actor_id: ACTOR,
        actor_role: 'associate',
        correlation_id: CORR,
        causation_id: CAUS,
      });

      const claim = agg.getClaim(claimId);
      expect(claim!.version).toBe(2);
      expect(claim!.claim_text).toContain('improved step 1');
      expect(claim!.status).toBe('amended');
    });

    it('emits CLAIM_AMENDED event', () => {
      const agg = new ClaimAggregate();
      const claimId = createBasicClaim(agg);
      agg.clearPendingEvents();

      agg.amendClaim({
        tenant_id: T,
        case_id: CASE,
        claim_id: claimId,
        new_text: 'New text.',
        amendment_reason: 'Narrowing',
        actor_id: ACTOR,
        actor_role: 'associate',
        correlation_id: CORR,
        causation_id: CAUS,
      });

      expect(agg.pendingEvents).toHaveLength(1);
      expect(agg.pendingEvents[0].event_type).toBe('CLAIM_AMENDED');
    });

    it('rejects amendment on cancelled claim', () => {
      const agg = new ClaimAggregate();
      const claimId = createBasicClaim(agg);

      agg.changeClaimStatus({
        tenant_id: T,
        case_id: CASE,
        claim_id: claimId,
        to_status: 'cancelled',
        actor_id: ACTOR,
        actor_role: 'associate',
        correlation_id: CORR,
        causation_id: CAUS,
      });

      expect(() =>
        agg.amendClaim({
          tenant_id: T,
          case_id: CASE,
          claim_id: claimId,
          new_text: 'Cannot amend.',
          amendment_reason: 'Should fail',
          actor_id: ACTOR,
          actor_role: 'associate',
          correlation_id: CORR,
          causation_id: CAUS,
        }),
      ).toThrow('Cannot amend a cancelled claim');
    });

    it('rejects amendment with identical text', () => {
      const agg = new ClaimAggregate();
      const claimId = createBasicClaim(agg);
      const currentText = agg.getClaim(claimId)!.claim_text;

      expect(() =>
        agg.amendClaim({
          tenant_id: T,
          case_id: CASE,
          claim_id: claimId,
          new_text: currentText,
          amendment_reason: 'No change',
          actor_id: ACTOR,
          actor_role: 'associate',
          correlation_id: CORR,
          causation_id: CAUS,
        }),
      ).toThrow('Amendment text is identical to current text');
    });

    it('rejects amendment on non-existent claim', () => {
      const agg = new ClaimAggregate();
      expect(() =>
        agg.amendClaim({
          tenant_id: T,
          case_id: CASE,
          claim_id: 'nonexistent' as ClaimId,
          new_text: 'New text.',
          amendment_reason: 'Should fail',
          actor_id: ACTOR,
          actor_role: 'associate',
          correlation_id: CORR,
          causation_id: CAUS,
        }),
      ).toThrow('Claim nonexistent not found');
    });

    it('increments version on each amendment', () => {
      const agg = new ClaimAggregate();
      const claimId = createBasicClaim(agg);

      for (let i = 2; i <= 4; i++) {
        agg.amendClaim({
          tenant_id: T,
          case_id: CASE,
          claim_id: claimId,
          new_text: `Version ${i} text.`,
          amendment_reason: `Amendment ${i}`,
          actor_id: ACTOR,
          actor_role: 'associate',
          correlation_id: CORR,
          causation_id: CAUS,
        });
        // After amending, status is 'amended', need to review then can amend again
        // Actually the amend sets status to 'amended', which can be reviewed
        // For simplicity, the next amendment still works on 'amended' status
      }

      expect(agg.getClaim(claimId)!.version).toBe(4);
    });
  });

  describe('changeClaimStatus', () => {
    it('transitions draft → reviewed', () => {
      const agg = new ClaimAggregate();
      const claimId = createBasicClaim(agg);
      agg.clearPendingEvents();

      agg.changeClaimStatus({
        tenant_id: T,
        case_id: CASE,
        claim_id: claimId,
        to_status: 'reviewed',
        actor_id: ACTOR,
        actor_role: 'reviewer',
        correlation_id: CORR,
        causation_id: CAUS,
      });

      expect(agg.getClaim(claimId)!.status).toBe('reviewed');
      expect(agg.pendingEvents).toHaveLength(1);
      expect(agg.pendingEvents[0].event_type).toBe('CLAIM_STATUS_CHANGED');
    });

    it('transitions reviewed → filed', () => {
      const agg = new ClaimAggregate();
      const claimId = createBasicClaim(agg);

      agg.changeClaimStatus({
        tenant_id: T,
        case_id: CASE,
        claim_id: claimId,
        to_status: 'reviewed',
        actor_id: ACTOR,
        actor_role: 'reviewer',
        correlation_id: CORR,
        causation_id: CAUS,
      });

      agg.changeClaimStatus({
        tenant_id: T,
        case_id: CASE,
        claim_id: claimId,
        to_status: 'filed',
        actor_id: ACTOR,
        actor_role: 'paralegal',
        correlation_id: CORR,
        causation_id: CAUS,
      });

      expect(agg.getClaim(claimId)!.status).toBe('filed');
    });

    it('transitions filed → amended', () => {
      const agg = new ClaimAggregate();
      const claimId = createBasicClaim(agg);

      agg.changeClaimStatus({
        tenant_id: T,
        case_id: CASE,
        claim_id: claimId,
        to_status: 'reviewed',
        actor_id: ACTOR,
        actor_role: 'reviewer',
        correlation_id: CORR,
        causation_id: CAUS,
      });
      agg.changeClaimStatus({
        tenant_id: T,
        case_id: CASE,
        claim_id: claimId,
        to_status: 'filed',
        actor_id: ACTOR,
        actor_role: 'paralegal',
        correlation_id: CORR,
        causation_id: CAUS,
      });
      agg.changeClaimStatus({
        tenant_id: T,
        case_id: CASE,
        claim_id: claimId,
        to_status: 'amended',
        actor_id: ACTOR,
        actor_role: 'associate',
        correlation_id: CORR,
        causation_id: CAUS,
      });

      expect(agg.getClaim(claimId)!.status).toBe('amended');
    });

    it('rejects invalid status transition', () => {
      const agg = new ClaimAggregate();
      const claimId = createBasicClaim(agg);

      expect(() =>
        agg.changeClaimStatus({
          tenant_id: T,
          case_id: CASE,
          claim_id: claimId,
          to_status: 'filed', // draft → filed is not allowed
          actor_id: ACTOR,
          actor_role: 'associate',
          correlation_id: CORR,
          causation_id: CAUS,
        }),
      ).toThrow('Invalid claim status transition: draft → filed');
    });

    it('cannot transition out of cancelled', () => {
      const agg = new ClaimAggregate();
      const claimId = createBasicClaim(agg);

      agg.changeClaimStatus({
        tenant_id: T,
        case_id: CASE,
        claim_id: claimId,
        to_status: 'cancelled',
        actor_id: ACTOR,
        actor_role: 'associate',
        correlation_id: CORR,
        causation_id: CAUS,
      });

      expect(() =>
        agg.changeClaimStatus({
          tenant_id: T,
          case_id: CASE,
          claim_id: claimId,
          to_status: 'draft',
          actor_id: ACTOR,
          actor_role: 'associate',
          correlation_id: CORR,
          causation_id: CAUS,
        }),
      ).toThrow('Invalid claim status transition: cancelled → draft');
    });
  });

  describe('event replay', () => {
    it('reconstructs state from event history', () => {
      const agg1 = new ClaimAggregate();
      const claimId = createBasicClaim(agg1);

      agg1.amendClaim({
        tenant_id: T,
        case_id: CASE,
        claim_id: claimId,
        new_text: 'Amended text version 2.',
        amendment_reason: 'OA response',
        actor_id: ACTOR,
        actor_role: 'associate',
        correlation_id: CORR,
        causation_id: CAUS,
      });

      agg1.changeClaimStatus({
        tenant_id: T,
        case_id: CASE,
        claim_id: claimId,
        to_status: 'reviewed',
        actor_id: ACTOR,
        actor_role: 'reviewer',
        correlation_id: CORR,
        causation_id: CAUS,
      });

      const events = agg1.pendingEvents;

      // Replay
      const agg2 = new ClaimAggregate();
      agg2.loadFromHistory(events);

      expect(agg2.allClaims).toHaveLength(1);
      const claim = agg2.getClaim(claimId);
      expect(claim).not.toBeUndefined();
      expect(claim!.version).toBe(2);
      expect(claim!.claim_text).toBe('Amended text version 2.');
      expect(claim!.status).toBe('reviewed');
    });

    it('replays multiple claims', () => {
      const agg1 = new ClaimAggregate();
      const id1 = createBasicClaim(agg1, 1);

      const id2 = agg1.createClaim({
        tenant_id: T,
        case_id: CASE,
        claim_number: 2,
        claim_type: 'dependent',
        claim_category: 'method',
        depends_on_claim_id: id1,
        claim_text: 'The method of claim 1, further comprising step Y.',
        ai_generated: false,
        actor_id: ACTOR,
        actor_role: 'associate',
        correlation_id: CORR,
        causation_id: CAUS,
      });

      const events = agg1.pendingEvents;
      const agg2 = new ClaimAggregate();
      agg2.loadFromHistory(events);

      expect(agg2.allClaims).toHaveLength(2);
      expect(agg2.getClaim(id1)!.claim_type).toBe('independent');
      expect(agg2.getClaim(id2)!.claim_type).toBe('dependent');
      expect(agg2.getClaim(id2)!.depends_on_claim_id).toBe(id1);
    });
  });

  describe('multiple claims per case', () => {
    it('manages independent and dependent claims together', () => {
      const agg = new ClaimAggregate();

      const ind1 = createBasicClaim(agg, 1);
      const ind2 = agg.createClaim({
        tenant_id: T,
        case_id: CASE,
        claim_number: 5,
        claim_type: 'independent',
        claim_category: 'apparatus',
        depends_on_claim_id: null,
        claim_text: 'An apparatus comprising a processor.',
        ai_generated: false,
        actor_id: ACTOR,
        actor_role: 'associate',
        correlation_id: CORR,
        causation_id: CAUS,
      });

      const dep1 = agg.createClaim({
        tenant_id: T,
        case_id: CASE,
        claim_number: 2,
        claim_type: 'dependent',
        claim_category: 'method',
        depends_on_claim_id: ind1,
        claim_text: 'The method of claim 1, wherein the data is encrypted.',
        ai_generated: false,
        actor_id: ACTOR,
        actor_role: 'associate',
        correlation_id: CORR,
        causation_id: CAUS,
      });

      expect(agg.allClaims).toHaveLength(3);
      expect(agg.getClaim(ind1)!.claim_type).toBe('independent');
      expect(agg.getClaim(ind2)!.claim_type).toBe('independent');
      expect(agg.getClaim(dep1)!.depends_on_claim_id).toBe(ind1);
    });
  });
});
