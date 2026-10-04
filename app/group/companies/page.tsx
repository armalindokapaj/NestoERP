import type { Metadata } from "next";

import { CreateGroupCompany } from "@/components/group/create-company";
import { AdminStatusBadge } from "@/components/platform/admin-status-badge";
import { EmptyState } from "@/components/ui/empty-state";
import { Table, TableBody, TableCell, TableHead, TableHeaderCell, TableRow } from "@/components/ui/table";
import { canGroup, requireGroupContext } from "@/lib/context/group-context";
import { getTranslations } from "@/lib/i18n/server";
import { groupCompanies } from "@/lib/modules/group/group-workspace.query";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("group");
  return { title: t("companies.title") };
}

/** The group's companies; no company is not an error but the place to start (Admin PRD #9 §75, §91). */
export default async function GroupCompaniesPage() {
  const t = await getTranslations("group");
  const context = await requireGroupContext();
  const rows = await groupCompanies(context);
  const create = canGroup(context, "group.companies.create");
  const open = ["ACTIVE", "IMPLEMENTING", "READY_FOR_VALIDATION"].includes(context.groupStatus);
  return (
    <section className="nesto-card overflow-hidden" aria-label={t("companies.title")}>
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-3.5">
        <div>
          <h1 className="text-card font-semibold text-fg">{t("companies.title")}</h1>
          <p className="text-table text-fg-muted">{create ? t("companies.description", { name: context.groupName }) : t("companies.noPermission")}</p>
        </div>
        {create && open ? <CreateGroupCompany groupName={context.groupName} /> : null}
      </div>
      {rows.length === 0 ? (
        <EmptyState className="m-4" title={t("companies.emptyTitle")} description={t("companies.emptyBody", { name: context.groupName })} />
      ) : (
        <div className="overflow-x-auto">
          <Table stack aria-label={t("companies.title")}>
            <TableHead><TableRow><TableHeaderCell>{t("companies.company")}</TableHeaderCell><TableHeaderCell className="max-sm:hidden">{t("companies.people")}</TableHeaderCell><TableHeaderCell className="max-sm:hidden">{t("companies.projects")}</TableHeaderCell><TableHeaderCell>{t("companies.status")}</TableHeaderCell></TableRow></TableHead>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.id} data-testid="group-company-row">
                  <TableCell><span className="font-medium text-fg">{row.name}</span><p className="font-mono text-micro text-fg-subtle">{row.slug}</p></TableCell>
                  <TableCell className="tabular-nums max-sm:hidden">{row.people}</TableCell>
                  <TableCell className="tabular-nums max-sm:hidden">{row.projects}</TableCell>
                  <TableCell><AdminStatusBadge status={row.status} /></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </section>
  );
}
