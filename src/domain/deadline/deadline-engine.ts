/**
 * Deadline Engine — Core Logic
 *
 * Responsibilities:
 * 1. Calculate statutory deadlines from OA dates (jurisdiction-specific)
 * 2. Perform periodic sweep checks on all active deadlines
 * 3. Trigger escalation notifications at defined thresholds
 * 4. Create incident records for missed deadlines
 * 5. Support deadline extensions
 *
 * This module emits events but does NOT directly send notifications.
 * Notification delivery is handled by a separate notification service
 * that subscribes to deadline events.
 */

import type { DeadlineId, CaseId, TenantId, ActorId } from '../../shared/types/index.js';
import type {
  DeadlineCalculationInput,
  DeadlineCalculationResult,
  DeadlineSweepResult,
  EscalationRule,
  JurisdictionDeadlineRule,
} from './types.js';
import { DEFAULT_ESCALATION_RULES } from './types.js';

// ─── Interfaces (to be implemented by infrastructure layer) ────────

export interface DeadlineRepository {
  findActiveDeadlines(tenant_id: TenantId): Promise<ActiveDeadlineRecord[]>;
  findActiveDeadlinesAllTenants(): Promise<ActiveDeadlineRecord[]>;
  findById(deadline_id: DeadlineId): Promise<ActiveDeadlineRecord | null>;
}

export interface EventEmitter {
  emit(event: DeadlineEvent): Promise<void>;
}

export interface ActiveDeadlineRecord {
  deadline_id: DeadlineId;
  case_id: CaseId;
  tenant_id: TenantId;
  deadline_type: 'statutory' | 'procedural' | 'internal';
  source_entity_type: 'case' | 'office_action' | 'maintenance';
  source_entity_id: string;
  due_date: string;
  escalation_level: number;
  assigned_attorney_id: ActorId;
  assigned_associate_id: ActorId | null;
}

export type DeadlineEvent =
  | { type: 'DEADLINE_WARNING_SENT'; deadline_id: DeadlineId; level: number; days_remaining: number }
  | { type: 'DEADLINE_ESCALATED'; deadline_id: DeadlineId; from_level: number; to_level: number }
  | { type: 'DEADLINE_MISSED'; deadline_id: DeadlineId; missed_at: string };

// ─── Deadline Calculator ───────────────────────────────────────────

export function calculateDeadline(
  input: DeadlineCalculationInput,
  rules: JurisdictionDeadlineRule[],
): DeadlineCalculationResult | null {
  const rule = rules.find(
    (r) => r.jurisdiction === input.jurisdiction && r.oa_type === input.oa_type,
  );

  if (!rule) {
    return null;
  }

  const receivedDate = new Date(input.received_date);

  // Calculate base due date
  const baseDueDate = new Date(receivedDate);
  baseDueDate.setMonth(baseDueDate.getMonth() + rule.base_response_period_months);

  // Calculate current due date with extensions
  const currentDueDate = new Date(receivedDate);
  const totalMonths =
    rule.base_response_period_months +
    input.extensions_used * rule.extension_period_months;
  const cappedMonths = Math.min(totalMonths, rule.absolute_max_months);
  currentDueDate.setMonth(currentDueDate.getMonth() + cappedMonths);

  // Calculate next extension
  const extensionsRemaining = rule.max_extensions - input.extensions_used;
  let nextExtensionDueDate: string | null = null;
  if (extensionsRemaining > 0) {
    const nextDate = new Date(currentDueDate);
    nextDate.setMonth(nextDate.getMonth() + rule.extension_period_months);
    const absoluteMax = new Date(receivedDate);
    absoluteMax.setMonth(absoluteMax.getMonth() + rule.absolute_max_months);
    if (nextDate <= absoluteMax) {
      nextExtensionDueDate = nextDate.toISOString();
    }
  }

  return {
    base_due_date: baseDueDate.toISOString(),
    current_due_date: currentDueDate.toISOString(),
    extensions_remaining: extensionsRemaining,
    next_extension_due_date: nextExtensionDueDate,
    requires_fee: rule.extension_requires_fee,
  };
}

// ─── Deadline Sweep Logic ──────────────────────────────────────────

export function evaluateDeadline(
  deadline: ActiveDeadlineRecord,
  now: Date,
  escalationRules: EscalationRule[] = DEFAULT_ESCALATION_RULES,
): DeadlineEvent | null {
  const dueDate = new Date(deadline.due_date);
  const diffMs = dueDate.getTime() - now.getTime();
  const daysRemaining = Math.ceil(diffMs / (1000 * 60 * 60 * 24));

  // Find the highest applicable escalation rule
  const applicableRules = escalationRules
    .filter((rule) => daysRemaining <= rule.days_before_due)
    .sort((a, b) => a.days_before_due - b.days_before_due);

  if (applicableRules.length === 0) {
    return null; // No escalation needed yet
  }

  const highestRule = applicableRules[0];

  // Deadline missed
  if (daysRemaining <= 0) {
    return {
      type: 'DEADLINE_MISSED',
      deadline_id: deadline.deadline_id,
      missed_at: now.toISOString(),
    };
  }

  // Escalation needed
  if (highestRule.level > deadline.escalation_level) {
    return {
      type: 'DEADLINE_ESCALATED',
      deadline_id: deadline.deadline_id,
      from_level: deadline.escalation_level,
      to_level: highestRule.level,
    };
  }

  // Warning at current level (if not already sent at this level)
  if (highestRule.level === deadline.escalation_level) {
    return {
      type: 'DEADLINE_WARNING_SENT',
      deadline_id: deadline.deadline_id,
      level: highestRule.level,
      days_remaining: daysRemaining,
    };
  }

  return null;
}
