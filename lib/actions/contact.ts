"use server";

import { contactSchema, type ContactInput } from "@/lib/marketing/schema";

export type ContactResult = { ok: true } | { ok: false; error: string };

/**
 * Public contact enquiry.
 *
 * V0.1 has no mail transport and no CRM, so a valid enquiry is validated and
 * recorded in the server log. That is the only thing here that is temporary:
 * everything a real destination needs — a parsed, trusted object — is already
 * in `parsed.data`.
 *
 * To finish it, replace the log line with one of:
 *   • an email send (Resend, Postmark, SES) to config/marketing.ts → site.contact.sales
 *   • a row in a `ContactEnquiry` table via lib/database/prisma.ts
 *   • a webhook into whatever CRM the company actually uses
 *
 * Worth adding at the same time: rate limiting by IP. The honeypot below stops
 * unsophisticated bots, not a determined one.
 */
export async function submitContactAction(input: ContactInput): Promise<ContactResult> {
  const parsed = contactSchema.safeParse(input);

  if (!parsed.success) {
    return { ok: false, error: "Some details are missing. Check the form and try again." };
  }

  // Filled honeypot: accepted, never delivered.
  if (parsed.data.website) {
    return { ok: true };
  }

  const { name, email, company, size, topic, message } = parsed.data;

  try {
    console.info("[nesto:contact]", {
      receivedAt: new Date().toISOString(),
      name,
      email,
      company,
      size,
      topic,
      message,
    });

    return { ok: true };
  } catch {
    return { ok: false, error: "We could not send that. Please email us directly." };
  }
}
