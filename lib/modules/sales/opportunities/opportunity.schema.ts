import { z } from "zod";

import { optionalDate, optionalText, requiredText } from "@/lib/modules/shared/fields";
import {
  amountString,
  currencyCode,
  optionalBusinessDate,
  businessDate,
} from "@/lib/modules/finance/finance.fields";

/**
 * Opportunity validation (PRD #17 §77, §210, §223, §224).
 *
 * The weighted value is absent from every schema here: the server derives it
 * from the estimate and the effective probability on every read, so there is no
 * figure the browser can propose (PRD #17 §224).
 */

export const OPPORTUNITY_STAGE_VALUES = [
  "PROSPECTING",
  "QUALIFIED",
  "DISCOVERY",
  "PROPOSAL",
  "NEGOTIATION",
  "WON",
  "LOST",
] as const;

/** Stages a create or edit form may set directly (PRD #17 §76, §82). */
export const OPEN_STAGE_VALUES = [
  "PROSPECTING",
  "QUALIFIED",
  "DISCOVERY",
  "PROPOSAL",
  "NEGOTIATION",
] as const;

export const LOST_REASONS = [
  "PRICE",
  "COMPETITOR",
  "TIMING",
  "NO_BUDGET",
  "NO_RESPONSE",
  "SCOPE_MISMATCH",
  "INTERNAL_DECISION",
  "OTHER",
] as const;

/** 0–100 as a string, so a percentage never becomes a float on the way in. */
const probability = z
  .string()
  .trim()
  .optional()
  .transform((value) => (value === "" || value === undefined ? undefined : value))
  .refine(
    (value) => {
      if (value === undefined) return true;
      if (!/^\d{1,3}(\.\d{1,2})?$/.test(value)) return false;
      const parsed = Number.parseFloat(value);
      return parsed >= 0 && parsed <= 100;
    },
    { message: "Probability must be between 0 and 100" },
  );

const opportunityFields = {
  name: requiredText(2, 200, "Name"),
  ownerMemberId: z.string().trim().min(1, "Choose an owner"),
  stage: z.enum(OPEN_STAGE_VALUES),
  estimatedValue: amountString("Estimated value").refine(
    (value) => Number.parseFloat(value) > 0,
    { message: "Estimated value must be greater than zero" },
  ),
  currency: currencyCode,
  clientId: z
    .string()
    .trim()
    .optional()
    .transform((value) => (value === "" ? undefined : value)),
  contactId: z
    .string()
    .trim()
    .optional()
    .transform((value) => (value === "" ? undefined : value)),
  expectedCloseDate: optionalBusinessDate,
  probabilityOverride: probability,
  description: optionalText(5000),
  nextStep: optionalText(500),
};

/** A contact without a client has nothing to belong to (PRD #17 §65, §219). */
const contactNeedsClient = <T extends { clientId?: string; contactId?: string }>(
  schema: z.ZodType<T>,
) =>
  schema.refine((value) => !value.contactId || Boolean(value.clientId), {
    message: "Choose the client this contact belongs to.",
    path: ["contactId"],
  });

export const createOpportunitySchema = contactNeedsClient(z.object(opportunityFields));

export const updateOpportunitySchema = contactNeedsClient(
  z.object({ ...opportunityFields, versionUpdatedAt: optionalDate }),
);

export type CreateOpportunityInput = z.infer<typeof createOpportunitySchema>;
export type UpdateOpportunityInput = z.infer<typeof updateOpportunitySchema>;

export const assignOpportunitySchema = z.object({
  ownerMemberId: z.string().trim().min(1, "Choose an owner"),
});

export const opportunityStageSchema = z.object({
  stage: z.enum(OPEN_STAGE_VALUES),
});

/** Where a won deal goes next (PRD #17 §88, §212). */
export const PROJECT_MODES = ["NONE", "EXISTING", "NEW"] as const;
export const WON_CLIENT_MODES = ["KEEP", "EXISTING", "NEW"] as const;

export const opportunityWonSchema = z
  .object({
    actualCloseDate: businessDate,
    finalValue: amountString("Final value").refine(
      (value) => Number.parseFloat(value) > 0,
      { message: "Final value must be greater than zero" },
    ),
    wonReason: optionalText(1000),
    clientMode: z.enum(WON_CLIENT_MODES).default("KEEP"),
    clientId: z
      .string()
      .trim()
      .optional()
      .transform((value) => (value === "" ? undefined : value)),
    newClientName: optionalText(200),
    projectMode: z.enum(PROJECT_MODES).default("NONE"),
    projectId: z
      .string()
      .trim()
      .optional()
      .transform((value) => (value === "" ? undefined : value)),
    newProjectCode: optionalText(30),
    newProjectName: optionalText(200),
  })
  .refine((value) => value.clientMode !== "EXISTING" || Boolean(value.clientId), {
    message: "Choose the client to link.",
    path: ["clientId"],
  })
  .refine((value) => value.clientMode !== "NEW" || Boolean(value.newClientName), {
    message: "Name the client to create.",
    path: ["newClientName"],
  })
  .refine((value) => value.projectMode !== "EXISTING" || Boolean(value.projectId), {
    message: "Choose the project to link.",
    path: ["projectId"],
  })
  .refine(
    (value) =>
      value.projectMode !== "NEW" || (Boolean(value.newProjectCode) && Boolean(value.newProjectName)),
    { message: "A new project needs a code and a name.", path: ["newProjectName"] },
  );

export type OpportunityWonInput = z.infer<typeof opportunityWonSchema>;

/** A lost deal must say why, and "OTHER" must say what (PRD #17 §93, §95). */
export const opportunityLostSchema = z
  .object({
    actualCloseDate: businessDate,
    lostReason: z.enum(LOST_REASONS),
    lostNote: optionalText(2000),
  })
  .refine((value) => value.lostReason !== "OTHER" || Boolean(value.lostNote), {
    message: "Say what happened.",
    path: ["lostNote"],
  });

export type OpportunityLostInput = z.infer<typeof opportunityLostSchema>;

/** Linking a project to an already-won deal (PRD #17 §423). */
export const linkProjectSchema = z.object({
  projectId: z.string().trim().min(1, "Choose a project"),
});

export const OPPORTUNITY_SORT_KEYS = [
  "updated-desc",
  "close-asc",
  "value-desc",
  "weighted-desc",
  "probability-desc",
  "stage-asc",
  "name-asc",
] as const;

export type OpportunitySortKey = (typeof OPPORTUNITY_SORT_KEYS)[number];

export const OPPORTUNITY_OUTCOMES = ["OPEN", "WON", "LOST"] as const;

export const opportunityListQuerySchema = z.object({
  search: z.string().trim().max(200).optional(),
  stage: z.array(z.enum(OPPORTUNITY_STAGE_VALUES)).optional(),
  outcome: z.array(z.enum(OPPORTUNITY_OUTCOMES)).optional(),
  ownerMemberId: z.string().optional(),
  clientId: z.string().optional(),
  currency: z.string().optional(),
  minValue: z.string().optional(),
  maxValue: z.string().optional(),
  minProbability: z.number().optional(),
  maxProbability: z.number().optional(),
  closeFrom: optionalDate,
  closeTo: optionalDate,
  mine: z.boolean().default(false),
  archived: z.boolean().default(false),
  page: z.number().int().min(1).default(1),
  limit: z.number().int().min(1).max(100).default(25),
  sort: z.enum(OPPORTUNITY_SORT_KEYS).default("updated-desc"),
});

export type OpportunityListQuery = z.infer<typeof opportunityListQuerySchema>;
