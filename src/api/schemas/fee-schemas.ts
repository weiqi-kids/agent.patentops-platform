/**
 * Zod validation schemas for Fee API endpoints.
 */

import { z } from 'zod';
import { FEE_TYPES, FEE_STATUSES } from '../../shared/types/index.js';

export const createFeeSchema = z.object({
  fee_type: z.enum(FEE_TYPES),
  fee_label: z.string().min(1).max(200),
  amount: z.number().positive(),
  currency: z.string().min(3).max(3),
  due_date: z.string().datetime(),
  grace_period_end: z.string().datetime().nullable().optional(),
  late_surcharge_amount: z.number().positive().nullable().optional(),
  deadline_id: z.string().nullable().optional(),
});

export const recordFeePaymentSchema = z.object({
  payment_reference: z.string().min(1),
  paid_at: z.string().datetime(),
});

export const waiveFeeSchema = z.object({
  reason: z.string().min(1).max(1000),
});

export type CreateFeeInput = z.infer<typeof createFeeSchema>;
export type RecordFeePaymentInput = z.infer<typeof recordFeePaymentSchema>;
export type WaiveFeeInput = z.infer<typeof waiveFeeSchema>;
