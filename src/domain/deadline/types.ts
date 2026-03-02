/**
 * Deadline Engine — Domain Types
 *
 * The most critical operational module in PatentOps.
 * A missed patent deadline can result in irrecoverable loss of patent rights.
 *
 * Jurisdiction-agnostic: deadline rules are injected by jurisdiction plugins.
 */

import type {
  DeadlineId,
  CaseId,
  TenantId,
  ActorId,
  DeadlineType,
  DeadlineSourceEntityType,
  DeadlineStatus,
  EscalationLevel,
} from '../../shared/types/index.js';

// ─── Escalation Configuration ──────────────────────────────────────

export interface EscalationRule {
  days_before_due: number;
  level: EscalationLevel;
  label: 'info' | 'warning' | 'urgent' | 'critical' | 'emergency' | 'incident';
  channels: NotificationChannel[];
  notify_roles: string[];
}

export type NotificationChannel = 'dashboard' | 'email' | 'sms' | 'webhook';

/**
 * Default escalation matrix.
 * Can be overridden per tenant via tenant settings.
 */
export const DEFAULT_ESCALATION_RULES: EscalationRule[] = [
  {
    days_before_due: 30,
    level: 0,
    label: 'info',
    channels: ['dashboard'],
    notify_roles: ['paralegal', 'associate'],
  },
  {
    days_before_due: 14,
    level: 1,
    label: 'warning',
    channels: ['dashboard', 'email'],
    notify_roles: ['paralegal', 'associate'],
  },
  {
    days_before_due: 7,
    level: 2,
    label: 'urgent',
    channels: ['dashboard', 'email'],
    notify_roles: ['paralegal', 'associate', 'reviewer'],
  },
  {
    days_before_due: 3,
    level: 3,
    label: 'critical',
    channels: ['dashboard', 'email'],
    notify_roles: ['paralegal', 'associate', 'reviewer', 'partner'],
  },
  {
    days_before_due: 1,
    level: 4,
    label: 'emergency',
    channels: ['dashboard', 'email', 'sms'],
    notify_roles: ['paralegal', 'associate', 'reviewer', 'partner'],
  },
  {
    days_before_due: 0,
    level: 5,
    label: 'incident',
    channels: ['dashboard', 'email', 'sms', 'webhook'],
    notify_roles: ['paralegal', 'associate', 'reviewer', 'partner', 'admin'],
  },
];

// ─── Jurisdiction Deadline Rules ────────────────────────────────────
// Jurisdiction plugins provide these rules. Core platform defines the interface.

export interface JurisdictionDeadlineRule {
  jurisdiction: string;
  /** OA category or deadline trigger type */
  trigger_type: string;
  base_response_period_months: number;
  max_extensions: number;
  extension_period_months: number;
  extension_requires_fee: boolean;
  absolute_max_months: number;
  /** How to determine the start date for this jurisdiction */
  start_date_basis: 'mailing_date' | 'received_date' | 'service_date';
  /** Optional: days to add for constructive service (e.g., TW adds days for delivery) */
  service_date_offset_days: number;
  /** Statutory/regulatory source */
  rule_reference: string;
}

// ─── Deadline Calculation Interface ────────────────────────────────

export interface DeadlineCalculationInput {
  jurisdiction: string;
  trigger_type: string;
  mailing_date: string;
  received_date: string;
  extensions_used: number;
}

export interface DeadlineCalculationResult {
  start_date: string;
  base_due_date: string;
  current_due_date: string;
  extensions_remaining: number;
  next_extension_due_date: string | null;
  requires_fee: boolean;
  rule_reference: string;
}

// ─── Deadline Sweep Result ─────────────────────────────────────────

export interface DeadlineSweepResult {
  sweep_timestamp: string;
  total_active_deadlines: number;
  warnings_sent: number;
  escalations_triggered: number;
  deadlines_missed: number;
  details: Array<{
    deadline_id: DeadlineId;
    case_id: CaseId;
    tenant_id: TenantId;
    days_remaining: number;
    action_taken: 'none' | 'warning_sent' | 'escalated' | 'missed';
    escalation_level: EscalationLevel;
  }>;
}
