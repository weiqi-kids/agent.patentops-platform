/**
 * Zod validation schemas for Conflict Check API endpoints.
 */

import { z } from 'zod';

export const initiateConflictCheckSchema = z.object({
  parties_to_check: z.array(z.string().min(1)).min(1),
});

export const overrideConflictSchema = z.object({
  check_id: z.string().min(1),
  justification: z.string().min(10),
  ethical_wall_measures: z.string().nullable().optional(),
});

export type InitiateConflictCheckInput = z.infer<typeof initiateConflictCheckSchema>;
export type OverrideConflictInput = z.infer<typeof overrideConflictSchema>;
