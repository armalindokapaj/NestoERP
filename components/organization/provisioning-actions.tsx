"use client";

import * as React from "react";

import { engineeringApi } from "@/components/engineering/engineering-api";
import { FormDialog, ReasonDialog, useCommand } from "@/components/engineering/form-kit";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { CopyButton } from "@/components/ui/copy-button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogTitle } from "@/components/ui/dialog";
import type { ProvisionResultDTO, ProvisioningDetailDTO } from "@/lib/modules/organization/provisioning/provisioning.service";
import { formatDateTime } from "@/lib/utils/format";
import { useOrganizationTranslations } from "./organization-text";

type Open = "approve" | "reject" | "return" | "start" | "provision" | "cancel" | null;

/**
 * The decisions on an account request (E-06 §64): approve or reject it, return
 * it to HR with what needs to change, take it on, create the account, or cancel
 * it. The created account's temporary password is shown here once and never
 * again (PRD #50 §18).
 */
export function ProvisioningActions({ request }: { request: ProvisioningDetailDTO }) {
  const { pending, run } = useCommand();
  const t = useOrganizationTranslations();
  const [open, setOpen] = React.useState<Open>(null);
  const [created, setCreated] = React.useState<ProvisionResultDTO | null>(null);
  const base = `/api/organization/user-provisioning-requests/${request.id}`;
  const actions = request.actions;
  const close = (next: boolean) => !next && setOpen(null);
  const name = request.person.name;

  return (
    <div className="flex flex-wrap items-center gap-2" data-testid="provisioning-actions">
      {actions.canProvision ? (
        <Button size="sm" onClick={() => setOpen("provision")}>
          {request.existingAccount ? t("actions.addCompanyToAccount") : t("actions.createAccount")}
        </Button>
      ) : null}
      {actions.canApprove ? (
        <Button size="sm" onClick={() => setOpen("approve")}>
          {t("actions.approve")}
        </Button>
      ) : null}
      {actions.canStart ? (
        <Button size="sm" variant="secondary" onClick={() => setOpen("start")}>
          {t("actions.markInProgress")}
        </Button>
      ) : null}
      {actions.canSubmit ? (
        <Button size="sm" variant="secondary" onClick={() => void run("submit", () => engineeringApi(`/api/hr/user-provisioning-requests/${request.id}/submit`, { body: {} }), t("actions.submitted"))} disabled={pending === "submit"}>
          {t("actions.submit")}
        </Button>
      ) : null}
      {actions.canReturn ? (
        <Button size="sm" variant="secondary" onClick={() => setOpen("return")}>
          {t("actions.returnToHr")}
        </Button>
      ) : null}
      {actions.canReject ? (
        <Button size="sm" variant="secondary" onClick={() => setOpen("reject")}>
          {t("actions.reject")}
        </Button>
      ) : null}
      {actions.canCancel ? (
        <Button size="sm" variant="ghost" onClick={() => setOpen("cancel")}>
          {t("actions.cancelRequest")}
        </Button>
      ) : null}

      <ConfirmDialog
        open={open === "approve"}
        onOpenChange={close}
        title={t("actions.approveTitle", { name })}
        description={t("actions.approveDescription", { role: request.role.label, department: request.department.name, company: request.company.name })}
        confirmLabel={t("actions.approve")}
        destructive={false}
        pending={pending === "approve"}
        onConfirm={() => void run("approve", () => engineeringApi(`${base}/approve`, { body: {} }), t("actions.approved"), () => setOpen(null))}
      />
      <ConfirmDialog
        open={open === "start"}
        onOpenChange={close}
        title={t("actions.startTitle")}
        description={t("actions.startDescription")}
        confirmLabel={t("actions.markInProgress")}
        destructive={false}
        pending={pending === "start"}
        onConfirm={() => void run("start", () => engineeringApi(`${base}/start`, { body: {} }), t("actions.started"), () => setOpen(null))}
      />
      <ConfirmDialog
        open={open === "cancel"}
        onOpenChange={close}
        title={t("actions.cancelTitle")}
        description={t("actions.cancelDescription")}
        confirmLabel={t("actions.cancelRequest")}
        cancelLabel={t("actions.keepIt")}
        pending={pending === "cancel"}
        onConfirm={() => void run("cancel", () => engineeringApi(`${base}/cancel`, { body: {} }), t("actions.cancelled"), () => setOpen(null))}
      />
      <ReasonDialog
        open={open === "return"}
        onOpenChange={close}
        title={t("actions.returnTitle")}
        description={t("actions.returnDescription")}
        label={t("actions.returnLabel")}
        confirmLabel={t("actions.returnToHr")}
        onConfirm={async (payload) => {
          await engineeringApi(`${base}/return`, { body: payload });
          await run("return", async () => null, t("actions.returnedDone"));
        }}
      />
      <ReasonDialog
        open={open === "reject"}
        onOpenChange={close}
        title={t("actions.rejectTitle", { name })}
        confirmLabel={t("actions.reject")}
        destructive
        onConfirm={async (payload) => {
          await engineeringApi(`${base}/reject`, { body: payload });
          await run("reject", async () => null, t("actions.rejectedDone"));
        }}
      />
      <FormDialog
        open={open === "provision"}
        onOpenChange={close}
        title={request.existingAccount ? t("actions.addCompanyTitle", { company: request.company.name, name }) : t("actions.createTitle", { name })}
        description={
          request.existingAccount
            ? t("actions.existingDescription", { name, username: request.existingAccount.username, company: request.company.name })
            : t("actions.createDescription")
        }
        fields={request.existingAccount ? [] : [{ name: "username", label: t("actions.username"), type: "text", placeholder: request.requestedUsername ?? request.suggestedUsername, hint: t("actions.usernameHint") }]}
        submitLabel={request.existingAccount ? t("actions.addCompany") : t("actions.createAccount")}
        // Provisioning is the request's workflow step, and its credentials are
        // shown once: never run from the unsaved-changes prompt (AUD-03 §3).
        saveKind="none"
        testId="provision-dialog"
        onSubmit={async (payload) => {
          const result = await engineeringApi<ProvisionResultDTO>(`${base}/provision`, { body: payload });
          setCreated(result);
          await run("provision", async () => null, result.newAccount ? t("actions.accountCreated") : t("actions.companyAdded"));
        }}
      />

      <Dialog open={created !== null && created.temporaryPassword !== null} onOpenChange={(next) => !next && setCreated(null)}>
        <DialogContent className="max-w-md" data-testid="provisioned-credentials">
          <DialogTitle>{t("actions.createdTitle")}</DialogTitle>
          <DialogDescription>{t("actions.createdDescription", { name })}</DialogDescription>
          {created?.temporaryPassword ? (
            <dl className="mt-4 space-y-3">
              <div>
                <dt className="text-meta text-fg-subtle">{t("actions.username")}</dt>
                <dd className="flex items-center gap-2 font-mono text-body text-fg" data-testid="provisioned-username">
                  {created.username}
                  <CopyButton value={created.username} label={t("actions.copyUsername")} />
                </dd>
              </div>
              <div>
                <dt className="text-meta text-fg-subtle">{t("actions.temporaryPassword")}</dt>
                <dd className="flex items-center gap-2 font-mono text-body text-fg" data-testid="provisioned-password">
                  {created.temporaryPassword}
                  <CopyButton value={created.temporaryPassword} label={t("actions.copyPassword")} />
                </dd>
              </div>
              {created.expiresAt ? <p className="text-meta text-fg-muted">{t("actions.expires", { date: formatDateTime(created.expiresAt) })}</p> : null}
            </dl>
          ) : null}
          <DialogFooter>
            <Button onClick={() => setCreated(null)}>{t("actions.done")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
