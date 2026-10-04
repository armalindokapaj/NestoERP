"use client";

import * as React from "react";

import { useTranslations } from "@/components/i18n/i18n-provider";
import { engineeringApi } from "@/components/engineering/engineering-api";
import { FormDialog, useCommand, type FormField } from "@/components/engineering/form-kit";
import Link from "@/components/navigation/nav-link";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { CopyButton } from "@/components/ui/copy-button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogTitle } from "@/components/ui/dialog";
import { MEMBERSHIP_ROLE_KEYS, roleLabel } from "@/config/roles";
import type { GroupImplementationDTO, InitialUserResultDTO } from "@/lib/modules/platform/platform-implementation.service";

/**
 * The Platform Admin's implementation controls (E-06 §20, §21, §70, §71):
 * create a group, add its companies, record the approved initial roster and
 * its first project assignments, send it for validation and activate it.
 */

type Open = "identity" | "company" | "person" | "project" | "ready" | "activate" | null;

export function GroupImplementationActions({ implementation }: { implementation: GroupImplementationDTO }) {
  const t = useTranslations("adminAccess");
  const { pending, run } = useCommand();
  const identityFields: FormField[] = [
    { name: "name", label: t("implementation.fields.name"), type: "text", required: true },
    { name: "slug", label: t("implementation.fields.slug"), type: "text", required: true, hint: t("implementation.fields.slugHint") },
    { name: "legalName", label: t("implementation.fields.legalName"), type: "text" },
    { name: "country", label: t("implementation.fields.country"), type: "text" },
    { name: "timezone", label: t("implementation.fields.timezone"), type: "text", placeholder: "Europe/Tirane" },
    { name: "currency", label: t("implementation.fields.currency"), type: "text", placeholder: "EUR" },
  ];
  const [open, setOpen] = React.useState<Open>(null);
  const [created, setCreated] = React.useState<InitialUserResultDTO | null>(null);
  const base = `/api/platform/parent-groups/${implementation.group.id}`;
  const close = (next: boolean) => !next && setOpen(null);
  const { actions } = implementation;
  const companies = implementation.companies.map((company) => ({ value: company.id, label: company.name }));
  const projects = implementation.companies.flatMap((company) => company.projects.map((project) => ({ value: project.id, label: `${company.name} · ${project.code} · ${project.name}` })));
  const people = implementation.people.map((person) => ({ value: person.userId, label: person.name }));

  return (
    <div className="flex flex-wrap items-center gap-2" data-testid="implementation-actions">
      {actions.canActivate ? <Button size="sm" onClick={() => setOpen("activate")}>{t("implementation.activateGroup")}</Button> : null}
      {actions.canMarkReady ? <Button size="sm" variant="secondary" onClick={() => setOpen("ready")}>{t("implementation.sendForValidation")}</Button> : null}
      {actions.canAddCompany ? <Button size="sm" variant="secondary" onClick={() => setOpen("company")}>{t("implementation.newCompany")}</Button> : null}
      {implementation.checklist.some((item) => item.key === "owner" && !item.done) ? <Link href={`/admin/organizations/${implementation.group.id}?tab=users`} className="inline-flex h-8 items-center rounded-lg border border-line px-3 text-table font-medium text-fg hover:bg-hover" data-testid="assign-group-ceo-link">{t("implementation.assignGroupCeo")}</Link> : null}
      {actions.canProvision && companies.length > 0 ? <Button size="sm" variant="secondary" onClick={() => setOpen("person")}>{t("implementation.addToRoster")}</Button> : null}
      {actions.canProvision && companies.length === 0 ? <span className="max-w-xs text-meta text-fg-subtle" data-testid="roster-needs-company">{t("implementation.rosterNeedsCompany")}</span> : null}
      {actions.canProvision && projects.length > 0 && people.length > 0 ? <Button size="sm" variant="ghost" onClick={() => setOpen("project")}>{t("implementation.assignToProject")}</Button> : null}
      {actions.canConfigure ? <Button size="sm" variant="ghost" onClick={() => setOpen("identity")}>{t("implementation.editDetails")}</Button> : null}

      <FormDialog
        open={open === "identity"}
        onOpenChange={close}
        title={t("implementation.groupDetails")}
        fields={identityFields.filter((field) => field.name !== "slug")}
        initial={implementation.group}
        submitLabel={t("implementation.save")}
        onSubmit={async (payload) => {
          await engineeringApi(base, { method: "PATCH", body: payload });
          await run("identity", async () => null, t("implementation.groupDetailsSaved"));
        }}
      />
      <FormDialog
        open={open === "company"}
        onOpenChange={close}
        title={t("implementation.newCompany")}
        description={t("implementation.newCompanyDescription")}
        fields={[
          { name: "name", label: t("implementation.fields.name"), type: "text", required: true },
          { name: "slug", label: t("implementation.fields.code"), type: "text", hint: t("implementation.fields.codeHint") },
          { name: "legalName", label: t("implementation.fields.legalName"), type: "text" },
          { name: "registrationNumber", label: t("implementation.fields.registrationNumber"), type: "text", hint: t("implementation.fields.registrationHint") },
          { name: "taxNumber", label: t("implementation.fields.taxNumber"), type: "text" },
          { name: "industry", label: t("implementation.fields.industry"), type: "text" },
          { name: "country", label: t("implementation.fields.country"), type: "text" },
          { name: "address", label: t("implementation.fields.address"), type: "text", wide: true },
          { name: "email", label: t("implementation.fields.email"), type: "email" },
          { name: "phone", label: t("implementation.fields.phone"), type: "text" },
          { name: "website", label: t("implementation.fields.website"), type: "text" },
          // The departments the company runs (E-13 §48, §49): only these get a branch.
          ...implementation.departmentOptions.map((department) => ({ name: `department:${department.id}`, label: `${department.name} (${department.code})`, type: "checkbox" as const })),
        ]}
        initial={Object.fromEntries(implementation.departmentOptions.map((department) => [`department:${department.id}`, true]))}
        submitLabel={t("implementation.createCompany")}
        wide
        testId="create-company-dialog"
        onSubmit={async (payload) => {
          const departmentIds = Object.entries(payload).filter(([key, value]) => key.startsWith("department:") && value === true).map(([key]) => key.slice("department:".length));
          const company = Object.fromEntries(Object.entries(payload).filter(([key]) => !key.startsWith("department:")));
          await engineeringApi(`${base}/companies`, { body: { ...company, disabledModules: [], departmentIds } });
          await run("company", async () => null, t("implementation.companyCreated"));
        }}
      />
      <FormDialog
        open={open === "person"}
        onOpenChange={close}
        title={t("implementation.rosterTitle")}
        description={t("implementation.rosterDescription")}
        fields={[
          { name: "firstName", label: t("implementation.fields.firstName"), type: "text", required: true },
          { name: "lastName", label: t("implementation.fields.lastName"), type: "text", required: true },
          { name: "workEmail", label: t("implementation.fields.workEmail"), type: "email" },
          { name: "username", label: t("implementation.fields.username"), type: "text", hint: t("implementation.fields.usernameHint") },
          { name: "roleKey", label: t("implementation.fields.role"), type: "select", required: true, hint: t("implementation.fields.roleHint"), options: MEMBERSHIP_ROLE_KEYS.map((value) => ({ value, label: roleLabel(value) })) },
          { name: "companyId", label: t("implementation.fields.company"), type: "select", options: companies, emptyLabel: t("implementation.fields.everyCompany") },
          { name: "position", label: t("implementation.fields.position"), type: "select", required: true, options: [{ value: "MEMBER", label: t("implementation.positions.MEMBER") }, { value: "COMPANY_MANAGER", label: t("implementation.positions.COMPANY_MANAGER") }, { value: "GROUP_HEAD", label: t("implementation.positions.GROUP_HEAD") }] },
          { name: "jobTitle", label: t("implementation.fields.jobTitle"), type: "text" },
        ]}
        initial={{ position: "MEMBER" }}
        submitLabel={t("implementation.createAccount")}
        // The credentials are shown once: never created from an unsaved-changes prompt (AUD-03 §3).
        saveKind="none"
        wide
        testId="initial-user-dialog"
        onSubmit={async (payload) => {
          const result = await engineeringApi<InitialUserResultDTO>(`${base}/initial-users`, {
            body: { ...payload, companyId: undefined, companyIds: payload.companyId ? [payload.companyId] : [] },
          });
          setCreated(result);
          await run("person", async () => null, t("implementation.accountCreated"));
        }}
      />
      <FormDialog
        open={open === "project"}
        onOpenChange={close}
        title={t("implementation.assignTitle")}
        fields={[
          { name: "userId", label: t("implementation.fields.person"), type: "select", required: true, options: people },
          { name: "projectId", label: t("implementation.fields.project"), type: "select", required: true, options: projects },
          { name: "projectRole", label: t("implementation.fields.projectRole"), type: "text" },
        ]}
        initial={{ userId: people[0]?.value, projectId: projects[0]?.value }}
        submitLabel={t("implementation.assign")}
        onSubmit={async (payload) => {
          await engineeringApi(`${base}/initial-project-members`, { body: payload });
          await run("project", async () => null, t("implementation.assigned"));
        }}
      />
      <ConfirmDialog
        open={open === "ready"}
        onOpenChange={close}
        title={t("implementation.readyTitle")}
        description={t("implementation.readyDescription")}
        confirmLabel={t("implementation.sendForValidation")}
        destructive={false}
        pending={pending === "ready"}
        onConfirm={() => void run("ready", () => engineeringApi(`${base}/ready`, { body: {} }), t("implementation.readySent"), () => setOpen(null))}
      />
      <ConfirmDialog
        open={open === "activate"}
        onOpenChange={close}
        title={t("implementation.activateTitle", { name: implementation.group.name })}
        description={t("implementation.activateDescription")}
        confirmLabel={t("implementation.activateGroup")}
        destructive={false}
        pending={pending === "activate"}
        onConfirm={() => void run("activate", () => engineeringApi(`${base}/activate`, { body: {} }), t("implementation.activated"), () => setOpen(null))}
      />

      <Dialog open={created !== null} onOpenChange={(next) => !next && setCreated(null)}>
        <DialogContent className="max-w-md" data-testid="initial-user-credentials">
          <DialogTitle>{t("implementation.credentialsTitle")}</DialogTitle>
          <DialogDescription>{t("implementation.credentialsDescription")}</DialogDescription>
          {created ? (
            <dl className="mt-4 space-y-3">
              <div>
                <dt className="text-meta text-fg-subtle">{t("implementation.username")}</dt>
                <dd className="flex items-center gap-2 font-mono text-body text-fg">
                  {created.username}
                  <CopyButton value={created.username} label={t("implementation.copyUsername")} />
                </dd>
              </div>
              <div>
                <dt className="text-meta text-fg-subtle">{t("implementation.temporaryPassword")}</dt>
                <dd className="flex items-center gap-2 font-mono text-body text-fg">
                  {created.temporaryPassword}
                  <CopyButton value={created.temporaryPassword} label={t("implementation.copyPassword")} />
                </dd>
              </div>
            </dl>
          ) : null}
          <DialogFooter>
            <Button onClick={() => setCreated(null)}>{t("implementation.done")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
