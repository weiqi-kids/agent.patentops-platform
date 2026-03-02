/**
 * Hash Chain — SHA-256 integrity verification for event sourcing.
 *
 * Each event's hash is computed over:
 *   event_id + case_id + event_type + actor_id + timestamp + JSON(payload) + previous_hash
 *
 * This forms a per-case chain that enables tamper detection.
 */

import { createHash } from 'node:crypto';
import type { DomainEvent } from '../../shared/events/index.js';

/** The genesis hash for the first event in a case's chain. */
export const GENESIS_HASH = '0'.repeat(64);

/**
 * Compute the SHA-256 hash for an event.
 */
export function computeEventHash(
  event_id: string,
  case_id: string,
  event_type: string,
  actor_id: string,
  timestamp: string,
  payload: unknown,
  previous_hash: string,
): string {
  const data = [
    event_id,
    case_id,
    event_type,
    actor_id,
    timestamp,
    JSON.stringify(payload),
    previous_hash,
  ].join('|');

  return createHash('sha256').update(data, 'utf8').digest('hex');
}

/**
 * Compute hash for a DomainEvent.
 */
export function hashEvent(event: DomainEvent): string {
  return computeEventHash(
    event.event_id,
    event.case_id,
    event.event_type,
    event.actor_id,
    event.timestamp,
    event.payload,
    event.previous_hash,
  );
}

/**
 * Verify that an event's new_hash matches the recomputed hash.
 */
export function verifyEventHash(event: DomainEvent): boolean {
  const recomputed = hashEvent(event);
  return recomputed === event.new_hash;
}

/**
 * Verify the hash chain for an ordered list of events (all from the same case).
 * Returns the index of the first broken link, or -1 if the chain is valid.
 */
export function verifyChain(events: DomainEvent[]): number {
  if (events.length === 0) return -1;

  for (let i = 0; i < events.length; i++) {
    const event = events[i];

    // Check that previous_hash matches the prior event's new_hash
    if (i === 0) {
      if (event.previous_hash !== GENESIS_HASH) {
        return 0;
      }
    } else {
      if (event.previous_hash !== events[i - 1].new_hash) {
        return i;
      }
    }

    // Check that new_hash is correct
    if (!verifyEventHash(event)) {
      return i;
    }
  }

  return -1; // All valid
}
