"use client";

import * as React from "react";

import { engineeringApi } from "@/components/engineering/engineering-api";
import { FormDialog, useCommand } from "@/components/engineering/form-kit";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { useModuleName, useOrganizationTranslations } from "./organization-text";
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
  const t = useOrganizationTranslations();
  const moduleName = useModuleName();
  const [open, setOpen] = React.useState(false);
  if (options.people.length === 0 || options.modules.length === 0) return null;
  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)}>
        {t("grants.delegateAccess")}
      </Button>
      <FormDialog
        open={open}
        onOpenChange={setOpen}
        title={t("grants.delegateAccess")}
        description={t("grants.description")}
        fields={[
          { name: "userId", label: t("grants.person"), type: "select", required: true, options: options.people.map((person) => ({ value: person.userId, label: person.name })) },
          { name: "moduleKey", label: t("grants.module"), type: "select", required: true, options: options.modules.map((module) => ({ value: module.key, label: moduleName(module.key, module.label) })) },
          { name: "accessLevel", label: t("grants.access"), type: "select", required: true, options: LEVELS.map((level) => ({ value: level.value, label: t(`labels.level.${level.value as "VIEW"}`) })) },
          {
            name: "scope",
            label: t("grants.where"),
            type: "select",
            required: true,
            options: [
              { value: "COMPANY", label: t("grants.oneCompany") },
              { value: "GROUP", label: t("grants.everyCompany") },
            ],
          },
          { name: "scopeCompanyId", label: t("grants.company"), type: "select", required: true, options: options.companies.map((company) => ({ value: company.id, label: company.name })), visible: (values) => values.scope === "COMPANY", whenHidden: "omit" },
          { name: "expiresAt", label: t("grants.expiresOn"), type: "date", hint: t("grants.expiresHint") },
          { name: "reason", label: t("grants.reason"), type: "textarea", required: true, placeholder: t("grants.reasonPlaceholder") },
        ]}
        initial={{ userId: options.people[0]?.userId, moduleKey: options.modules[0]?.key, accessLevel: "VIEW", scope: "COMPANY", scopeCompanyId: options.companies[0]?.id }}
        submitLabel={t("grants.delegate")}
        saveKind="none"
        testId="grant-dialog"
        onSubmit={async (payload) => {
          await engineeringApi("/api/organization/access-grants", { body: payload });
          await run("grant", async () => null, t("grants.delegated"));
        }}
      />
    </>
  );
}

export function RevokeGrantButton({ grantId, holder, module }: { grantId: string; holder: string; module: string }) {
  const { pending, run } = useCommand();
  const t = useOrganizationTranslations();
  const [open, setOpen] = React.useState(false);
  return (
    <>
      <button type="button" className="inline-flex items-center text-meta text-accent-strong hover:underline touch:min-h-11 touch:px-2" onClick={() => setOpen(true)} aria-label={t("grants.revokeLabel", { holder, module })}>
        {t("grants.revoke")}
      </button>
      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title={t("grants.revokeTitle", { holder, module })}
        description={t("grants.revokeDescription")}
        confirmLabel={t("grants.revokeConfirm")}
        pending={pending === "revoke"}
        onConfirm={() => void run("revoke", () => engineeringApi(`/api/organization/access-grants/${grantId}/revoke`, { body: {} }), t("grants.revoked"), () => setOpen(false))}
      />
    </>
  );
}
