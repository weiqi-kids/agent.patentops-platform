/**
 * Zod validation schemas for Deadline API endpoints.
 */

import { z } from 'zod';
import { DEADLINE_TYPES, DEADLINE_SOURCE_ENTITY_TYPES } from '../../shared/types/index.js';

export const createDeadlineSchema = z.object({
  deadline_type: z.enum(DEADLINE_TYPES),
  source_entity_type: z.enum(DEADLINE_SOURCE_ENTITY_TYPES),
  source_entity_id: z.string().min(1),
  due_date: z.string().datetime(),
  rule_reference: z.string().nullable().optional(),
});

export const completeDeadlineSchema = z.object({
  deadline_id: z.string().min(1),
});

export const extendDeadlineSchema = z.object({
  new_due_date: z.string().datetime(),
  extension_fee_id: z.string().nullable().optional(),
});

export type CreateDeadlineInput = z.infer<typeof createDeadlineSchema>;
export type CompleteDeadlineInput = z.infer<typeof completeDeadlineSchema>;
export type ExtendDeadlineInput = z.infer<typeof extendDeadlineSchema>;
