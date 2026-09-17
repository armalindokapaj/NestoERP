import { UnitSoldRule } from "@prisma/client";
import { z } from "zod";

import { can, isModuleEnabled } from "@/lib/access/can";
import { assertPermission } from "@/lib/access/guards";
import type { UserContext } from "@/lib/context/types";
import { AuditAction } from "@/lib/core/audit/audit-policy.registry";
import { recordUserAction } from "@/lib/core/audit/audit.service";
import { prisma } from "@/lib/database/prisma";
import { ensureCompanySettings, writeCompanySettings } from "./company-settings.service";

/**
 * The company's unit sales defaults (E-05E §24; E-05F §42, §43): how long a
 * reservation lasts, and what a unit needs before Sales may mark it Sold. On the
 * company settings row, so a change bumps the company's configuration version
 * like every other setting.
 */

export const salesSettingsSchema = z.object({
  unitReservationDays: z.coerce.number().int("Enter whole days.").min(1, "At least one day.").max(90, "At most 90 days."),
  unitSoldRule: z.enum(Object.values(UnitSoldRule) as [UnitSoldRule, ...UnitSoldRule[]], { message: "Choose a Sold rule." }).optional(),
});
export type SalesSettingsInput = z.infer<typeof salesSettingsSchema>;
export type SalesSettingsDTO = { unitReservationDays: number; unitSoldRule: UnitSoldRule; baseCurrency: string; canUpdate: boolean; unavailableRules: UnitSoldRule[] };

/** What a reservation defaults to and what a sale needs in this company. No permission: services and jobs read it. */
export async function resolveUnitSalesSettings(companyId: string): Promise<{ unitReservationDays: number; unitSoldRule: UnitSoldRule; baseCurrency: string }> {
  const row = await ensureCompanySettings(companyId);
  return { unitReservationDays: row.unitReservationDays, unitSoldRule: row.unitSoldRule, baseCurrency: row.baseCurrency };
}

export async function getSalesSettings(context: UserContext): Promise<SalesSettingsDTO> {
  assertPermission(context, "company.settings.view");
  const settings = await resolveUnitSalesSettings(context.companyId);
  // A rule needing a switched-off module can never be met: the page says so rather than hiding it (E-05F §43).
  const contracts = isModuleEnabled(context, "contracts");
  const finance = isModuleEnabled(context, "finance");
  const unavailableRules = Object.values(UnitSoldRule).filter((rule) => (!contracts && (rule === "SIGNED_CONTRACT" || rule === "SIGNED_CONTRACT_AND_DEPOSIT")) || (!finance && (rule === "DEPOSIT_RECEIVED" || rule === "SIGNED_CONTRACT_AND_DEPOSIT")));
  return { ...settings, canUpdate: can(context, "company.settings.update"), unavailableRules };
}

export async function updateSalesSettings(context: UserContext, input: SalesSettingsInput): Promise<SalesSettingsDTO> {
  assertPermission(context, "company.settings.update");
  const before = await resolveUnitSalesSettings(context.companyId);
  const after = { unitReservationDays: input.unitReservationDays, unitSoldRule: input.unitSoldRule ?? before.unitSoldRule };
  if (before.unitReservationDays !== after.unitReservationDays || before.unitSoldRule !== after.unitSoldRule) {
    await prisma.$transaction(async (tx) => {
      await writeCompanySettings(tx, context.companyId, context.membershipId, after);
      await recordUserAction(
        context,
        {
          actionKey: AuditAction.COMPANY_SALES_SETTINGS_UPDATED,
          entity: { type: "company_settings", id: context.companyId, label: "Sales settings" },
          before: { unitReservationDays: before.unitReservationDays, unitSoldRule: before.unitSoldRule },
          after,
        },
        { tx },
      );
    });
  }
  return getSalesSettings(context);
}
