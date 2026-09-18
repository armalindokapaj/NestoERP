"use client";

import * as React from "react";
import { useRouter } from "next/navigation";

import { engineeringApi } from "@/components/engineering/engineering-api";
import { FormDialog, useCommand, type FormField } from "@/components/engineering/form-kit";
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

const identityFields: FormField[] = [
  { name: "name", label: "Name", type: "text", required: true },
  { name: "slug", label: "Slug", type: "text", required: true, hint: "Lowercase letters, digits and hyphens. Fixed once created." },
  { name: "legalName", label: "Legal name", type: "text" },
  { name: "country", label: "Country", type: "text" },
  { name: "timezone", label: "Time zone", type: "text", placeholder: "Europe/Tirane" },
  { name: "currency", label: "Currency", type: "text", placeholder: "EUR" },
];

export function CreateGroupButton() {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)}>
        Create parent group
      </Button>
      <FormDialog
        open={open}
        onOpenChange={setOpen}
        title="Create parent group"
        description="The group starts implementing, with every group department. Companies, people and projects follow."
        fields={identityFields}
        submitLabel="Create group"
        testId="create-group-dialog"
        onSubmit={async (payload) => {
          const group = await engineeringApi<{ id: string }>("/api/platform/parent-groups", { body: payload });
          router.push(`/platform-admin/groups/${group.id}`);
        }}
      />
    </>
  );
}

type Open = "identity" | "company" | "person" | "project" | "ready" | "activate" | null;

export function GroupImplementationActions({ implementation }: { implementation: GroupImplementationDTO }) {
  const { pending, run } = useCommand();
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
      {actions.canActivate ? <Button size="sm" onClick={() => setOpen("activate")}>Activate group</Button> : null}
      {actions.canMarkReady ? <Button size="sm" variant="secondary" onClick={() => setOpen("ready")}>Send for validation</Button> : null}
      {actions.canAddCompany ? <Button size="sm" variant="secondary" onClick={() => setOpen("company")}>New company</Button> : null}
      {actions.canProvision && companies.length > 0 ? <Button size="sm" variant="secondary" onClick={() => setOpen("person")}>Add to roster</Button> : null}
      {actions.canProvision && projects.length > 0 && people.length > 0 ? <Button size="sm" variant="ghost" onClick={() => setOpen("project")}>Assign to project</Button> : null}
      {actions.canConfigure ? <Button size="sm" variant="ghost" onClick={() => setOpen("identity")}>Edit details</Button> : null}

      <FormDialog
        open={open === "identity"}
        onOpenChange={close}
        title="Group details"
        fields={identityFields.filter((field) => field.name !== "slug")}
        initial={implementation.group}
        submitLabel="Save"
        onSubmit={async (payload) => {
          await engineeringApi(base, { method: "PATCH", body: payload });
          await run("identity", async () => null, "Group details saved.");
        }}
      />
      <FormDialog
        open={open === "company"}
        onOpenChange={close}
        title="New company"
        description="Its settings, modules and numbering are created with it, and a branch of each department chosen below. The group's Owner and IT join it."
        fields={[
          { name: "name", label: "Name", type: "text", required: true },
          { name: "slug", label: "Slug", type: "text", required: true },
          { name: "legalName", label: "Legal name", type: "text" },
          { name: "registrationNumber", label: "Registration number", type: "text", hint: "The company is the employing legal entity." },
          { name: "taxNumber", label: "Tax number", type: "text" },
          { name: "industry", label: "Industry", type: "text" },
          { name: "country", label: "Country", type: "text" },
          { name: "address", label: "Address", type: "text", wide: true },
          { name: "email", label: "Email", type: "email" },
          { name: "phone", label: "Phone", type: "text" },
          { name: "website", label: "Website", type: "text" },
          // The departments the company runs (E-13 §48, §49): only these get a branch.
          ...implementation.departmentOptions.map((department) => ({ name: `department:${department.id}`, label: `${department.name} (${department.code})`, type: "checkbox" as const })),
        ]}
        initial={Object.fromEntries(implementation.departmentOptions.map((department) => [`department:${department.id}`, true]))}
        submitLabel="Create company"
        wide
        testId="create-company-dialog"
        onSubmit={async (payload) => {
          const departmentIds = Object.entries(payload).filter(([key, value]) => key.startsWith("department:") && value === true).map(([key]) => key.slice("department:".length));
          const company = Object.fromEntries(Object.entries(payload).filter(([key]) => !key.startsWith("department:")));
          await engineeringApi(`${base}/companies`, { body: { ...company, disabledModules: [], departmentIds } });
          await run("company", async () => null, "Company created.");
        }}
      />
      <FormDialog
        open={open === "person"}
        onOpenChange={close}
        title="Add to the initial roster"
        description="From the approved roster only. The Owner and Group IT work in every company; everyone else in the one chosen."
        fields={[
          { name: "firstName", label: "First name", type: "text", required: true },
          { name: "lastName", label: "Last name", type: "text", required: true },
          { name: "workEmail", label: "Work email", type: "email" },
          { name: "username", label: "Username", type: "text", hint: "Blank follows firstname.lastname." },
          { name: "roleKey", label: "Role", type: "select", required: true, options: MEMBERSHIP_ROLE_KEYS.map((value) => ({ value, label: roleLabel(value) })) },
          { name: "companyId", label: "Company", type: "select", options: companies, emptyLabel: "Every company (Owner, Group IT)" },
          { name: "position", label: "Position", type: "select", required: true, options: [{ value: "MEMBER", label: "Member" }, { value: "COMPANY_MANAGER", label: "Company department manager" }, { value: "GROUP_HEAD", label: "Group department head" }] },
          { name: "jobTitle", label: "Job title", type: "text" },
        ]}
        initial={{ position: "MEMBER" }}
        submitLabel="Create account"
        wide
        testId="initial-user-dialog"
        onSubmit={async (payload) => {
          const result = await engineeringApi<InitialUserResultDTO>(`${base}/initial-users`, {
            body: { ...payload, companyId: undefined, companyIds: payload.companyId ? [payload.companyId] : [] },
          });
          setCreated(result);
          await run("person", async () => null, "Account created.");
        }}
      />
      <FormDialog
        open={open === "project"}
        onOpenChange={close}
        title="Assign to a project"
        fields={[
          { name: "userId", label: "Person", type: "select", required: true, options: people },
          { name: "projectId", label: "Project", type: "select", required: true, options: projects },
          { name: "projectRole", label: "Role on the project", type: "text" },
        ]}
        initial={{ userId: people[0]?.value, projectId: projects[0]?.value }}
        submitLabel="Assign"
        onSubmit={async (payload) => {
          await engineeringApi(`${base}/initial-project-members`, { body: payload });
          await run("project", async () => null, "Assigned.");
        }}
      />
      <ConfirmDialog
        open={open === "ready"}
        onOpenChange={close}
        title="Send the implementation for validation?"
        description="The Owner and stakeholders check companies, departments, people, roles, managers and projects before the group goes live."
        confirmLabel="Send for validation"
        destructive={false}
        pending={pending === "ready"}
        onConfirm={() => void run("ready", () => engineeringApi(`${base}/ready`, { body: {} }), "Sent for validation.", () => setOpen(null))}
      />
      <ConfirmDialog
        open={open === "activate"}
        onOpenChange={close}
        title={`Activate ${implementation.group.name}?`}
        description="The group goes live. From now on HR and Group IT add people, and department managers assign projects; the initial roster closes."
        confirmLabel="Activate group"
        destructive={false}
        pending={pending === "activate"}
        onConfirm={() => void run("activate", () => engineeringApi(`${base}/activate`, { body: {} }), "Group activated.", () => setOpen(null))}
      />

      <Dialog open={created !== null} onOpenChange={(next) => !next && setCreated(null)}>
        <DialogContent className="max-w-md" data-testid="initial-user-credentials">
          <DialogTitle>Account created</DialogTitle>
          <DialogDescription>Hand these over securely. The temporary password is not shown again and must be changed at first sign-in.</DialogDescription>
          {created ? (
            <dl className="mt-4 space-y-3">
              <div>
                <dt className="text-meta text-fg-subtle">Username</dt>
                <dd className="flex items-center gap-2 font-mono text-body text-fg">
                  {created.username}
                  <CopyButton value={created.username} label="Copy username" />
                </dd>
              </div>
              <div>
                <dt className="text-meta text-fg-subtle">Temporary password</dt>
                <dd className="flex items-center gap-2 font-mono text-body text-fg">
                  {created.temporaryPassword}
                  <CopyButton value={created.temporaryPassword} label="Copy password" />
                </dd>
              </div>
            </dl>
          ) : null}
          <DialogFooter>
            <Button onClick={() => setCreated(null)}>Done</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
