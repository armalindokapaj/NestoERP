import { z } from "zod";

import { can } from "@/lib/access/can";
import { assertPermission } from "@/lib/access/guards";
import type { UserContext } from "@/lib/context/types";
import { AuditAction } from "@/lib/core/audit/audit-policy.registry";
import { recordUserAction } from "@/lib/core/audit/audit.service";
import { prisma } from "@/lib/database/prisma";
import { ensureCompanySettings, writeCompanySettings } from "./company-settings.service";

/**
 * The company's unit sales defaults (E-05E §24). On the company settings row, so
 * a change bumps the company's configuration version like every other setting.
 * E-05F adds its Sold rule beside this.
 */

export const salesSettingsSchema = z.object({
  unitReservationDays: z.coerce.number().int("Enter whole days.").min(1, "At least one day.").max(90, "At most 90 days."),
});
export type SalesSettingsInput = z.infer<typeof salesSettingsSchema>;
export type SalesSettingsDTO = { unitReservationDays: number; baseCurrency: string; canUpdate: boolean };

/** What a reservation defaults to in this company. No permission: the reserve form and the expiry job both read it. */
export async function resolveUnitSalesSettings(companyId: string): Promise<{ unitReservationDays: number; baseCurrency: string }> {
  const row = await ensureCompanySettings(companyId);
  return { unitReservationDays: row.unitReservationDays, baseCurrency: row.baseCurrency };
}

export async function getSalesSettings(context: UserContext): Promise<SalesSettingsDTO> {
  assertPermission(context, "company.settings.view");
  const settings = await resolveUnitSalesSettings(context.companyId);
  return { ...settings, canUpdate: can(context, "company.settings.update") };
}

export async function updateSalesSettings(context: UserContext, input: SalesSettingsInput): Promise<SalesSettingsDTO> {
  assertPermission(context, "company.settings.update");
  const before = await resolveUnitSalesSettings(context.companyId);
  if (before.unitReservationDays !== input.unitReservationDays) {
    await prisma.$transaction(async (tx) => {
      await writeCompanySettings(tx, context.companyId, context.membershipId, { unitReservationDays: input.unitReservationDays });
      await recordUserAction(
        context,
        {
          actionKey: AuditAction.COMPANY_SALES_SETTINGS_UPDATED,
          entity: { type: "company_settings", id: context.companyId, label: "Sales settings" },
          before: { unitReservationDays: before.unitReservationDays },
          after: { unitReservationDays: input.unitReservationDays },
        },
        { tx },
      );
    });
  }
  return getSalesSettings(context);
}
