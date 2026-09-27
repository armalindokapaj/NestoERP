import { z } from "zod";
import { AuditAction } from "@/lib/core/audit/audit-policy.registry";
import { recordUserAction } from "@/lib/core/audit/audit.service";

import { assertPermission } from "@/lib/access/guards";
import type { UserContext } from "@/lib/context/types";
import { prisma } from "@/lib/database/prisma";
import { formatNumber } from "@/lib/core/numbering/numbering.service";

/**
 * Numbering scheme administration (PRD #24 §114-§119).
 *
 * Changing a scheme affects future records only; numbers already issued stay
 * exactly as they were (PRD #24 §117, §196).
 */

/**
 * The format fields apply to automatic numbering only. The form disables them
 * for a manual scheme, and a disabled control posts nothing — so each may be
 * absent, and an absent one keeps what is stored: switching a scheme to
 * manual no longer failed validation or reset its format (AUD-09 §4, §5,
 * FV-05, FV-10: the "omit/preserve" policy).
 */
export const numberingSchemeSchema = z.object({
  mode: z.enum(["MANUAL", "AUTO"], { message: "Choose automatic or manual numbering" }),
  prefix: z
    .string()
    .trim()
    .max(20, "Keep the prefix to 20 characters")
    .regex(/^[A-Z0-9_-]*$/, "Use A-Z, 0-9, hyphen or underscore")
    .optional()
    .transform((v) => (v === undefined ? undefined : v === "" ? null : v)),
  separator: z.string().max(1, "One character at most").optional(),
  yearMode: z.enum(["NONE", "YYYY", "YY"]).optional(),
  padding: z.coerce.number().int().min(3, "At least 3 digits").max(10, "At most 10 digits").optional(),
  resetSequenceYearly: z.boolean().optional(),
});

export type NumberingSchemeInput = z.infer<typeof numberingSchemeSchema>;

export type NumberingSchemeDTO = Required<NumberingSchemeInput> & {
  moduleKey: string;
  entityType: string;
  nextSequence: number;
  preview: string;
  canManage: boolean;
};

function toDTO(row: {
  moduleKey: string;
  entityType: string;
  mode: string;
  prefix: string | null;
  separator: string;
  yearMode: string;
  padding: number;
  resetSequenceYearly: boolean;
  nextSequence: number;
}, canManage: boolean): NumberingSchemeDTO {
  return {
    moduleKey: row.moduleKey,
    entityType: row.entityType,
    mode: row.mode as "MANUAL" | "AUTO",
    prefix: row.prefix,
    separator: row.separator,
    yearMode: row.yearMode as "NONE" | "YYYY" | "YY",
    padding: row.padding,
    resetSequenceYearly: row.resetSequenceYearly,
    nextSequence: row.nextSequence,
    preview: formatNumber(
      {
        prefix: row.prefix,
        separator: row.separator,
        yearMode: row.yearMode as "NONE" | "YYYY" | "YY",
        padding: row.padding,
        nextSequence: row.nextSequence,
      },
      new Date().getUTCFullYear(),
    ),
    canManage,
  };
}

export async function listNumberingSchemes(context: UserContext): Promise<NumberingSchemeDTO[]> {
  assertPermission(context, "company.numbering.view");
  const canManage = context.permissions.includes("company.numbering.manage");
  const rows = await prisma.companyNumberingScheme.findMany({
    where: { companyId: context.companyId },
    orderBy: [{ moduleKey: "asc" }, { entityType: "asc" }],
  });
  return rows.map((r) => toDTO(r, canManage));
}

export async function updateNumberingScheme(
  context: UserContext,
  moduleKey: string,
  entityType: string,
  input: NumberingSchemeInput,
): Promise<NumberingSchemeDTO> {
  assertPermission(context, "company.numbering.manage");

  const existing = await prisma.companyNumberingScheme.findUnique({
    where: { companyId_moduleKey_entityType: { companyId: context.companyId, moduleKey, entityType } },
  });
  if (!existing) throw new Error("NUMBERING_SCHEME_NOT_FOUND");

  const row = await prisma.companyNumberingScheme.update({
    where: { id: existing.id },
    data: { ...input, updatedByMemberId: context.membershipId },
  });

  // A numbering scheme decides how every future record in that module is
  // identified, so the change is evidence (PRD #28 §98).
  await recordUserAction(context, {
    actionKey: AuditAction.COMPANY_NUMBERING_CHANGED,
    entity: { type: "company_numbering_scheme", id: row.id, label: `${moduleKey}.${entityType}` },
    before: {
      moduleKey: existing.moduleKey,
      entityType: existing.entityType,
      mode: existing.mode,
      prefix: existing.prefix,
      yearMode: existing.yearMode,
      padding: existing.padding,
    },
    after: {
      moduleKey: row.moduleKey,
      entityType: row.entityType,
      mode: row.mode,
      prefix: row.prefix,
      yearMode: row.yearMode,
      padding: row.padding,
    },
  });

  return toDTO(row, true);
}
