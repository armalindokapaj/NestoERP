import { z } from "zod";

import { optionalDate, optionalText, requiredText } from "@/lib/modules/shared/fields";
import { currencyCode, optionalAmountString } from "@/lib/modules/finance/finance.fields";

/**
 * Lead validation (PRD #17 §43, §210, §223).
 *
 * `companyId`, `status`, `createdByMemberId` and every conversion field are
 * absent on purpose: they are the server's to set, so there is nothing for the
 * browser to send and nothing for it to lie about (PRD #17 §223).
 */

export const LEAD_SOURCES = [
  "WEBSITE",
  "REFERRAL",
  "OUTBOUND",
  "EVENT",
  "PARTNER",
  "SOCIAL",
  "DIRECT",
  "OTHER",
] as const;

export const LEAD_STATUSES = [
  "NEW",
  "CONTACTED",
  "QUALIFIED",
  "DISQUALIFIED",
  "CONVERTED",
  "ARCHIVED",
] as const;

/**
 * A website must be a link somebody can safely click (PRD #17 §43).
 *
 * `javascript:` and `data:` URLs are the reason this is an allowlist of two
 * schemes rather than "looks like a URL".
 */
const websiteUrl = z
  .string()
  .trim()
  .optional()
  .transform((value) => (value === "" ? undefined : value))
  .refine(
    (value) => {
      if (!value) return true;
      try {
        const url = new URL(value);
        return url.protocol === "http:" || url.protocol === "https:";
      } catch {
        return false;
      }
    },
    { message: "Enter a full web address beginning http:// or https://" },
  );

const optionalEmail = z
  .string()
  .trim()
  .optional()
  .transform((value) => (value === "" ? undefined : value))
  .refine((value) => !value || z.string().email().safeParse(value).success, {
    message: "Enter a valid email address",
  });

const leadFields = {
  name: requiredText(2, 200, "Name"),
  companyName: optionalText(200),
  email: optionalEmail,
  phone: optionalText(40),
  website: websiteUrl,
  source: z.enum(LEAD_SOURCES),
  ownerMemberId: z
    .string()
    .trim()
    .optional()
    .transform((value) => (value === "" ? undefined : value)),
  estimatedValue: optionalAmountString("Estimated value"),
  currency: currencyCode.optional(),
  notes: optionalText(5000),
};

/**
 * A value without a currency is not a value (PRD #17 §43).
 *
 * "120,000" means nothing to a pipeline that has to group by currency before it
 * may add anything up (PRD #17 §31).
 */
const valueNeedsCurrency = <T extends { estimatedValue?: string; currency?: string }>(
  schema: z.ZodType<T>,
) =>
  schema.refine(
    (value) => {
      const amount = Number.parseFloat(value.estimatedValue ?? "0");
      return !(amount > 0) || Boolean(value.currency);
    },
    { message: "Choose a currency for the estimated value.", path: ["currency"] },
  );

export const createLeadSchema = valueNeedsCurrency(z.object(leadFields));

export const updateLeadSchema = valueNeedsCurrency(
  z.object({ ...leadFields, versionUpdatedAt: optionalDate }),
);

export type CreateLeadInput = z.infer<typeof createLeadSchema>;
export type UpdateLeadInput = z.infer<typeof updateLeadSchema>;

export const assignLeadSchema = z.object({
  ownerMemberId: z.string().trim().min(1, "Choose an owner"),
});

export const disqualifyLeadSchema = z.object({
  reason: requiredText(3, 500, "Reason"),
});

/**
 * Lead conversion (PRD #17 §52, §211).
 *
 * `clientMode` is the shape of the decision the user actually makes, so the
 * server never has to guess whether a missing `clientId` meant "no client yet"
 * or "the form lost it" (PRD #17 §159).
 */
export const CLIENT_MODES = ["NONE", "EXISTING", "NEW"] as const;

export const convertLeadSchema = z
  .object({
    opportunityName: requiredText(2, 200, "Opportunity name"),
    ownerMemberId: z.string().trim().min(1, "Choose an owner"),
    estimatedValue: z
      .string()
      .trim()
      .refine((value) => Number.parseFloat(value) > 0, {
        message: "Estimated value must be greater than zero",
      }),
    currency: currencyCode,
    expectedCloseDate: optionalDate,
    clientMode: z.enum(CLIENT_MODES).default("NONE"),
    clientId: z
      .string()
      .trim()
      .optional()
      .transform((value) => (value === "" ? undefined : value)),
    newClientName: optionalText(200),
    /** Past the duplicate warning, which is a warning and not a block (§44). */
    acceptDuplicate: z.coerce.boolean().default(false),
  })
  .refine((value) => value.clientMode !== "EXISTING" || Boolean(value.clientId), {
    message: "Choose the client to link.",
    path: ["clientId"],
  })
  .refine((value) => value.clientMode !== "NEW" || Boolean(value.newClientName), {
    message: "Name the client to create.",
    path: ["newClientName"],
  });

export type ConvertLeadInput = z.infer<typeof convertLeadSchema>;

export const LEAD_SORT_KEYS = [
  "updated-desc",
  "created-desc",
  "name-asc",
  "value-desc",
  "status-asc",
  "owner-asc",
] as const;

export type LeadSortKey = (typeof LEAD_SORT_KEYS)[number];

export const leadListQuerySchema = z.object({
  search: z.string().trim().max(200).optional(),
  status: z.array(z.enum(LEAD_STATUSES)).optional(),
  source: z.array(z.enum(LEAD_SOURCES)).optional(),
  ownerMemberId: z.string().optional(),
  currency: z.string().optional(),
  minValue: z.string().optional(),
  maxValue: z.string().optional(),
  createdFrom: optionalDate,
  createdTo: optionalDate,
  mine: z.boolean().default(false),
  archived: z.boolean().default(false),
  page: z.number().int().min(1).default(1),
  limit: z.number().int().min(1).max(100).default(25),
  sort: z.enum(LEAD_SORT_KEYS).default("updated-desc"),
});

export type LeadListQuery = z.infer<typeof leadListQuerySchema>;
