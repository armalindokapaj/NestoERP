import { z } from "zod";

import { parseLeniently } from "@/lib/modules/finance/units/unit-finance.schema";
import { idSchema } from "@/lib/modules/project-structure/structure.schema";
import { LEGAL_REASON_MAX } from "./unit-contract.types";

/**
 * Validation for a unit's contract (E-05F §110). Shapes only: whether the unit is
 * reserved, the price agreed and the units belong to one client and deal is the
 * service's question, asked where it can be answered.
 */

const blank = (value: unknown) => (value === "" || value === undefined ? undefined : value);
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `Keep this under ${max.toLocaleString("en")} characters.`)
    .optional()
    .nullable()
    .transform((value) => (value ? value : null));

const money = z.preprocess(
  (value) => (typeof value === "number" ? String(value) : typeof value === "string" ? value.trim().replace(/\s/g, "").replace(",", ".") : value),
  z.string({ error: "Enter the unit's value." }).regex(/^\d{1,16}(\.\d{1,2})?$/, "Enter the value as a number with at most two decimals."),
);

export const requestContractSchema = z.object({ notes: optionalText(2_000) });

export const declineRequestSchema = z.object({
  reason: z.string().trim().min(3, "Give a reason.").max(LEGAL_REASON_MAX, `Keep the reason under ${LEGAL_REASON_MAX.toLocaleString("en")} characters.`),
});

export const createUnitContractSchema = z.object({
  /** Typed only where the company numbers contracts by hand. */
  contractNumber: z.preprocess(blank, z.string().trim().min(2, "Contract number must be at least 2 characters").max(80).optional()),
  title: z.preprocess(blank, z.string().trim().min(2).max(250).optional()),
  /** More units of the same client and deal on this contract: parking, storage (§88). */
  additionalUnitIds: z.array(idSchema).max(20).default([]),
  /** A unit's part of the value when it differs from Sales' agreed price, with why (§14, §90). */
  values: z
    .array(z.object({ unitId: idSchema, value: money, valueNote: optionalText(LEGAL_REASON_MAX) }))
    .max(21)
    .default([]),
  summary: optionalText(4_000),
});

export const contractUnitValueSchema = z.object({
  value: money,
  valueNote: optionalText(LEGAL_REASON_MAX),
});

export const CONTRACT_REQUEST_VIEWS = ["open", "closed"] as const;
export const contractRequestQuerySchema = z.object({
  view: z.preprocess(blank, z.enum(CONTRACT_REQUEST_VIEWS).default("open")),
  projectId: z.preprocess(blank, idSchema.optional()),
  q: z.preprocess(blank, z.string().trim().max(200).optional()),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
export type ContractRequestQuery = z.infer<typeof contractRequestQuerySchema>;

export function parseContractRequestQuery(search: URLSearchParams | Record<string, string | string[] | undefined>): ContractRequestQuery {
  return parseLeniently(contractRequestQuerySchema, search);
}
