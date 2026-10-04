import type { Metadata } from "next";

import { Table, TableBody, TableCell, TableHead, TableHeaderCell, TableRow } from "@/components/ui/table";
import { requireGroupContext } from "@/lib/context/group-context";
import { getTranslations } from "@/lib/i18n/server";
import { groupRoleCounts } from "@/lib/modules/group/group-workspace.query";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("group");
  return { title: t("roles.title") };
}

/** Who holds the group-level roles (Admin PRD #8 §47). */
export default async function GroupRolesPage() {
  const t = await getTranslations("group");
  const to = await getTranslations("adminOrgs");
  const context = await requireGroupContext();
  const counts = await groupRoleCounts(context);
  const rows = [
    { key: "OWNER" as const, name: to("groupUsers.roleOWNER"), help: t("roles.ownerHelp"), people: counts.OWNER },
    { key: "GROUP_IT" as const, name: to("groupUsers.roleGROUP_IT"), help: t("roles.itHelp"), people: counts.GROUP_IT },
  ];
  return (
    <section className="nesto-card overflow-hidden" aria-label={t("roles.title")}>
      <div className="border-b border-line px-5 py-3.5">
        <h1 className="text-card font-semibold text-fg">{t("roles.title")}</h1>
        <p className="text-table text-fg-muted">{t("roles.description", { name: context.groupName })}</p>
      </div>
      <div className="overflow-x-auto">
        <Table stack aria-label={t("roles.title")}>
          <TableHead><TableRow><TableHeaderCell>{t("roles.role")}</TableHeaderCell><TableHeaderCell>{t("roles.people")}</TableHeaderCell></TableRow></TableHead>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.key} data-testid="group-role-row">
                <TableCell><span className="font-medium text-fg">{row.name}</span><p className="text-meta text-fg-subtle">{row.help}</p></TableCell>
                <TableCell>{row.people.length ? row.people.join(", ") : <span className="text-fg-subtle">{t("roles.nobody")}</span>}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </section>
  );
}
