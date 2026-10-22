import { z } from 'zod';

export const listFollowUpsQuerySchema = z.object({
  status: z.enum(['OPEN', 'DONE', 'CANCELED']).default('OPEN'),
  seller: z.string().trim().max(80).optional(),
});
export type ListFollowUpsQuery = z.infer<typeof listFollowUpsQuerySchema>;

export const resolveFollowUpSchema = z
  .object({
    status: z.enum(['DONE', 'CANCELED']),
    resolution: z.string().trim().max(500).nullish(),
  })
  .strict();
export type ResolveFollowUpInput = z.infer<typeof resolveFollowUpSchema>;

export const listRunsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(10),
});
export type ListRunsQuery = z.infer<typeof listRunsQuerySchema>;
