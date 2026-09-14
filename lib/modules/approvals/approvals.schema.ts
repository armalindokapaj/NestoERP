import { z } from "zod";

import {
  APPROVAL_PRIORITIES,
  APPROVAL_SORTS,
  APPROVAL_TABS,
  DUE_STATES,
  PROVIDER_KEYS,
  UNIFIED_APPROVAL_STATUSES,
  type ApprovalSort,
  type ApprovalTab,
} from "./approvals.types";

/**
 * Validation for the Approvals Center (PRD #41 §114-§121, §193).
 *
 * Nothing the browser sends names a status to move to: a decision is one of
 * three commands, and the provider key must be one the registry knows (§240,
 * §241). Filters that do not parse are dropped rather than failing the page.
 */

const ID = /^[A-Za-z0-9_-]{1,64}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** A comma list of allowed values, from one or repeated query parameters. */
function csvOf<T extends readonly [string, ...string[]]>(values: T) {
  return z
    .union([z.string(), z.array(z.string())])
    .optional()
    .transform((raw) => {
      const parts = (Array.isArray(raw) ? raw : raw ? [raw] : []).flatMap((part) => part.split(","));
      const allowed = new Set<string>(values);
      return [...new Set(parts.map((part) => part.trim()).filter((part) => allowed.has(part)))] as T[number][];
    });
}

const optionalId = z
  .string()
  .optional()
  .transform((value) => (value && ID.test(value) ? value : undefined));

const optionalDate = z
  .string()
  .optional()
  .transform((value) => (value && DATE.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`)) ? value : undefined));

const optionalAmount = z
  .string()
  .optional()
  .transform((value) => {
    if (!value || !/^\d{1,15}(\.\d{1,2})?$/.test(value.trim())) return undefined;
    return Number.parseFloat(value);
  });

export const DEFAULT_SORT: Record<ApprovalTab, ApprovalSort> = {
  waiting: "urgency",
  requested: "newest",
  approved: "newest",
  rejected: "newest",
  returned: "newest",
  history: "newest",
};

export const approvalQuerySchema = z
  .object({
    tab: z.enum(APPROVAL_TABS).catch("waiting").default("waiting"),
    provider: csvOf(PROVIDER_KEYS),
    status: csvOf(UNIFIED_APPROVAL_STATUSES),
    priority: csvOf(APPROVAL_PRIORITIES),
    dueState: csvOf(DUE_STATES),
    projectId: optionalId,
    requesterId: optionalId,
    from: optionalDate,
    to: optionalDate,
    amountMin: optionalAmount,
    amountMax: optionalAmount,
    q: z
      .string()
      .optional()
      .transform((value) => value?.trim().slice(0, 100) || undefined),
    sort: z.enum(APPROVAL_SORTS).optional().catch(undefined),
    /** On Returned: returned by me, to me, or both (§89). */
    returned: z.enum(["by", "to", "all"]).catch("all").default("all"),
    cursor: z
      .string()
      .max(600)
      .optional()
      .catch(undefined),
    limit: z.coerce.number().int().min(1).max(100).catch(25).default(25),
  })
  .transform((value) => ({ ...value, sort: value.sort ?? DEFAULT_SORT[value.tab] }));

export type ApprovalQuery = z.infer<typeof approvalQuerySchema>;

export const providerKeySchema = z.enum(PROVIDER_KEYS);

export const approvalRefSchema = z.object({
  providerKey: providerKeySchema,
  approvalId: z.string().regex(ID),
});

/** `procurement:abc123`, as it appears in a link (§197). */
export function parseApprovalRef(value: string | null | undefined): { providerKey: (typeof PROVIDER_KEYS)[number]; approvalId: string } | null {
  if (!value) return null;
  const [providerKey, approvalId, extra] = value.split(":");
  if (extra !== undefined) return null;
  const parsed = approvalRefSchema.safeParse({ providerKey, approvalId });
  return parsed.success ? parsed.data : null;
}

const note = z.string().trim().max(5000, "Keep the note under 5,000 characters.");

export const approveInputSchema = z.object({
  note: note.optional().transform((value) => value || null),
  expectedVersion: z.number().int().min(1).optional(),
});

/** Reject and Return need a reason: the requester has to know what to change (§45, §206, §207). */
export const reasonInputSchema = z.object({
  note: note.min(1, "Give a reason."),
  expectedVersion: z.number().int().min(1).optional(),
});

export type ApproveInput = z.infer<typeof approveInputSchema>;
export type ReasonInput = z.infer<typeof reasonInputSchema>;

/** A retry-safe key the client sends with a decision (§123). */
export function parseIdempotencyKey(value: string | null): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  return /^[A-Za-z0-9._:-]{8,100}$/.test(trimmed) ? trimmed : null;
}

export const createDelegationSchema = z
  .object({
    toMemberId: z.string().regex(ID, "Choose who will decide for you."),
    providerKey: providerKeySchema.nullable().default(null),
    startsOn: z.string().regex(DATE, "Choose a start date."),
    endsOn: z.string().regex(DATE, "Choose an end date."),
    reason: z
      .string()
      .trim()
      .max(500)
      .optional()
      .transform((value) => value || null),
  })
  .refine((value) => value.endsOn >= value.startsOn, { message: "The end date cannot be before the start date.", path: ["endsOn"] });

export type CreateDelegationInput = z.infer<typeof createDelegationSchema>;
