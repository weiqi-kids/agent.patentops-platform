/**
 * Office Action Response Sub-Workflow State Machine
 *
 * Each OfficeAction entity has its own lifecycle, independent of the
 * case-level state machine. A case may have multiple OAs, each
 * progressing through this workflow concurrently.
 *
 * Flow:
 *   RECEIVED → ANALYZING → STRATEGIZING → AMENDING → REVIEW → FILED
 *
 * The AI sidecar is invoked at ANALYZING and STRATEGIZING stages.
 * REVIEW is a mandatory human checkpoint before filing.
 */

import type { OfficeActionStatus, ActorRole } from '../../shared/types/index.js';

export interface OaTransition {
  from: OfficeActionStatus;
  to: OfficeActionStatus;
  allowed_roles: ActorRole[];
  ai_sidecar_invoked: boolean;
  requires_human_review: boolean;
  description: string;
}

export const OA_RESPONSE_TRANSITIONS: OaTransition[] = [
  {
    from: 'received',
    to: 'analyzing',
    allowed_roles: ['paralegal', 'associate', 'reviewer', 'partner', 'system'],
    ai_sidecar_invoked: true,
    requires_human_review: false,
    description: 'Begin OA analysis — AI classifies rejection, maps cited art',
  },
  {
    from: 'analyzing',
    to: 'strategizing',
    allowed_roles: ['associate', 'reviewer', 'partner', 'system'],
    ai_sidecar_invoked: true,
    requires_human_review: false,
    description: 'Analysis complete — AI suggests amendment strategies',
  },
  {
    from: 'strategizing',
    to: 'amending',
    allowed_roles: ['associate', 'reviewer', 'partner'],
    ai_sidecar_invoked: false,
    requires_human_review: false,
    description: 'Attorney selects strategy and begins drafting amendments',
  },
  {
    from: 'amending',
    to: 'review',
    allowed_roles: ['associate', 'reviewer', 'partner'],
    ai_sidecar_invoked: false,
    requires_human_review: false,
    description: 'Submit amendments for review',
  },
  {
    from: 'review',
    to: 'amending',
    allowed_roles: ['reviewer', 'partner'],
    ai_sidecar_invoked: false,
    requires_human_review: false,
    description: 'Send back for further revision',
  },
  {
    from: 'review',
    to: 'filed',
    allowed_roles: ['reviewer', 'partner'],
    ai_sidecar_invoked: false,
    requires_human_review: true,
    description: 'Approve and file OA response (mandatory human checkpoint)',
  },
  // Skip analysis — for simple OAs where attorney responds directly
  {
    from: 'received',
    to: 'amending',
    allowed_roles: ['reviewer', 'partner'],
    ai_sidecar_invoked: false,
    requires_human_review: false,
    description: 'Skip AI analysis — attorney responds directly',
  },
];

/**
 * Validate whether an OA status transition is permitted.
 */
export function validateOaTransition(
  from: OfficeActionStatus,
  to: OfficeActionStatus,
  actor_role: ActorRole,
): { valid: boolean; transition: OaTransition | null; error: string | null } {
  const transition = OA_RESPONSE_TRANSITIONS.find(
    (t) => t.from === from && t.to === to,
  );

  if (!transition) {
    return {
      valid: false,
      transition: null,
      error: `Invalid OA transition: ${from} → ${to}`,
    };
  }

  if (!transition.allowed_roles.includes(actor_role)) {
    return {
      valid: false,
      transition,
      error: `Role '${actor_role}' is not permitted for OA transition ${from} → ${to}. Allowed: ${transition.allowed_roles.join(', ')}`,
    };
  }

  return { valid: true, transition, error: null };
}

/**
 * Get valid next OA statuses from the current status for a given role.
 */
export function getValidNextOaStatuses(
  current: OfficeActionStatus,
  actor_role: ActorRole,
): OfficeActionStatus[] {
  return OA_RESPONSE_TRANSITIONS
    .filter((t) => t.from === current && t.allowed_roles.includes(actor_role))
    .map((t) => t.to);
}
