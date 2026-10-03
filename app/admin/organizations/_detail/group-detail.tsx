import Link from "@/components/navigation/nav-link";
import { CheckCircle2, Circle } from "lucide-react";

import { GroupImplementationActions } from "@/components/platform/platform-actions";
import { PlatformCommandMenu } from "@/components/platform/platform-command";
import { RECOVERY_RETENTION_DAYS } from "@/lib/modules/platform/recovery-constants";
import { deleteItem, purgeItem, restoreItem } from "./recovery-actions";
import { getTranslations } from "@/lib/i18n/server";
import { Table, TableBody, TableCell, TableHead, TableHeaderCell, TableRow } from "@/components/ui/table";
import type { getGroupImplementation } from "@/lib/modules/platform/platform-implementation.service";

type Props = { implementation: Awaited<ReturnType<typeof getGroupImplementation>> };

/**
 * A group's implementation (E-06 §21, §70, §71): its identity, its companies,
 * the initial roster, the checklist the platform hands it over against, and
 * the controls that move it along. Configuration only — never business records.
 */
/** The group's own controls, in the page header (Organizations PRD §20, §52). */
export async function GroupHeaderActions({ implementation }: Props) {
  const t = await getTranslations("adminOrgs");
  const { group } = implementation;
  // A group suspended before its handover resumes into setup; only the checklist activates it (ADM audit §2).
  const resumeTo = group.activatedAt ? "ACTIVE" : "IMPLEMENTING";
  if (group.status === "DELETED") {
    return <PlatformCommandMenu label={t("group.actionsLabel", { name: group.name })} items={[restoreItem({ kind: "group", id: group.id, name: group.name }, t), purgeItem({ kind: "group", id: group.id, name: group.name }, t)]} />;
  }
  return (
    <div className="flex flex-wrap items-center gap-2">
      <GroupImplementationActions implementation={implementation} />
      <PlatformCommandMenu
        label={t("group.actionsLabel", { name: group.name })}
        items={[
          // The tenant's mark in its sidebar (OW §12, §44); the group's name is its display name.
          ...(group.status !== "ARCHIVED" ? [{ label: t("group.branding.label"), title: t("group.branding.title", { name: group.name }), description: t("group.branding.description"), action: "group.branding", fixed: { groupId: group.id }, fields: [{ name: "logoUrl", label: t("group.branding.logo"), type: "textarea" as const, hint: t("group.branding.logoHint") }, { name: "reason", label: t("common.reason"), type: "textarea" as const, required: true }], initial: { logoUrl: group.logoUrl ?? "" }, submitLabel: t("group.branding.submit"), success: t("group.branding.success") }] : []),
          ...(group.status !== "ARCHIVED" ? [{ label: group.status === "SUSPENDED" ? t("group.lifecycle.resume") : t("group.lifecycle.suspend"), title: t("group.lifecycle.title", { name: group.name }), description: t("group.lifecycle.description"), action: "group.status", fixed: { groupId: group.id }, fields: [{ name: "status", label: t("group.lifecycle.status"), type: "select" as const, required: true, options: (group.status === "SUSPENDED" ? [resumeTo, "ARCHIVED"] : ["SUSPENDED", "ARCHIVED"]).map((value) => ({ value, label: t(`group.lifecycle.options.${value}` as "group.lifecycle.options.ACTIVE") })) }, { name: "reason", label: t("common.reason"), type: "textarea" as const, required: true }], initial: { status: group.status === "SUSPENDED" ? resumeTo : "SUSPENDED" }, destructive: true, submitLabel: t("group.lifecycle.submit"), success: t("group.lifecycle.success") }] : []),
          deleteItem({ kind: "group", id: group.id, name: group.name }, RECOVERY_RETENTION_DAYS, t),
        ]}
      />
    </div>
  );
}

/** The Overview tab: implementation state, departments and the initial roster (§23). */
const CHECKLIST = {
  companies: "group.overview.checklist.companies", departments: "group.overview.checklist.departments", branches: "group.overview.checklist.branches", owner: "group.overview.checklist.owner",
  groupIt: "group.overview.checklist.groupIt", heads: "group.overview.checklist.heads", managers: "group.overview.checklist.managers", projects: "group.overview.checklist.projects",
} as const;

export async function GroupOverview({ implementation }: Props) {
  const t = await getTranslations("adminOrgs");
  const { group } = implementation;
  return (
    <div className="space-y-5">
      <section className="nesto-card p-5" aria-labelledby="implementation-checklist">
        <h2 id="implementation-checklist" className="text-card font-semibold text-fg">
          {t("group.overview.checklistTitle")}
        </h2>
        <ul className="mt-3 grid gap-2 sm:grid-cols-2" data-testid="implementation-checklist">
          {implementation.checklist.map((item) => (
            <li key={item.key} className="flex items-start gap-2 text-table" data-testid="checklist-item" data-done={item.done}>
              {item.done ? <CheckCircle2 aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-success" /> : <Circle aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-fg-subtle" />}
              <span className={item.done ? "text-fg" : "text-fg-muted"}>
                {CHECKLIST[item.key as keyof typeof CHECKLIST] ? t(CHECKLIST[item.key as keyof typeof CHECKLIST]) : item.label}
                {!item.blocking ? <span className="ml-1 text-meta text-fg-subtle">{t("group.overview.recommended")}</span> : null}
                <span className="sr-only">{item.done ? t("group.overview.done") : t("group.overview.notDone")}</span>
              </span>
            </li>
          ))}
        </ul>
      </section>

      <section className="nesto-card flex flex-wrap items-center justify-between gap-3 p-5" aria-labelledby="group-departments">
        <div>
          <h2 id="group-departments" className="text-card font-semibold text-fg">
            {t("group.overview.departmentsTitle")}
          </h2>
          <p className="mt-1 text-table text-fg-muted" data-testid="department-setup">
            {t("group.overview.departmentsSummary", { active: implementation.departments.active, branches: implementation.departments.branches, withHead: implementation.departments.withHead, needingHead: implementation.departments.needingHead, branchesWithManager: implementation.departments.branchesWithManager })}
          </p>
        </div>
        <Link href={`/admin/organizations/${group.id}/departments`} className="text-table font-medium text-accent-strong hover:underline">
          {t("group.overview.setUpDepartments")}
        </Link>
      </section>

      <section className="nesto-card p-5" aria-labelledby="group-people">
        <h2 id="group-people" className="text-card font-semibold text-fg">
          {t("group.overview.peopleTitle")}
        </h2>
        {implementation.people.length === 0 ? (
          <p className="mt-3 text-table text-fg-muted">{t("group.overview.peopleEmpty")}</p>
        ) : (
          <Table stack flush className="mt-3" aria-labelledby="group-people">
            <TableHead>
              <TableRow>
                <TableHeaderCell>{t("group.overview.person")}</TableHeaderCell>
                <TableHeaderCell>{t("group.overview.username")}</TableHeaderCell>
                <TableHeaderCell>{t("group.overview.where")}</TableHeaderCell>
                <TableHeaderCell>{t("group.overview.password")}</TableHeaderCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {implementation.people.map((person) => (
                <TableRow key={person.userId} data-testid="implementation-person">
                  <TableCell className="font-medium">{person.name}</TableCell>
                  <TableCell className="font-mono text-meta">{person.username}</TableCell>
                  <TableCell>{person.placements.join("; ")}</TableCell>
                  <TableCell>{person.mustChangePassword ? t("group.overview.temporary") : t("group.overview.setByThem")}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </section>
    </div>
  );
}
