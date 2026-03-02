/**
 * Zod validation schemas for Prior Art API endpoints.
 */

import { z } from 'zod';

const referenceTypes = ['patent', 'publication', 'npl'] as const;
const sourceTypes = ['oa_citation', 'applicant_disclosure', 'search_result'] as const;

export const addPriorArtSchema = z.object({
  reference_type: z.enum(referenceTypes),
  document_number: z.string().min(1),
  title: z.string().min(1).max(500),
  inventor: z.string().nullable().optional(),
  publication_date: z.string().datetime().nullable().optional(),
  jurisdiction: z.string().nullable().optional(),
  source: z.enum(sourceTypes),
});

export const searchPriorArtSchema = z.object({
  keywords: z.array(z.string().min(1)).min(1),
  classification_codes: z.array(z.string()).default([]),
  date_from: z.string().datetime().optional(),
  date_to: z.string().datetime().optional(),
  max_results: z.number().int().positive().max(100).default(20),
});

export type AddPriorArtInput = z.infer<typeof addPriorArtSchema>;
export type SearchPriorArtInput = z.infer<typeof searchPriorArtSchema>;
