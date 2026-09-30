"use client";

import * as React from "react";
import { Lock } from "lucide-react";

import { useTranslations } from "@/components/i18n/i18n-provider";
import { Switch } from "@/components/ui/switch";
import { ScrollRegion } from "@/components/ui/scroll-region";
import { useToast } from "@/components/ui/toast";
import type { CategoryPreference } from "@/lib/core/notifications/notification.preferences";

/**
 * Notification preferences (PRD #38 §78).
 *
 * Each switch saves on its own and rolls back if the server refuses. The lock
 * on critical safety alerts is shown here and enforced on the server.
 */
export function NotificationPreferences({ initial }: { initial: CategoryPreference[] }) {
  const t = useTranslations("settings");
  const toast = useToast();
  const [rows, setRows] = React.useState(initial);
  const [saving, setSaving] = React.useState<string | null>(null);

  async function change(row: CategoryPreference, patch: Partial<Pick<CategoryPreference, "inAppEnabled" | "emailEnabled" | "pushEnabled">>) {
    const next = { ...row, ...patch };
    setRows((current) => current.map((item) => (item.category === row.category ? next : item)));
    setSaving(row.category);
    try {
      const response = await fetch("/api/notifications/preferences", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ category: row.category, inAppEnabled: next.inAppEnabled, emailEnabled: next.emailEnabled, pushEnabled: next.pushEnabled }),
      });
      if (!response.ok) throw new Error(String(response.status));
      const json = (await response.json()) as { data: CategoryPreference };
      setRows((current) => current.map((item) => (item.category === row.category ? json.data : item)));
      toast({ title: t("notifications.saved"), tone: "success" });
    } catch {
      setRows((current) => current.map((item) => (item.category === row.category ? row : item)));
      toast({ title: t("notifications.failed"), tone: "danger" });
    } finally {
      setSaving(null);
    }
  }

  return (
    // Fits a 320px phone: narrow switch columns below sm instead of a 512px
    // minimum, so the Email switch is never off-screen (AUD-04 §3, D-07-08, D-07-15, MW-01).
    <ScrollRegion label={t("sections.notifications.label")}>
      <table className="w-full text-left sm:min-w-[40rem]">
        <thead>
          <tr className="border-b border-line text-micro font-semibold uppercase tracking-wide text-fg-subtle">
            <th scope="col" className="py-2 pr-4">{t("notifications.category")}</th>
            <th scope="col" className="w-16 px-1 py-2 text-center sm:w-28 sm:px-2">{t("notifications.inApp")}</th>
            <th scope="col" className="w-16 px-1 py-2 text-center sm:w-28 sm:px-2">{t("notifications.push")}</th>
            <th scope="col" className="w-16 px-1 py-2 text-center sm:w-28 sm:px-2">{t("notifications.email")}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const label = t(`notifications.categories.${row.category}.label`);
            return (
              <tr key={row.category} className="border-b border-line last:border-0" data-testid={`preference-${row.category}`}>
                <td className="py-3 pr-2 align-top [overflow-wrap:anywhere] sm:pr-4">
                  <p className="text-body font-medium text-fg">{label}</p>
                  <p className="text-table text-fg-muted">{t(`notifications.categories.${row.category}.description`)}</p>
                  {row.inAppLocked ? (
                    <p className="mt-1 flex items-center gap-1 text-meta text-fg-subtle">
                      <Lock aria-hidden="true" className="size-3" />
                      {t("notifications.locked")}
                    </p>
                  ) : null}
                </td>
                <td className="px-1 py-3 text-center align-top sm:px-2">
                  <Switch
                    checked={row.inAppEnabled}
                    disabled={row.inAppLocked || saving === row.category}
                    aria-label={`${label} — ${t("notifications.inApp")}`}
                    onCheckedChange={(checked) => void change(row, { inAppEnabled: checked })}
                  />
                </td>
                <td className="px-1 py-3 text-center align-top sm:px-2">
                  <Switch
                    checked={row.pushEnabled}
                    disabled={row.inAppLocked || saving === row.category}
                    aria-label={`${label} — ${t("notifications.push")}`}
                    onCheckedChange={(checked) => void change(row, { pushEnabled: checked })}
                  />
                </td>
                <td className="px-1 py-3 text-center align-top sm:px-2">
                  {row.emailAvailable ? (
                    <Switch
                      checked={row.emailEnabled}
                      disabled={saving === row.category}
                      aria-label={`${label} — ${t("notifications.email")}`}
                      onCheckedChange={(checked) => void change(row, { emailEnabled: checked })}
                    />
                  ) : (
                    <span className="text-meta text-fg-subtle">{t("notifications.noEmail")}</span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </ScrollRegion>
  );
}
