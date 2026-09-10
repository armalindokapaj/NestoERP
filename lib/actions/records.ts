"use server";

import { revalidatePath } from "next/cache";

import { AccessError } from "@/lib/access/guards";
import { requireUserContext } from "@/lib/context/current-user";
import { findRecordSection } from "@/lib/modules/records/registry";

/**
 * The one approval action behind every department module (PRD #7 §51).
 *
 * It resolves the section from the registry and delegates: the permission check
 * and the transaction live in the service layer, not here (PRD #7 §144).
 */
export async function decideRecordAction(
  moduleKey: string,
  section: string,
  recordId: string,
  decision: "APPROVE" | "REJECT",
): Promise<{ ok: true } | { ok: false; error: string }> {
  const context = await requireUserContext();
  const definition = findRecordSection(moduleKey, section);

  if (!definition?.decide) {
    return { ok: false, error: "This record cannot be approved here." };
  }

  try {
    await definition.decide(context, recordId, decision);
  } catch (error) {
    if (error instanceof AccessError) return { ok: false, error: error.message };
    console.error("[records] decision failed", error);
    return { ok: false, error: "We couldn't record that decision. Please try again." };
  }

  revalidatePath(`/${moduleKey}/${section}`);
  revalidatePath(`/${moduleKey}/${section}/${recordId}`);
  revalidatePath("/dashboard");
  return { ok: true };
}
