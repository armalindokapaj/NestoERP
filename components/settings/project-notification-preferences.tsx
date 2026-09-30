"use client";

import * as React from "react";

import { useTranslations } from "@/components/i18n/i18n-provider";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/components/ui/toast";
import type { ProjectNotificationLevel, ProjectPreferenceRow } from "@/lib/core/notifications/notification.settings";

/** How much of each project reaches the phone (MOB-10 §88-§90, §159). Mentions, assignments and critical alerts ignore it. */
export function ProjectNotificationPreferences({ initial }: { initial: ProjectPreferenceRow[] }) {
  const t = useTranslations("settings");
  const toast = useToast();
  const [rows, setRows] = React.useState(initial);

  async function change(row: ProjectPreferenceRow, level: ProjectNotificationLevel) {
    setRows((current) => current.map((item) => (item.projectId === row.projectId ? { ...item, level } : item)));
    try {
      const response = await fetch("/api/notifications/project-preferences", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ projectId: row.projectId, level }),
      });
      if (!response.ok) throw new Error(String(response.status));
      toast({ title: t("notifications.saved"), tone: "success" });
    } catch {
      setRows((current) => current.map((item) => (item.projectId === row.projectId ? row : item)));
      toast({ title: t("notifications.failed"), tone: "danger" });
    }
  }

  return (
    <section aria-labelledby="project-notifications-title" className="nesto-card space-y-4 p-6" data-testid="project-notification-preferences">
      <div>
        <h2 id="project-notifications-title" className="text-heading font-semibold text-fg">{t("notifications.projects.title")}</h2>
        <p className="text-table text-fg-muted">{t("notifications.projects.description")}</p>
      </div>
      {rows.length === 0 ? (
        <p className="text-table text-fg-muted">{t("notifications.projects.empty")}</p>
      ) : (
        <ul className="divide-y divide-line">
          {rows.map((row) => (
            <li key={row.projectId} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between" data-testid={`project-preference-${row.projectId}`}>
              <span className="text-body font-medium text-fg [overflow-wrap:anywhere]">{row.name}</span>
              <div className="sm:w-56">
                <Select value={row.level} onValueChange={(level) => void change(row, level as ProjectNotificationLevel)}>
                  <SelectTrigger aria-label={`${row.name} — ${t("notifications.projects.title")}`}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ALL">{t("notifications.projects.all")}</SelectItem>
                    <SelectItem value="IMPORTANT">{t("notifications.projects.important")}</SelectItem>
                    <SelectItem value="MUTED">{t("notifications.projects.muted")}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
