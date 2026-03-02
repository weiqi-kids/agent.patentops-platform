/**
 * Zod validation schemas for Claim API endpoints.
 */

import { z } from 'zod';
import { CLAIM_TYPES, CLAIM_CATEGORIES, CLAIM_STATUSES } from '../../shared/types/index.js';

export const createClaimSchema = z.object({
  claim_number: z.number().int().positive(),
  claim_type: z.enum(CLAIM_TYPES),
  claim_category: z.enum(CLAIM_CATEGORIES).nullable().optional(),
  depends_on_claim_id: z.string().nullable().optional(),
  claim_text: z.string().min(1).max(10000),
  ai_generated: z.boolean().default(false),
});

export const amendClaimSchema = z.object({
  new_text: z.string().min(1).max(10000),
  amendment_reason: z.string().min(1).max(2000),
});

export const changeClaimStatusSchema = z.object({
  to_status: z.enum(CLAIM_STATUSES),
});

export type CreateClaimInput = z.infer<typeof createClaimSchema>;
export type AmendClaimInput = z.infer<typeof amendClaimSchema>;
export type ChangeClaimStatusInput = z.infer<typeof changeClaimStatusSchema>;
