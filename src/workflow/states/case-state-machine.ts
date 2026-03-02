/**
 * Patent Case State Machine
 *
 * Defines valid state transitions and the role permissions required for each.
 * This is the core enforcement point for workflow integrity.
 */

import type { CaseStatus, ActorRole } from '../../shared/types/index.js';

export interface StateTransition {
  from: CaseStatus;
  to: CaseStatus;
  allowed_roles: ActorRole[];
  requires_conflict_check: boolean;
  requires_human_review: boolean;
  description: string;
}

export const CASE_STATE_TRANSITIONS: StateTransition[] = [
  {
    from: 'INTAKE',
    to: 'DRAFTING',
    allowed_roles: ['associate', 'reviewer', 'partner'],
    requires_conflict_check: true,
    requires_human_review: false,
    description: 'Accept case after conflict check clears',
  },
  {
    from: 'DRAFTING',
    to: 'REVIEW',
    allowed_roles: ['associate', 'reviewer', 'partner'],
    requires_conflict_check: false,
    requires_human_review: false,
    description: 'Submit draft for review',
  },
  {
    from: 'REVIEW',
    to: 'DRAFTING',
    allowed_roles: ['reviewer', 'partner'],
    requires_conflict_check: false,
    requires_human_review: false,
    description: 'Send back for revision',
  },
  {
    from: 'REVIEW',
    to: 'FILING',
    allowed_roles: ['reviewer', 'partner'],
    requires_conflict_check: false,
    requires_human_review: true,
    description: 'Approve for filing (mandatory human checkpoint)',
  },
  {
    from: 'FILING',
    to: 'PENDING',
    allowed_roles: ['reviewer', 'partner', 'system'],
    requires_conflict_check: false,
    requires_human_review: false,
    description: 'Mark as filed with patent office',
  },
  {
    from: 'PENDING',
    to: 'OA_RECEIVED',
    allowed_roles: ['associate', 'reviewer', 'partner', 'system'],
    requires_conflict_check: false,
    requires_human_review: false,
    description: 'Office Action received',
  },
  {
    from: 'OA_RECEIVED',
    to: 'PENDING',
    allowed_roles: ['reviewer', 'partner'],
    requires_conflict_check: false,
    requires_human_review: true,
    description: 'OA response filed, back to pending',
  },
  {
    from: 'PENDING',
    to: 'CLOSED',
    allowed_roles: ['reviewer', 'partner'],
    requires_conflict_check: false,
    requires_human_review: false,
    description: 'Patent granted or case concluded',
  },
  // Withdrawal can happen from most states
  {
    from: 'INTAKE',
    to: 'CLOSED',
    allowed_roles: ['partner'],
    requires_conflict_check: false,
    requires_human_review: false,
    description: 'Withdraw at intake',
  },
  {
    from: 'DRAFTING',
    to: 'CLOSED',
    allowed_roles: ['partner'],
    requires_conflict_check: false,
    requires_human_review: false,
    description: 'Withdraw during drafting',
  },
  {
    from: 'PENDING',
    to: 'CLOSED',
    allowed_roles: ['partner'],
    requires_conflict_check: false,
    requires_human_review: false,
    description: 'Abandon pending case',
  },
  {
    from: 'OA_RECEIVED',
    to: 'CLOSED',
    allowed_roles: ['partner'],
    requires_conflict_check: false,
    requires_human_review: false,
    description: 'Abandon after OA',
  },
];

/**
 * Validate whether a state transition is permitted.
 */
export function validateTransition(
  from: CaseStatus,
  to: CaseStatus,
  actor_role: ActorRole,
): { valid: boolean; transition: StateTransition | null; error: string | null } {
  const transition = CASE_STATE_TRANSITIONS.find(
    (t) => t.from === from && t.to === to,
  );

  if (!transition) {
    return {
      valid: false,
      transition: null,
      error: `Invalid state transition: ${from} → ${to}`,
    };
  }

  if (!transition.allowed_roles.includes(actor_role)) {
    return {
      valid: false,
      transition,
      error: `Role '${actor_role}' is not permitted for transition ${from} → ${to}. Allowed: ${transition.allowed_roles.join(', ')}`,
    };
  }

  return { valid: true, transition, error: null };
}

/**
 * Get all valid next states from a given state for a given role.
 */
export function getValidNextStates(
  current: CaseStatus,
  actor_role: ActorRole,
): CaseStatus[] {
  return CASE_STATE_TRANSITIONS
    .filter((t) => t.from === current && t.allowed_roles.includes(actor_role))
    .map((t) => t.to);
}
