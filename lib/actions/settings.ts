"use server";

import { revalidatePath } from "next/cache";

import { AccessError } from "@/lib/access/guards";
import type { ModuleKey } from "@/config/modules";
import { requireUserContext } from "@/lib/context/current-user";
import {
  companySettingsSchema,
  updateCompanySettings,
} from "@/lib/modules/settings/company-settings.service";
import {
  integrationSettingsSchema,
  updateIntegrationSettings,
} from "@/lib/modules/settings/integration-settings.service";
import { setModuleEnabled } from "@/lib/modules/settings/module-toggle.service";
import {
  numberingSchemeSchema,
  updateNumberingScheme,
} from "@/lib/modules/settings/numbering.service";

/**
 * Server actions for company configuration (PRD #24 §144-§149).
 *
 * A thin shell over the same services the API routes call: every service re-runs
 * the full guard sequence, so posting a form is exactly as safe as calling the
 * endpoint (PRD #24 §149).
 */

type ActionResult = { ok: true } | { ok: false; message: string };

const MESSAGES: Record<string, string> = {
  BASE_CURRENCY_LOCKED:
    "Base currency cannot be changed after financial records have been created.",
  INTEGRATION_DEPENDENCY_BLOCKED:
    "That integration needs its modules enabled first.",
  MODULE_DEPENDENCY_BLOCKED: "Another enabled module depends on this one.",
  CORE_MODULE_REQUIRED: "This module is part of the product and cannot be disabled.",
  MODULE_NOT_FOUND: "That module does not exist.",
  NUMBERING_SCHEME_NOT_FOUND: "That numbering scheme does not exist.",
};

async function run(fn: () => Promise<unknown>, paths: string[]): Promise<ActionResult> {
  try {
    await fn();
    for (const path of paths) revalidatePath(path);
    return { ok: true };
  } catch (error) {
    if (error instanceof AccessError) throw error;
    const code = error instanceof Error ? error.message : "";
    return { ok: false, message: MESSAGES[code] ?? "That change could not be saved." };
  }
}

export async function updateCompanySettingsAction(formData: FormData): Promise<ActionResult> {
  const context = await requireUserContext();
  const input = companySettingsSchema.parse({
    locale: formData.get("locale"),
    timezone: formData.get("timezone"),
    dateFormat: formData.get("dateFormat"),
    baseCurrency: formData.get("baseCurrency"),
    fiscalYearStartMonth: formData.get("fiscalYearStartMonth"),
    defaultPaymentTermsDays: formData.get("defaultPaymentTermsDays"),
    defaultTaxRate: formData.get("defaultTaxRate") ?? undefined,
  });
  return run(() => updateCompanySettings(context, input), ["/settings/localization", "/finance"]);
}

export async function updateIntegrationSettingsAction(formData: FormData): Promise<ActionResult> {
  const context = await requireUserContext();
  const input = integrationSettingsSchema.parse({
    qualityGateForInventoryReceipts: formData.get("qualityGateForInventoryReceipts") === "on",
    autoCreateFinanceCommitmentFromApprovedPo:
      formData.get("autoCreateFinanceCommitmentFromApprovedPo") === "on",
  });
  return run(() => updateIntegrationSettings(context, input), ["/settings/integrations"]);
}

export async function setModuleEnabledAction(
  moduleKey: string,
  enabled: boolean,
): Promise<ActionResult> {
  const context = await requireUserContext();
  return run(() => setModuleEnabled(context, moduleKey as ModuleKey, enabled), [
    "/settings/modules",
    "/dashboard",
  ]);
}

export async function updateNumberingSchemeAction(formData: FormData): Promise<ActionResult> {
  const context = await requireUserContext();
  const moduleKey = String(formData.get("moduleKey"));
  const entityType = String(formData.get("entityType"));
  const input = numberingSchemeSchema.parse({
    mode: formData.get("mode"),
    prefix: formData.get("prefix") ?? undefined,
    separator: formData.get("separator") ?? "-",
    yearMode: formData.get("yearMode"),
    padding: formData.get("padding"),
    resetSequenceYearly: formData.get("resetSequenceYearly") === "on",
  });
  return run(() => updateNumberingScheme(context, moduleKey, entityType, input), [
    "/settings/numbering",
  ]);
}
