import type { Metadata } from "next";

import { SettingsPageHeader } from "@/components/modules/settings-page-header";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { Table, TableBody, TableCell, TableHead, TableHeaderCell, TableRow } from "@/components/ui/table";
import { getTranslations } from "@/lib/i18n/server";
import { listSecurityEvents } from "@/lib/modules/security/security.service";
import { formatDateTime } from "@/lib/utils/format";
import { requireSettingsSection } from "../settings-access";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("settings");
  return { title: t("sections.security-events.label") };
}

const TONE = { SUCCESS: "success", FAILURE: "danger", INFO: "default" } as const;

/** Security → Events (MOB-11 §113, §140): who, what, when and whether it worked, for the people in scope. */
export default async function SecurityEventsPage() {
  const context = await requireSettingsSection("security-events");
  const [t, events] = await Promise.all([getTranslations("security"), listSecurityEvents(context)]);
  return (
    <div className="space-y-5">
      <SettingsPageHeader title={t("admin.events.title")} description={t("admin.events.description")} />
      {events.length === 0 ? (
        <EmptyState title={t("admin.events.none")} />
      ) : (
        <section className="nesto-card p-5">
          <Table flush aria-label={t("admin.events.title")}>
            <TableHead>
              <TableRow>
                <TableHeaderCell>{t("admin.events.columns.when")}</TableHeaderCell>
                <TableHeaderCell>{t("admin.events.columns.event")}</TableHeaderCell>
                <TableHeaderCell>{t("admin.events.columns.user")}</TableHeaderCell>
                <TableHeaderCell>{t("admin.events.columns.result")}</TableHeaderCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {events.map((event) => (
                <TableRow key={event.id} data-testid="security-event-row">
                  <TableCell>{formatDateTime(event.at)}</TableCell>
                  <TableCell>{t(`events.types.${event.type}`)}</TableCell>
                  <TableCell>{event.user?.fullName ?? "—"}</TableCell>
                  <TableCell><Badge tone={TONE[event.result]}>{t(`admin.events.result.${event.result}`)}</Badge></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </section>
      )}
    </div>
  );
}
