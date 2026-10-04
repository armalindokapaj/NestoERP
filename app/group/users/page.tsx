import type { Metadata } from "next";

import { AddGroupUser, GROUP_API, GroupPersonActions } from "@/components/platform/group-users";
import { AdminStatusBadge } from "@/components/platform/admin-status-badge";
import { EmptyState } from "@/components/ui/empty-state";
import { Table, TableBody, TableCell, TableHead, TableHeaderCell, TableRow } from "@/components/ui/table";
import { canGroup, requireGroupContext } from "@/lib/context/group-context";
import { getTranslations } from "@/lib/i18n/server";
import { groupActor } from "@/lib/modules/platform/group-actor";
import { groupPeople } from "@/lib/modules/platform/platform-organization-detail.query";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("group");
  return { title: t("shell.users") };
}

/** The group's own people, managed by the seats that may (Admin PRD #8 §19-§21, #9 §45). */
export default async function GroupUsersPage() {
  const t = await getTranslations("adminOrgs");
  const context = await requireGroupContext();
  const { people, ceo } = await groupPeople(groupActor(context), context.groupId);
  const manage = canGroup(context, "group.users.manage");
  const appointCeo = canGroup(context, "group.ceo.manage");
  const open = ["ACTIVE", "IMPLEMENTING", "READY_FOR_VALIDATION"].includes(context.groupStatus);
  return (
    <section className="nesto-card overflow-hidden" aria-label={t("groupUsers.title")}>
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-3.5">
        <div>
          <h1 className="text-card font-semibold text-fg">{t("groupUsers.title")}</h1>
          <p className="text-table text-fg-muted">{ceo ? t("groupUsers.currentCeo", { name: ceo.name }) : t("groupUsers.description", { name: context.groupName })}</p>
        </div>
        {manage && open ? (
          <div className="flex flex-wrap gap-2">
            {appointCeo ? <AddGroupUser groupId={context.groupId} groupName={context.groupName} ceoName={ceo?.name ?? null} ceoOnly api={GROUP_API} label={ceo ? t("groupUsers.changeCeo") : t("groupUsers.assignCeo")} /> : null}
            <AddGroupUser groupId={context.groupId} groupName={context.groupName} ceoName={ceo?.name ?? null} api={GROUP_API} allowCeo={appointCeo} label={t("groupUsers.add")} />
          </div>
        ) : null}
      </div>
      {people.length === 0 ? (
        <EmptyState className="m-4" title={t("groupUsers.emptyTitle")} description={t("groupUsers.emptyBody", { name: context.groupName })} />
      ) : (
        <div className="overflow-x-auto">
          <Table stack aria-label={t("groupUsers.title")}>
            <TableHead><TableRow><TableHeaderCell>{t("groupUsers.person")}</TableHeaderCell><TableHeaderCell>{t("groupUsers.groupRole")}</TableHeaderCell><TableHeaderCell className="max-sm:hidden">{t("groupUsers.companies")}</TableHeaderCell><TableHeaderCell className="max-sm:hidden">{t("groupUsers.projects")}</TableHeaderCell><TableHeaderCell>{t("groupUsers.status")}</TableHeaderCell><TableHeaderCell><span className="sr-only">{t("common.actions")}</span></TableHeaderCell></TableRow></TableHead>
            <TableBody>
              {people.map((person) => (
                <TableRow key={person.userId} data-testid="group-person">
                  <TableCell><span className="font-medium text-fg">{person.name}</span><p className="font-mono text-micro text-fg-subtle">{person.email ?? person.username}</p></TableCell>
                  <TableCell>{person.roleKey ? t(`groupUsers.role${person.roleKey}`) : t("groupUsers.seatOnly")}</TableCell>
                  <TableCell className="tabular-nums max-sm:hidden">{person.companies}</TableCell>
                  <TableCell className="tabular-nums max-sm:hidden">{person.projects}</TableCell>
                  <TableCell><AdminStatusBadge status={person.account !== "ACTIVE" ? person.account : person.seat} /></TableCell>
                  <TableCell className="text-right">
                    {manage && open && (appointCeo || person.roleKey !== "OWNER") ? (
                      <GroupPersonActions groupId={context.groupId} groupName={context.groupName} api={GROUP_API} platform={false} canAppointCeo={appointCeo} person={{ userId: person.userId, name: person.name, roleKey: person.roleKey, seatActive: person.seat === "ACTIVE", profile: null }} ceoName={ceo?.name ?? null} />
                    ) : null}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </section>
  );
}
