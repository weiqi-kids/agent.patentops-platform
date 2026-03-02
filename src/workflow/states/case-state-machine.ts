/**
 * Patent Case State Machine
 *
 * Defines valid state transitions and the role permissions required for each.
 * This is the core enforcement point for workflow integrity.
 *
 * States reflect the universal patent prosecution lifecycle, not
 * any single jurisdiction's terminology.
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
  // ─── Pre-filing ────────────────────────────────────────────────
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

  // ─── Filing ────────────────────────────────────────────────────
  {
    from: 'FILING',
    to: 'FILED',
    allowed_roles: ['paralegal', 'associate', 'reviewer', 'partner', 'system'],
    requires_conflict_check: false,
    requires_human_review: false,
    description: 'Application filed with patent office',
  },

  // ─── Examination request (TW/EP/JP — separate from filing) ────
  {
    from: 'FILED',
    to: 'EXAMINATION_REQUESTED',
    allowed_roles: ['paralegal', 'associate', 'reviewer', 'partner', 'system'],
    requires_conflict_check: false,
    requires_human_review: false,
    description: 'Substantive examination requested',
  },

  // ─── Office Action ────────────────────────────────────────────
  {
    from: 'FILED',
    to: 'OA_RECEIVED',
    allowed_roles: ['paralegal', 'associate', 'reviewer', 'partner', 'system'],
    requires_conflict_check: false,
    requires_human_review: false,
    description: 'Office action received',
  },
  {
    from: 'EXAMINATION_REQUESTED',
    to: 'OA_RECEIVED',
    allowed_roles: ['paralegal', 'associate', 'reviewer', 'partner', 'system'],
    requires_conflict_check: false,
    requires_human_review: false,
    description: 'Office action received after examination requested',
  },
  {
    from: 'OA_RECEIVED',
    to: 'FILED',
    allowed_roles: ['reviewer', 'partner'],
    requires_conflict_check: false,
    requires_human_review: true,
    description: 'OA response filed, back to filed status',
  },
  {
    from: 'OA_RECEIVED',
    to: 'OA_RECEIVED',
    allowed_roles: ['paralegal', 'associate', 'reviewer', 'partner', 'system'],
    requires_conflict_check: false,
    requires_human_review: false,
    description: 'New OA received while previous OA still active (e.g., restriction + rejection)',
  },

  // ─── Allowance & Grant ────────────────────────────────────────
  {
    from: 'FILED',
    to: 'ALLOWED',
    allowed_roles: ['paralegal', 'associate', 'reviewer', 'partner', 'system'],
    requires_conflict_check: false,
    requires_human_review: false,
    description: 'Notice of allowance received / 核准審定',
  },
  {
    from: 'EXAMINATION_REQUESTED',
    to: 'ALLOWED',
    allowed_roles: ['paralegal', 'associate', 'reviewer', 'partner', 'system'],
    requires_conflict_check: false,
    requires_human_review: false,
    description: 'Allowed after examination',
  },
  {
    from: 'OA_RECEIVED',
    to: 'ALLOWED',
    allowed_roles: ['paralegal', 'associate', 'reviewer', 'partner', 'system'],
    requires_conflict_check: false,
    requires_human_review: false,
    description: 'Allowed after OA response',
  },
  {
    from: 'ALLOWED',
    to: 'GRANTED',
    allowed_roles: ['paralegal', 'associate', 'reviewer', 'partner', 'system'],
    requires_conflict_check: false,
    requires_human_review: false,
    description: 'Patent granted / 公告 after issue fee paid',
  },

  // ─── Withdrawal / Abandonment (from most states) ──────────────
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
    from: 'FILED',
    to: 'CLOSED',
    allowed_roles: ['partner'],
    requires_conflict_check: false,
    requires_human_review: false,
    description: 'Abandon filed case',
  },
  {
    from: 'EXAMINATION_REQUESTED',
    to: 'CLOSED',
    allowed_roles: ['partner'],
    requires_conflict_check: false,
    requires_human_review: false,
    description: 'Abandon after examination requested',
  },
  {
    from: 'OA_RECEIVED',
    to: 'CLOSED',
    allowed_roles: ['partner'],
    requires_conflict_check: false,
    requires_human_review: false,
    description: 'Abandon after OA (e.g., no response filed)',
  },
  {
    from: 'ALLOWED',
    to: 'CLOSED',
    allowed_roles: ['partner'],
    requires_conflict_check: false,
    requires_human_review: false,
    description: 'Abandon by not paying issue fee',
  },
  {
    from: 'GRANTED',
    to: 'CLOSED',
    allowed_roles: ['partner', 'system'],
    requires_conflict_check: false,
    requires_human_review: false,
    description: 'Patent lapsed/expired',
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
