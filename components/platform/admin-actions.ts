import { adminText } from "@/components/platform/admin-i18n";
import type { Translate } from "@/lib/i18n/translator";

/**
 * An audit action key ("PLATFORM_COMPANY_CREATED") in the reader's language: the
 * admin dictionary's `actions.<key without PLATFORM_>`, else the English text
 * the caller already has.
 */
export function adminActionLabel(t: Translate<"admin">, actionKey: string, fallback: string): string {
  return adminText(t, `actions.${actionKey.replace(/^PLATFORM_/, "")}`, fallback);
}
