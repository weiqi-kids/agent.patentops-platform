import { describe, it, expect } from 'vitest';
import {
  validateTransition,
  getValidNextStates,
} from './case-state-machine.js';

describe('Case State Machine', () => {
  describe('validateTransition', () => {
    it('allows INTAKE → DRAFTING for associate after conflict check', () => {
      const result = validateTransition('INTAKE', 'DRAFTING', 'associate');
      expect(result.valid).toBe(true);
      expect(result.transition?.requires_conflict_check).toBe(true);
    });

    it('rejects INTAKE → DRAFTING for client', () => {
      const result = validateTransition('INTAKE', 'DRAFTING', 'client');
      expect(result.valid).toBe(false);
      expect(result.error).toContain('not permitted');
    });

    it('allows REVIEW → FILING only for reviewer/partner', () => {
      expect(validateTransition('REVIEW', 'FILING', 'reviewer').valid).toBe(true);
      expect(validateTransition('REVIEW', 'FILING', 'partner').valid).toBe(true);
      expect(validateTransition('REVIEW', 'FILING', 'associate').valid).toBe(false);
    });

    it('requires human review for REVIEW → FILING', () => {
      const result = validateTransition('REVIEW', 'FILING', 'reviewer');
      expect(result.transition?.requires_human_review).toBe(true);
    });

    it('allows FILING → FILED for paralegal', () => {
      const result = validateTransition('FILING', 'FILED', 'paralegal');
      expect(result.valid).toBe(true);
    });

    it('allows FILED → EXAMINATION_REQUESTED', () => {
      const result = validateTransition('FILED', 'EXAMINATION_REQUESTED', 'paralegal');
      expect(result.valid).toBe(true);
    });

    it('allows OA_RECEIVED → FILED (response filed)', () => {
      const result = validateTransition('OA_RECEIVED', 'FILED', 'reviewer');
      expect(result.valid).toBe(true);
      expect(result.transition?.requires_human_review).toBe(true);
    });

    it('allows ALLOWED → GRANTED', () => {
      const result = validateTransition('ALLOWED', 'GRANTED', 'system');
      expect(result.valid).toBe(true);
    });

    it('allows withdrawal from DRAFTING by partner only', () => {
      expect(validateTransition('DRAFTING', 'CLOSED', 'partner').valid).toBe(true);
      expect(validateTransition('DRAFTING', 'CLOSED', 'associate').valid).toBe(false);
    });

    it('allows GRANTED → CLOSED (patent lapsed/expired)', () => {
      const result = validateTransition('GRANTED', 'CLOSED', 'system');
      expect(result.valid).toBe(true);
    });

    it('rejects invalid transitions', () => {
      expect(validateTransition('INTAKE', 'FILED', 'partner').valid).toBe(false);
      expect(validateTransition('CLOSED', 'INTAKE', 'partner').valid).toBe(false);
      expect(validateTransition('GRANTED', 'DRAFTING', 'partner').valid).toBe(false);
    });

    it('supports OA_RECEIVED → OA_RECEIVED (multiple OAs)', () => {
      const result = validateTransition('OA_RECEIVED', 'OA_RECEIVED', 'system');
      expect(result.valid).toBe(true);
    });
  });

  describe('getValidNextStates', () => {
    it('returns correct next states for INTAKE as partner', () => {
      const states = getValidNextStates('INTAKE', 'partner');
      expect(states).toContain('DRAFTING');
      expect(states).toContain('CLOSED');
    });

    it('returns correct next states for FILED as paralegal', () => {
      const states = getValidNextStates('FILED', 'paralegal');
      expect(states).toContain('EXAMINATION_REQUESTED');
      expect(states).toContain('OA_RECEIVED');
    });

    it('returns no states for CLOSED', () => {
      const states = getValidNextStates('CLOSED', 'partner');
      expect(states).toHaveLength(0);
    });

    it('returns fewer options for restricted roles', () => {
      const partnerStates = getValidNextStates('FILED', 'partner');
      const clientStates = getValidNextStates('FILED', 'client');
      expect(partnerStates.length).toBeGreaterThan(clientStates.length);
      expect(clientStates).toHaveLength(0);
    });
  });
});
