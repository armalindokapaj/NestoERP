import { z } from "zod";

import { optionalBusinessDate } from "@/lib/modules/finance/finance.fields";
import { optionalId, optionalText, requiredText } from "@/lib/modules/shared/fields";
import { OBLIGATION_STATUSES, OBLIGATION_TYPES } from "./obligation.status";

/** Obligation validation (PRD #18 §279). */
export const obligationSchema = z.object({
  title: requiredText(2, 250, "Obligation title"),
  description: optionalText(5000),
  obligationType: z.enum(OBLIGATION_TYPES),
  responsibleMemberId: optionalId,
  dueDate: optionalBusinessDate,
});

export type ObligationInput = z.infer<typeof obligationSchema>;

export const obligationCloseSchema = z.object({ note: optionalText(2000) });

export const obligationListQuerySchema = z.object({
  status: z.array(z.enum(OBLIGATION_STATUSES)).optional(),
  obligationType: z.array(z.enum(OBLIGATION_TYPES)).optional(),
  responsibleMemberId: z.string().optional(),
  contractId: z.string().optional(),
  overdueOnly: z.boolean().default(false),
  page: z.number().int().min(1).default(1),
  limit: z.number().int().min(1).max(100).default(25),
});

export type ObligationListQuery = z.infer<typeof obligationListQuerySchema>;

/** The task an obligation may spawn (PRD #18 §154, §155). */
export const obligationTaskSchema = z.object({
  title: requiredText(2, 200, "Task title"),
  description: optionalText(2000),
  assigneeMemberId: optionalId,
  dueDate: optionalBusinessDate,
});

export type ObligationTaskInput = z.infer<typeof obligationTaskSchema>;
