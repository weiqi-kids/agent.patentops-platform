/**
 * Deadline Sweep Worker
 *
 * PM2-managed worker process that periodically scans all active deadlines
 * and triggers escalation/warning events.
 *
 * Runs as a fork-mode process (single instance) under PM2.
 * Cron-scheduled: runs every 15 minutes during business hours,
 * plus a daily full sweep at midnight.
 */

import { evaluateDeadline } from '../domain/deadline/deadline-engine.js';
import type { ActiveDeadlineRecord, DeadlineEvent } from '../domain/deadline/deadline-engine.js';
import type { DeadlineSweepResult } from '../domain/deadline/types.js';
import { DEFAULT_ESCALATION_RULES } from '../domain/deadline/types.js';
import type { DeadlineId, CaseId, TenantId, EscalationLevel } from '../shared/types/index.js';
import pino from 'pino';

const logger = pino({ name: 'deadline-worker' });

// ─── Interfaces ────────────────────────────────────────────────────

export interface DeadlineWorkerDeps {
  findActiveDeadlines(): Promise<ActiveDeadlineRecord[]>;
  emitEvent(event: DeadlineEvent, deadline: ActiveDeadlineRecord): Promise<void>;
}

// ─── Sweep Logic ───────────────────────────────────────────────────

export async function runDeadlineSweep(deps: DeadlineWorkerDeps): Promise<DeadlineSweepResult> {
  const now = new Date();
  const activeDeadlines = await deps.findActiveDeadlines();

  const result: DeadlineSweepResult = {
    sweep_timestamp: now.toISOString(),
    total_active_deadlines: activeDeadlines.length,
    warnings_sent: 0,
    escalations_triggered: 0,
    deadlines_missed: 0,
    details: [],
  };

  for (const deadline of activeDeadlines) {
    const event = evaluateDeadline(deadline, now, DEFAULT_ESCALATION_RULES);

    if (!event) {
      result.details.push({
        deadline_id: deadline.deadline_id,
        case_id: deadline.case_id,
        tenant_id: deadline.tenant_id,
        days_remaining: daysUntil(deadline.due_date, now),
        action_taken: 'none',
        escalation_level: deadline.escalation_level as EscalationLevel,
      });
      continue;
    }

    try {
      await deps.emitEvent(event, deadline);

      let actionTaken: 'warning_sent' | 'escalated' | 'missed';
      switch (event.type) {
        case 'DEADLINE_WARNING_SENT':
          result.warnings_sent++;
          actionTaken = 'warning_sent';
          break;
        case 'DEADLINE_ESCALATED':
          result.escalations_triggered++;
          actionTaken = 'escalated';
          break;
        case 'DEADLINE_MISSED':
          result.deadlines_missed++;
          actionTaken = 'missed';
          logger.error({
            deadline_id: deadline.deadline_id,
            case_id: deadline.case_id,
            tenant_id: deadline.tenant_id,
          }, 'DEADLINE MISSED — incident will be created');
          break;
      }

      result.details.push({
        deadline_id: deadline.deadline_id,
        case_id: deadline.case_id,
        tenant_id: deadline.tenant_id,
        days_remaining: daysUntil(deadline.due_date, now),
        action_taken: actionTaken!,
        escalation_level: deadline.escalation_level as EscalationLevel,
      });
    } catch (err) {
      logger.error({ err, deadline_id: deadline.deadline_id }, 'Failed to process deadline');
    }
  }

  logger.info({
    total: result.total_active_deadlines,
    warnings: result.warnings_sent,
    escalations: result.escalations_triggered,
    missed: result.deadlines_missed,
  }, 'Deadline sweep completed');

  return result;
}

function daysUntil(dueDateStr: string, now: Date): number {
  const dueDate = new Date(dueDateStr);
  return Math.ceil((dueDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
}
