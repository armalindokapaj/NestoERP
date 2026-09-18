"use client";

import * as React from "react";

import { engineeringApi } from "@/components/engineering/engineering-api";
import { FormDialog, useCommand } from "@/components/engineering/form-kit";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import type { GrantOptionsDTO } from "@/lib/modules/organization/access-grant.service";

const LEVELS = [
  { value: "VIEW", label: "View" },
  { value: "CONTRIBUTE", label: "Contribute" },
  { value: "APPROVE", label: "Approve" },
  { value: "MANAGE", label: "Manage" },
];

/**
 * Delegating one module to one person (E-06 §18). The server checks who may,
 * which module, and that nobody hands on more than they hold; this only asks.
 */
export function GrantAccessButton({ options }: { options: GrantOptionsDTO }) {
  const { run } = useCommand();
  const [open, setOpen] = React.useState(false);
  if (options.people.length === 0 || options.modules.length === 0) return null;
  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)}>
        Delegate access
      </Button>
      <FormDialog
        open={open}
        onOpenChange={setOpen}
        title="Delegate access"
        description="Raises one module for one person, in one company or across the group. You can delegate only what you hold yourself."
        fields={[
          { name: "userId", label: "Person", type: "select", required: true, options: options.people.map((person) => ({ value: person.userId, label: person.name })) },
          { name: "moduleKey", label: "Module", type: "select", required: true, options: options.modules.map((module) => ({ value: module.key, label: module.label })) },
          { name: "accessLevel", label: "Access", type: "select", required: true, options: LEVELS },
          {
            name: "scope",
            label: "Where",
            type: "select",
            required: true,
            options: [
              { value: "COMPANY", label: "One company" },
              { value: "GROUP", label: "Every company of the group" },
            ],
          },
          { name: "scopeCompanyId", label: "Company", type: "select", required: true, options: options.companies.map((company) => ({ value: company.id, label: company.name })), visible: (values) => values.scope === "COMPANY" },
          { name: "expiresAt", label: "Expires on", type: "date", hint: "The access stops at the start of this day. Leave empty to keep it until revoked." },
          { name: "reason", label: "Reason", type: "textarea", required: true, placeholder: "Why this access is needed" },
        ]}
        initial={{ userId: options.people[0]?.userId, moduleKey: options.modules[0]?.key, accessLevel: "VIEW", scope: "COMPANY", scopeCompanyId: options.companies[0]?.id }}
        submitLabel="Delegate"
        testId="grant-dialog"
        onSubmit={async (payload) => {
          await engineeringApi("/api/organization/access-grants", { body: payload });
          await run("grant", async () => null, "Access delegated.");
        }}
      />
    </>
  );
}

export function RevokeGrantButton({ grantId, holder, module }: { grantId: string; holder: string; module: string }) {
  const { pending, run } = useCommand();
  const [open, setOpen] = React.useState(false);
  return (
    <>
      <button type="button" className="text-meta text-accent-strong hover:underline" onClick={() => setOpen(true)} aria-label={`Revoke ${holder}'s ${module} access`}>
        Revoke
      </button>
      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title={`Revoke ${holder}'s ${module} access?`}
        description="What was delegated ends now. Their own role and position are unchanged, and the grant stays in the history."
        confirmLabel="Revoke access"
        pending={pending === "revoke"}
        onConfirm={() => void run("revoke", () => engineeringApi(`/api/organization/access-grants/${grantId}/revoke`, { body: {} }), "Access revoked.", () => setOpen(false))}
      />
    </>
  );
}
