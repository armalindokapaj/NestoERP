"use client";

import * as React from "react";
import { Building2, ChevronDown, Link2, Network, Plus } from "lucide-react";

import { useTranslations } from "@/components/i18n/i18n-provider";
import { engineeringApi } from "@/components/engineering/engineering-api";
import { FormDialog, type FormField } from "@/components/engineering/form-kit";
import { useCreateParam } from "@/components/platform/platform-command";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { useToast } from "@/components/ui/toast";

type Option = { value: string; label: string };

/**
 * Create Company: a name, and a Parent Group only if wanted (Organizations
 * PRD §3, §4, §14, §15). None makes a standalone company. The same dialog
 * serves the directory, the global Create (`?create=company`) and a group's
 * Companies tab, where the group comes preselected (§26).
 */
export function CreateCompanyDialog({ open, onOpenChange, groups, group }: { open: boolean; onOpenChange: (open: boolean) => void; groups: Option[]; group?: Option }) {
  const toast = useToast();
  const t = useTranslations("adminOrgs");
  const fields: FormField[] = [
    { name: "name", label: t("create.company.nameLabel"), type: "text", required: true, maxLength: 120, validate: (value) => (typeof value === "string" && value.trim().length < 2 ? t("create.company.minChars") : null) },
    group
      ? { name: "groupId", label: t("create.company.groupLabel"), type: "select", options: [group], disabled: true }
      : { name: "groupId", label: t("create.company.groupLabel"), type: "select", options: groups, emptyLabel: t("create.company.noneStandalone"), hint: t("create.company.groupHint") },
  ];
  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={t("create.company.dialogTitle")}
      description={t("create.company.dialogDescription")}
      fields={fields}
      initial={{ groupId: group?.value ?? "" }}
      submitLabel={t("create.company.submit")}
      testId="new-company-dialog"
      onSubmit={async (payload) => {
        const groupId = group?.value ?? payload.groupId;
        const result = await engineeringApi<{ companyId: string }>("/api/platform-admin/command", { body: { action: "company.create", name: payload.name, ...(groupId ? { groupId } : {}) } });
        toast({ title: t("create.company.toast"), tone: "success" });
        return { redirectTo: `/admin/organizations/${result.companyId}` };
      }}
    />
  );
}

export function CreateGroupDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const toast = useToast();
  const t = useTranslations("adminOrgs");
  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={t("create.group.dialogTitle")}
      description={t("create.group.dialogDescription")}
      fields={[{ name: "name", label: t("create.group.nameLabel"), type: "text", required: true, maxLength: 120, validate: (value) => (typeof value === "string" && value.trim().length < 2 ? t("create.company.minChars") : null) }]}
      submitLabel={t("create.group.submit")}
      testId="new-group-dialog"
      onSubmit={async (payload) => {
        const created = await engineeringApi<{ id: string }>("/api/platform/parent-groups", { body: { name: payload.name } });
        toast({ title: t("create.group.toast"), tone: "success" });
        return { redirectTo: `/admin/organizations/${created.id}` };
      }}
    />
  );
}

/** The directory's one Create (§5, §13): Company or Parent Group. */
export function OrganizationCreateMenu({ groups, canCompany, canGroup }: { groups: Option[]; canCompany: boolean; canGroup: boolean }) {
  const t = useTranslations("adminOrgs");
  const [company, setCompany] = useCreateParam("company");
  const [group, setGroup] = useCreateParam("group");
  if (!canCompany && !canGroup) return null;
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button size="sm" data-testid="organization-create"><Plus aria-hidden="true" />{t("create.menu.create")}<ChevronDown aria-hidden="true" /></Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-52">
          {canCompany ? <DropdownMenuItem onSelect={() => setCompany(true)}><Building2 aria-hidden="true" className="size-4" />{t("create.menu.company")}</DropdownMenuItem> : null}
          {canGroup ? <DropdownMenuItem onSelect={() => setGroup(true)}><Network aria-hidden="true" className="size-4" />{t("create.menu.group")}</DropdownMenuItem> : null}
        </DropdownMenuContent>
      </DropdownMenu>
      {canCompany ? <CreateCompanyDialog open={company} onOpenChange={setCompany} groups={groups} /> : null}
      {canGroup ? <CreateGroupDialog open={group} onOpenChange={setGroup} /> : null}
    </>
  );
}

/**
 * A group's "+ Add Company" (§24-§27): a new company already in this group, or
 * an existing standalone company brought in with a reason.
 */
export function AddCompanyToGroup({ group, standalone }: { group: Option; standalone: Option[] }) {
  const [mode, setMode] = React.useState<"new" | "existing" | null>(null);
  const toast = useToast();
  const t = useTranslations("adminOrgs");
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button size="sm" data-testid="group-add-company"><Plus aria-hidden="true" />{t("create.add.addCompany")}<ChevronDown aria-hidden="true" /></Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-60">
          <DropdownMenuItem onSelect={() => setMode("new")}><Building2 aria-hidden="true" className="size-4" />{t("create.add.createNew")}</DropdownMenuItem>
          <DropdownMenuItem onSelect={() => setMode("existing")} disabled={standalone.length === 0}><Link2 aria-hidden="true" className="size-4" />{t("create.add.addExisting")}</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <CreateCompanyDialog open={mode === "new"} onOpenChange={(open) => setMode(open ? "new" : null)} groups={[]} group={group} />
      <FormDialog
        open={mode === "existing"}
        onOpenChange={(open) => setMode(open ? "existing" : null)}
        title={t("create.add.existingTitle", { group: group.label })}
        description={t("create.add.existingDescription")}
        fields={[
          { name: "companyId", label: t("create.add.standaloneLabel"), type: "select", required: true, options: standalone },
          { name: "reason", label: t("common.reason"), type: "textarea", required: true },
        ]}
        submitLabel={t("create.add.submit")}
        testId="attach-company-dialog"
        onSubmit={async (payload) => {
          await engineeringApi("/api/platform-admin/command", { body: { action: "company.attach", companyId: payload.companyId, groupId: group.value, reason: payload.reason } });
          toast({ title: t("create.add.toast", { group: group.label }), tone: "success" });
          return { redirectTo: `/admin/organizations/${group.value}?tab=companies` };
        }}
      />
    </>
  );
}
