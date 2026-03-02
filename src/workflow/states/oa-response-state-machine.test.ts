import { describe, it, expect } from 'vitest';
import {
  validateOaTransition,
  getValidNextOaStatuses,
} from './oa-response-state-machine.js';

describe('OA Response State Machine', () => {
  describe('validateOaTransition', () => {
    it('allows received → analyzing (AI analysis)', () => {
      const result = validateOaTransition('received', 'analyzing', 'associate');
      expect(result.valid).toBe(true);
      expect(result.transition?.ai_sidecar_invoked).toBe(true);
    });

    it('allows analyzing → strategizing (AI strategy)', () => {
      const result = validateOaTransition('analyzing', 'strategizing', 'associate');
      expect(result.valid).toBe(true);
      expect(result.transition?.ai_sidecar_invoked).toBe(true);
    });

    it('allows strategizing → amending (attorney drafts)', () => {
      const result = validateOaTransition('strategizing', 'amending', 'associate');
      expect(result.valid).toBe(true);
      expect(result.transition?.ai_sidecar_invoked).toBe(false);
    });

    it('requires human review for review → filed', () => {
      const result = validateOaTransition('review', 'filed', 'reviewer');
      expect(result.valid).toBe(true);
      expect(result.transition?.requires_human_review).toBe(true);
    });

    it('only reviewer/partner can approve filing', () => {
      expect(validateOaTransition('review', 'filed', 'reviewer').valid).toBe(true);
      expect(validateOaTransition('review', 'filed', 'partner').valid).toBe(true);
      expect(validateOaTransition('review', 'filed', 'associate').valid).toBe(false);
    });

    it('allows review → amending (send back)', () => {
      const result = validateOaTransition('review', 'amending', 'reviewer');
      expect(result.valid).toBe(true);
    });

    it('allows skipping analysis (received → amending)', () => {
      const result = validateOaTransition('received', 'amending', 'reviewer');
      expect(result.valid).toBe(true);
    });

    it('rejects skipping analysis for associate', () => {
      const result = validateOaTransition('received', 'amending', 'associate');
      expect(result.valid).toBe(false);
    });

    it('rejects invalid transitions', () => {
      expect(validateOaTransition('received', 'filed', 'partner').valid).toBe(false);
      expect(validateOaTransition('filed', 'received', 'partner').valid).toBe(false);
      expect(validateOaTransition('analyzing', 'filed', 'partner').valid).toBe(false);
    });
  });

  describe('getValidNextOaStatuses', () => {
    it('returns correct next statuses from received', () => {
      const statuses = getValidNextOaStatuses('received', 'paralegal');
      expect(statuses).toContain('analyzing');
      expect(statuses).not.toContain('amending'); // paralegal can't skip
    });

    it('returns analyzing and amending from received for reviewer', () => {
      const statuses = getValidNextOaStatuses('received', 'reviewer');
      expect(statuses).toContain('analyzing');
      expect(statuses).toContain('amending');
    });

    it('returns no next statuses from filed', () => {
      const statuses = getValidNextOaStatuses('filed', 'partner');
      expect(statuses).toHaveLength(0);
    });
  });
});
