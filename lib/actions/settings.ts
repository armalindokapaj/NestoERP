"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { AccessError } from "@/lib/access/guards";
import { validationFailure } from "@/lib/actions/result";
import { MODULE_KEYS } from "@/config/modules";
import { requireCompanyContext } from "@/lib/context/current-user";
import {
  companySettingsSchema,
  renameCompany,
  renameCompanySchema,
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

type ActionResult = { ok: true } | { ok: false; message: string; fieldErrors?: Record<string, string[]> };

/** A refused parse, said beside its fields rather than thrown as "may have saved" (AUD-09 §3, §6). */
function invalid(error: z.ZodError): ActionResult {
  const failure = validationFailure(error);
  return { ok: false, message: failure.error, fieldErrors: failure.fieldErrors };
}

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
    if (error instanceof AccessError) {
      // A business rule the form can explain — a locked currency, a blocked
      // integration — comes back as a message. Anything about who the caller
      // is still surfaces as the error it is.
      if (error.code === "CONFLICT" || error.code === "VALIDATION_ERROR") {
        return { ok: false, message: MESSAGES[detailCode(error)] ?? error.message };
      }
      throw error;
    }
    const code = error instanceof Error ? error.message : "";
    return { ok: false, message: MESSAGES[code] ?? "That change could not be saved." };
  }
}

function detailCode(error: AccessError): string {
  const details = error.details as { code?: unknown } | undefined;
  return typeof details?.code === "string" ? details.code : "";
}

/** A form field that is not on the page is not a value: absent stays absent. */
function field(formData: FormData, name: string): string | undefined {
  const value = formData.get(name);
  return typeof value === "string" ? value : undefined;
}

export async function updateCompanySettingsAction(formData: FormData): Promise<ActionResult> {
  const context = await requireCompanyContext();
  // The finance fields are only on the form for somebody who may see them, so
  // a missing one means "unchanged" rather than a value (PRD #47 §61).
  const input = companySettingsSchema.parse({
    locale: formData.get("locale"),
    timezone: formData.get("timezone"),
    dateFormat: formData.get("dateFormat"),
    baseCurrency: field(formData, "baseCurrency"),
    fiscalYearStartMonth: field(formData, "fiscalYearStartMonth"),
    defaultPaymentTermsDays: field(formData, "defaultPaymentTermsDays"),
    defaultTaxRate: field(formData, "defaultTaxRate"),
  });
  return run(() => updateCompanySettings(context, input), ["/settings/localization", "/finance"]);
}

export async function renameCompanyAction(formData: FormData): Promise<ActionResult> {
  const context = await requireCompanyContext();
  const input = renameCompanySchema.parse({ name: formData.get("name") });
  return run(() => renameCompany(context, input), ["/", "/settings/company"]);
}

export async function updateIntegrationSettingsAction(formData: FormData): Promise<ActionResult> {
  const context = await requireCompanyContext();
  const input = integrationSettingsSchema.parse({
    qualityGateForInventoryReceipts: formData.get("qualityGateForInventoryReceipts") === "on",
    autoCreateFinanceCommitmentFromApprovedPo:
      formData.get("autoCreateFinanceCommitmentFromApprovedPo") === "on",
  });
  return run(() => updateIntegrationSettings(context, input), ["/settings/integrations"]);
}

/**
 * A server action's arguments are whatever the caller posts, so the module key
 * is checked against the registry rather than cast into one (PRD #47 §64).
 */
const moduleToggleArgs = z.object({ moduleKey: z.enum(MODULE_KEYS), enabled: z.boolean() });

export async function setModuleEnabledAction(
  moduleKey: string,
  enabled: boolean,
): Promise<ActionResult> {
  const context = await requireCompanyContext();
  const parsed = moduleToggleArgs.safeParse({ moduleKey, enabled });
  if (!parsed.success) return { ok: false, message: MESSAGES.MODULE_NOT_FOUND };
  return run(() => setModuleEnabled(context, parsed.data.moduleKey, parsed.data.enabled), [
    "/settings/modules",
    "/dashboard",
  ]);
}

export async function updateNumberingSchemeAction(formData: FormData): Promise<ActionResult> {
  const context = await requireCompanyContext();
  const moduleKey = String(formData.get("moduleKey"));
  const entityType = String(formData.get("entityType"));
  const mode = formData.get("mode");
  // Disabled controls post nothing: absent is "unchanged", not a value. A
  // checkbox the form showed posts nothing when unticked, so it is false only
  // when its scheme is automatic and the box was there to tick (AUD-09 §4, §5).
  const parsed = numberingSchemeSchema.safeParse({
    mode,
    prefix: field(formData, "prefix"),
    separator: field(formData, "separator"),
    yearMode: field(formData, "yearMode"),
    padding: field(formData, "padding"),
    resetSequenceYearly: mode === "AUTO" ? formData.get("resetSequenceYearly") === "on" : undefined,
  });
  if (!parsed.success) return invalid(parsed.error);
  const input = parsed.data;
  return run(() => updateNumberingScheme(context, moduleKey, entityType, input), [
    "/settings/numbering",
  ]);
}
