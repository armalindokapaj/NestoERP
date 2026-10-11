import { apiOk, withContext } from "@/lib/api/respond";
import { listReadableAttentionForWorkspace } from "@/lib/core/notifications/attention.service";
import { getRequestLocale } from "@/lib/i18n/server";
import { localizeAttention } from "@/lib/i18n/system";

/**
 * GET /api/notifications/attention — unresolved conditions for this member,
 * each record re-read in their context first. The raw rows are a note of what
 * was detected, never proof of current access (PRD #38 §82, PRD #47 §77).
 *
 * Group workspace: `read`. The person's own attention across the companies they
 * may use — each item read again in its own company's context — every item
 * naming its company (Workspace Context §45).
 */
export async function GET() {
  return withContext(
    async (context) => {
      const [items, locale] = await Promise.all([listReadableAttentionForWorkspace(context), getRequestLocale()]);
      // The stored English is what the reconciler compares; the reader gets their own language.
      return apiOk({ data: items.map((item) => localizeAttention(locale, item)) });
    },
    { group: "read" },
  );
}
