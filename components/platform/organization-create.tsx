"use client";

import * as React from "react";
import { Building2, ChevronDown, Link2, Network, Plus } from "lucide-react";

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
  const fields: FormField[] = [
    { name: "name", label: "Company name", type: "text", required: true, maxLength: 120, validate: (value) => (typeof value === "string" && value.trim().length < 2 ? "Enter at least two characters." : null) },
    group
      ? { name: "groupId", label: "Parent Group", type: "select", options: [group], disabled: true }
      : { name: "groupId", label: "Parent Group", type: "select", options: groups, emptyLabel: "None — standalone company", hint: "Optional. A company can join or leave a group later." },
  ];
  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Create Company"
      description="Only the name is needed. Everything else can be completed from the company's page."
      fields={fields}
      initial={{ groupId: group?.value ?? "" }}
      submitLabel="Create Company"
      testId="new-company-dialog"
      onSubmit={async (payload) => {
        const groupId = group?.value ?? payload.groupId;
        const result = await engineeringApi<{ companyId: string }>("/api/platform-admin/command", { body: { action: "company.create", name: payload.name, ...(groupId ? { groupId } : {}) } });
        toast({ title: "Company created.", tone: "success" });
        return { redirectTo: `/admin/organizations/${result.companyId}` };
      }}
    />
  );
}

export function CreateGroupDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const toast = useToast();
  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Create Parent Group"
      description="Only the name is needed. Companies, owners and details follow from the group's page."
      fields={[{ name: "name", label: "Group name", type: "text", required: true, maxLength: 120, validate: (value) => (typeof value === "string" && value.trim().length < 2 ? "Enter at least two characters." : null) }]}
      submitLabel="Create Group"
      testId="new-group-dialog"
      onSubmit={async (payload) => {
        const created = await engineeringApi<{ id: string }>("/api/platform/parent-groups", { body: { name: payload.name } });
        toast({ title: "Parent Group created.", tone: "success" });
        return { redirectTo: `/admin/organizations/${created.id}` };
      }}
    />
  );
}

/** The directory's one Create (§5, §13): Company or Parent Group. */
export function OrganizationCreateMenu({ groups, canCompany, canGroup }: { groups: Option[]; canCompany: boolean; canGroup: boolean }) {
  const [company, setCompany] = useCreateParam("company");
  const [group, setGroup] = useCreateParam("group");
  if (!canCompany && !canGroup) return null;
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button size="sm" data-testid="organization-create"><Plus aria-hidden="true" />Create<ChevronDown aria-hidden="true" /></Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-52">
          {canCompany ? <DropdownMenuItem onSelect={() => setCompany(true)}><Building2 aria-hidden="true" className="size-4" />Create Company</DropdownMenuItem> : null}
          {canGroup ? <DropdownMenuItem onSelect={() => setGroup(true)}><Network aria-hidden="true" className="size-4" />Create Parent Group</DropdownMenuItem> : null}
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
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button size="sm" data-testid="group-add-company"><Plus aria-hidden="true" />Add Company<ChevronDown aria-hidden="true" /></Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-60">
          <DropdownMenuItem onSelect={() => setMode("new")}><Building2 aria-hidden="true" className="size-4" />Create New Company</DropdownMenuItem>
          <DropdownMenuItem onSelect={() => setMode("existing")} disabled={standalone.length === 0}><Link2 aria-hidden="true" className="size-4" />Add Existing Standalone Company</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <CreateCompanyDialog open={mode === "new"} onOpenChange={(open) => setMode(open ? "new" : null)} groups={[]} group={group} />
      <FormDialog
        open={mode === "existing"}
        onOpenChange={(open) => setMode(open ? "existing" : null)}
        title={`Add an existing company to ${group.label}`}
        description="The company keeps its ID, projects, users, modules and history. Its people and departments join the group; nothing group-wide travels with it."
        fields={[
          { name: "companyId", label: "Standalone company", type: "select", required: true, options: standalone },
          { name: "reason", label: "Reason", type: "textarea", required: true },
        ]}
        submitLabel="Add to Group"
        testId="attach-company-dialog"
        onSubmit={async (payload) => {
          await engineeringApi("/api/platform-admin/command", { body: { action: "company.attach", companyId: payload.companyId, groupId: group.value, reason: payload.reason } });
          toast({ title: `Company added to ${group.label}.`, tone: "success" });
          return { redirectTo: `/admin/organizations/${group.value}?tab=companies` };
        }}
      />
    </>
  );
}
