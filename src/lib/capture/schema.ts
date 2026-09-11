import { z } from "zod";

export const captureCreateSchema = z.object({
  clientRequestId: z.string().uuid(),
  title: z.string().trim().min(1).max(240),
  responsibleUserId: z.string().uuid(),
  priority: z.enum(["NORMAL", "URGENT"]).default("NORMAL"),
  dueAt: z.string().datetime().nullable().optional(),
  tagIds: z.array(z.string().uuid()).max(8).default([]),
});

export type CaptureCreateInput = z.infer<typeof captureCreateSchema>;
