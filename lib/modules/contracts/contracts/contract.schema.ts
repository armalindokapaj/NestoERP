import { z } from "zod";

import {
  businessDate,
  clearableBusinessDate,
  clearableText,
  clearableWholeNumber,
  currencyCode,
  MONEY_RULE,
  optionalBusinessDate,
  optionalDecimalString,
  optionalWholeNumber,
} from "@/lib/modules/finance/finance.fields";
import { optionalBoolean } from "@/lib/modules/shared/fields";
import {
  optionalDate,
  optionalId,
  optionalText,
  requiredText,
} from "@/lib/modules/shared/fields";
import { CONTRACT_STATUSES } from "./contract.status";

/**
 * Contract validation (PRD #18 §269–§276).
 *
 * `status`, `companyId` and every actor field are absent on purpose. Status
 * moves through named lifecycle actions and nowhere else, so there is nothing
 * for a generic update to set and nothing for a browser to lie about
 * (PRD #18 §192, §269).
 */

export const CONTRACT_TYPES = [
  "CLIENT_AGREEMENT",
  "SERVICE_AGREEMENT",
  "PURCHASE_AGREEMENT",
  "SUBCONTRACT",
  "LEASE",
  "NDA",
  "CONSULTING",
  "FRAMEWORK",
  "EMPLOYMENT_RELATED",
  "SALE_AGREEMENT",
  "OTHER",
] as const;

/**
 * The types a person picks on the contract form. A sale agreement is drafted
 * from the unit it sells, never from a blank form, because its client, deal,
 * project and value come from the units (E-05F §12, §13).
 */
export const FORM_CONTRACT_TYPES = CONTRACT_TYPES.filter((type) => type !== "SALE_AGREEMENT");

export const RENEWAL_TYPES = ["NONE", "MANUAL", "AUTO_RENEW", "EVERGREEN"] as const;

export const MAX_RENEWAL_NOTICE_DAYS = 3650;
export const MAX_AUTO_RENEW_MONTHS = 120;

/**
 * An optional amount that must be a decimal string when present (PRD #18 §63),
 * by the shared decimal rule (AUD-09 §4, FV-06): `1,234` is refused as
 * ambiguous rather than read as 1.234.
 */
const optionalContractValue = optionalDecimalString("Contract value", MONEY_RULE);

const contractFields = {
  contractNumber: requiredText(2, 80, "Contract number"),
  title: requiredText(2, 250, "Title"),
  contractType: z.enum(CONTRACT_TYPES),
  ownerMemberId: z.string().trim().min(1, "Choose a contract owner"),

  clientId: optionalId,
  projectId: optionalId,
  opportunityId: optionalId,
  proposalId: optionalId,

  counterpartyName: optionalText(250),

  currency: z
    .union([currencyCode, z.literal("")])
    .optional()
    .transform((value) => (value === "" || value === undefined ? undefined : value)),
  contractValue: optionalContractValue,

  effectiveDate: optionalBusinessDate,
  expiryDate: optionalBusinessDate,
  signedDate: optionalBusinessDate,

  renewalType: z.enum(RENEWAL_TYPES).default("NONE"),
  // Whole numbers; empty is "not set" — `z.coerce.number()` stored an empty
  // "Notice days" as 0, and read "1e3" as 1000 (AUD-09 §4, FV-06).
  renewalNoticeDays: optionalWholeNumber("Notice days", 0, MAX_RENEWAL_NOTICE_DAYS),
  autoRenewalPeriodMonths: optionalWholeNumber("Renewal period", 1, MAX_AUTO_RENEW_MONTHS),

  governingLaw: optionalText(200),
  jurisdiction: optionalText(200),

  summary: optionalText(5000),
  commercialNotes: optionalText(5000),
  legalNotes: optionalText(5000),
};

type ContractShape = {
  currency?: string;
  contractValue?: string;
  effectiveDate?: Date | null;
  expiryDate?: Date | null;
  renewalType: (typeof RENEWAL_TYPES)[number];
  renewalNoticeDays?: number | null;
  autoRenewalPeriodMonths?: number | null;
  opportunityId?: string;
  proposalId?: string;
};

/**
 * The cross-field rules (PRD #18 §273, §275, §69).
 *
 * `signedDate <= effectiveDate` is deliberately *not* enforced: agreements are
 * routinely signed after they take effect, and a product that refuses to record
 * that is a product people work around (PRD #18 §69).
 */
function withContractRules<T extends ContractShape>(schema: z.ZodType<T>) {
  return schema
    .refine((value) => value.contractValue === undefined || value.currency !== undefined, {
      message: "Choose a currency for the contract value.",
      path: ["currency"],
    })
    .refine(
      (value) =>
        !value.effectiveDate ||
        !value.expiryDate ||
        value.expiryDate.getTime() >= value.effectiveDate.getTime(),
      { message: "The expiry date cannot be before the effective date.", path: ["expiryDate"] },
    )
    .refine(
      (value) =>
        value.renewalType !== "AUTO_RENEW" ||
        (value.expiryDate != null && value.autoRenewalPeriodMonths != null),
      {
        message: "An auto-renewing contract needs an expiry date and a renewal period.",
        path: ["autoRenewalPeriodMonths"],
      },
    )
    .refine(
      (value) => value.renewalType === "AUTO_RENEW" || value.autoRenewalPeriodMonths == null,
      {
        message: "A renewal period only applies to an auto-renewing contract.",
        path: ["autoRenewalPeriodMonths"],
      },
    )
    .refine((value) => value.renewalType !== "NONE" || value.renewalNoticeDays == null, {
      message: "Notice days only apply to a contract that renews.",
      path: ["renewalNoticeDays"],
    });
}

export const createContractSchema = withContractRules(z.object({ ...contractFields }));

/**
 * An edit of a draft's terms (AUD-09 §4, FV-05). The terms the rules above
 * compare (renewal type, dates, numbers) and the core fields are sent as on
 * create; the free-text and note fields keep what is saved when their key is
 * absent and clear when sent empty — the form always sends them, so this only
 * stops an API caller that leaves one out from erasing it.
 */
export const updateContractSchema = withContractRules(
  z.object({
    ...contractFields,
    counterpartyName: clearableText(250),
    signedDate: clearableBusinessDate,
    governingLaw: clearableText(200),
    jurisdiction: clearableText(200),
    summary: clearableText(5000),
    commercialNotes: clearableText(5000),
    legalNotes: clearableText(5000),
    renewalNoticeDays: clearableWholeNumber("Notice days", 0, MAX_RENEWAL_NOTICE_DAYS),
    autoRenewalPeriodMonths: clearableWholeNumber("Renewal period", 1, MAX_AUTO_RENEW_MONTHS),
    versionUpdatedAt: optionalDate,
  }),
);

/**
 * What may still be corrected after approval (PRD #18 §107).
 *
 * Owner and internal summary. Not the value, not the dates, not the parties —
 * those change by amendment, which leaves a record of who agreed to the change.
 */
export const updateContractMetadataSchema = z.object({
  ownerMemberId: z.string().trim().min(1, "Choose a contract owner"),
  // Absent keeps the summary; empty clears it (FV-05).
  summary: clearableText(5000),
  versionUpdatedAt: optionalDate,
});

export type CreateContractInput = z.infer<typeof createContractSchema>;
export type UpdateContractInput = z.infer<typeof updateContractSchema>;
export type UpdateContractMetadataInput = z.infer<typeof updateContractMetadataSchema>;

/* -------------------------------------------------------------------------- */
/* Lifecycle actions                                                           */
/* -------------------------------------------------------------------------- */

export const contractNoteSchema = z.object({ note: optionalText(2000) });
export const contractReasonSchema = z.object({ note: requiredText(3, 2000, "Reason") });

/** Signing needs a date; the signed file is a warning, not a gate (PRD #18 §118, §119). */
export const contractSignedSchema = z.object({
  signedDate: businessDate,
  // "false" is false (`z.coerce.boolean()` read the string as true).
  acknowledgeMissingDocument: optionalBoolean.transform((value) => value ?? false),
});

export const contractActivationSchema = z.object({
  effectiveDate: optionalBusinessDate,
});

/** Ending an agreement early needs a date and a reason (PRD #18 §276). */
export const contractTerminationSchema = z.object({
  terminationDate: businessDate,
  terminationReason: requiredText(2, 2000, "Termination reason"),
});

export const contractOwnerSchema = z.object({
  ownerMemberId: z.string().trim().min(1, "Choose a contract owner"),
});

export type ContractSignedInput = z.infer<typeof contractSignedSchema>;
export type ContractTerminationInput = z.infer<typeof contractTerminationSchema>;

/* -------------------------------------------------------------------------- */
/* List query                                                                  */
/* -------------------------------------------------------------------------- */

export const CONTRACT_SORT_KEYS = [
  "updated-desc",
  "created-desc",
  "number-asc",
  "title-asc",
  "effective-desc",
  "expiry-asc",
  "value-desc",
  "status-asc",
] as const;

export type ContractSortKey = (typeof CONTRACT_SORT_KEYS)[number];

/** The named views, each a saved set of filters over the same list (PRD #18 §87–§93). */
export const CONTRACT_VIEWS = [
  "all",
  "drafts",
  "review",
  "active",
  "expiring",
  "expired",
  "terminated",
  "archived",
] as const;

export type ContractView = (typeof CONTRACT_VIEWS)[number];

export const EXPIRING_WINDOWS = [30, 60, 90, 180] as const;

export const contractListQuerySchema = z.object({
  search: z.string().trim().max(200).optional(),
  view: z.enum(CONTRACT_VIEWS).default("all"),
  status: z.array(z.enum(CONTRACT_STATUSES)).optional(),
  contractType: z.array(z.enum(CONTRACT_TYPES)).optional(),
  renewalType: z.array(z.enum(RENEWAL_TYPES)).optional(),
  clientId: z.string().optional(),
  projectId: z.string().optional(),
  ownerMemberId: z.string().optional(),
  currency: z.string().optional(),
  effectiveFrom: optionalDate,
  effectiveTo: optionalDate,
  expiryFrom: optionalDate,
  expiryTo: optionalDate,
  /** Days ahead for the expiring view (PRD #18 §90). */
  expiringWithin: z.number().int().min(1).max(365).optional(),
  mine: z.boolean().default(false),
  page: z.number().int().min(1).default(1),
  limit: z.number().int().min(1).max(100).default(25),
  sort: z.enum(CONTRACT_SORT_KEYS).default("updated-desc"),
});

export type ContractListQuery = z.infer<typeof contractListQuerySchema>;

export const contractTypeLabels: Record<(typeof CONTRACT_TYPES)[number], string> = {
  CLIENT_AGREEMENT: "Client agreement",
  SERVICE_AGREEMENT: "Service agreement",
  PURCHASE_AGREEMENT: "Purchase agreement",
  SUBCONTRACT: "Subcontract",
  LEASE: "Lease",
  NDA: "NDA",
  CONSULTING: "Consulting",
  FRAMEWORK: "Framework",
  EMPLOYMENT_RELATED: "Employment-related",
  SALE_AGREEMENT: "Sale agreement",
  OTHER: "Other",
};
