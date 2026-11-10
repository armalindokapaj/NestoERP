"use server";

import { headers } from "next/headers";

import { clientAddress, hitThrottle } from "@/lib/core/security/throttle";
import { getSiteCopy } from "@/lib/i18n/server";
import { applicationReference, createApplicationSchema, type ApplicationInput } from "@/lib/marketing/apply-schema";

export type ApplicationResult = { ok: true; reference: string } | { ok: false; error: string };

/**
 * Applying for a workspace.
 *
 * A company's workspace is set up by NESTO, not by the visitor: the Platform
 * Admin creates it after a person has read the application and spoken to the
 * applicant. So "sign up" is an application, and this records it.
 *
 * As with the contact form, V0.1 has no mail transport and no CRM: a valid
 * application is validated, rate-limited by address and written to the server
 * log under `[nesto:application]` with its reference. Replacing the log line
 * with an email to siteContact.sales, a database row or a CRM webhook is the
 * only change a real destination needs — `parsed.data` is already trusted.
 */
export async function submitApplicationAction(input: ApplicationInput): Promise<ApplicationResult> {
  const { errors } = (await getSiteCopy()).apply;
  const parsed = createApplicationSchema(errors).safeParse(input);
  if (!parsed.success) return { ok: false, error: errors.invalid };

  const reference = applicationReference();
  // Filled honeypot: accepted, never recorded.
  if (parsed.data.website) return { ok: true, reference };

  const limit = await hitThrottle("WORKSPACE_APPLICATION", { ip: clientAddress(await headers()) });
  if (!limit.allowed) return { ok: false, error: errors.tooMany };

  try {
    const { company, country, city, kind, size, name, email, phone, role, departments, projects, users, start } = parsed.data;
    console.info("[nesto:application]", {
      reference,
      receivedAt: new Date().toISOString(),
      company, country, city, kind, size, name, email, phone, role, departments, projects, users, start,
    });
    return { ok: true, reference };
  } catch {
    return { ok: false, error: errors.failed };
  }
}
