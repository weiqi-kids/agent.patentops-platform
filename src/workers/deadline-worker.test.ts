/**
 * Deadline Sweep Worker — Unit Tests
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { runDeadlineSweep } from './deadline-worker.js';
import type { DeadlineWorkerDeps } from './deadline-worker.js';
import type { ActiveDeadlineRecord, DeadlineEvent } from '../domain/deadline/deadline-engine.js';
import type { DeadlineId, CaseId, TenantId, ActorId } from '../shared/types/index.js';

function makeDeadline(
  overrides: Partial<ActiveDeadlineRecord> = {},
): ActiveDeadlineRecord {
  return {
    deadline_id: 'dl_01' as DeadlineId,
    case_id: 'case_01' as CaseId,
    tenant_id: 'tenant_01' as TenantId,
    deadline_type: 'statutory',
    source_entity_type: 'office_action',
    source_entity_id: 'oa_01',
    due_date: '2025-06-01T00:00:00.000Z',
    escalation_level: 0,
    assigned_attorney_id: 'attorney_01' as ActorId,
    assigned_associate_id: null,
    ...overrides,
  };
}

describe('Deadline Sweep Worker', () => {
  let emittedEvents: Array<{ event: DeadlineEvent; deadline: ActiveDeadlineRecord }>;
  let deps: DeadlineWorkerDeps;

  beforeEach(() => {
    emittedEvents = [];
    deps = {
      findActiveDeadlines: vi.fn().mockResolvedValue([]),
      emitEvent: vi.fn(async (event, deadline) => {
        emittedEvents.push({ event, deadline });
      }),
    };
  });

  it('returns empty result when no active deadlines', async () => {
    const result = await runDeadlineSweep(deps);
    expect(result.total_active_deadlines).toBe(0);
    expect(result.warnings_sent).toBe(0);
    expect(result.escalations_triggered).toBe(0);
    expect(result.deadlines_missed).toBe(0);
  });

  it('reports warning for deadline within 30 days', async () => {
    const futureDate = new Date();
    futureDate.setDate(futureDate.getDate() + 25);

    (deps.findActiveDeadlines as ReturnType<typeof vi.fn>).mockResolvedValue([
      makeDeadline({ due_date: futureDate.toISOString(), escalation_level: 0 }),
    ]);

    const result = await runDeadlineSweep(deps);
    expect(result.total_active_deadlines).toBe(1);
    expect(result.warnings_sent + result.escalations_triggered).toBeGreaterThanOrEqual(1);
  });

  it('reports missed deadline', async () => {
    const pastDate = new Date();
    pastDate.setDate(pastDate.getDate() - 1);

    (deps.findActiveDeadlines as ReturnType<typeof vi.fn>).mockResolvedValue([
      makeDeadline({ due_date: pastDate.toISOString(), escalation_level: 5 }),
    ]);

    const result = await runDeadlineSweep(deps);
    expect(result.deadlines_missed).toBe(1);
    expect(emittedEvents).toHaveLength(1);
    expect(emittedEvents[0].event.type).toBe('DEADLINE_MISSED');
  });

  it('reports escalation when level should increase', async () => {
    const futureDate = new Date();
    futureDate.setDate(futureDate.getDate() + 5);

    (deps.findActiveDeadlines as ReturnType<typeof vi.fn>).mockResolvedValue([
      makeDeadline({ due_date: futureDate.toISOString(), escalation_level: 0 }),
    ]);

    const result = await runDeadlineSweep(deps);
    expect(result.escalations_triggered).toBeGreaterThanOrEqual(1);
  });

  it('handles emitEvent errors gracefully', async () => {
    const pastDate = new Date();
    pastDate.setDate(pastDate.getDate() - 1);

    (deps.findActiveDeadlines as ReturnType<typeof vi.fn>).mockResolvedValue([
      makeDeadline({ due_date: pastDate.toISOString(), escalation_level: 5 }),
    ]);
    (deps.emitEvent as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('DB down'));

    // Should not throw
    const result = await runDeadlineSweep(deps);
    expect(result.total_active_deadlines).toBe(1);
    // The missed deadline wasn't counted because emitEvent failed
    expect(result.deadlines_missed).toBe(0);
  });

  it('processes multiple deadlines', async () => {
    const soon = new Date();
    soon.setDate(soon.getDate() + 2);
    const past = new Date();
    past.setDate(past.getDate() - 1);
    const far = new Date();
    far.setDate(far.getDate() + 60);

    (deps.findActiveDeadlines as ReturnType<typeof vi.fn>).mockResolvedValue([
      makeDeadline({ deadline_id: 'dl_01' as DeadlineId, due_date: soon.toISOString(), escalation_level: 0 }),
      makeDeadline({ deadline_id: 'dl_02' as DeadlineId, due_date: past.toISOString(), escalation_level: 5 }),
      makeDeadline({ deadline_id: 'dl_03' as DeadlineId, due_date: far.toISOString(), escalation_level: 0 }),
    ]);

    const result = await runDeadlineSweep(deps);
    expect(result.total_active_deadlines).toBe(3);
    expect(result.details).toHaveLength(3);
  });
});
