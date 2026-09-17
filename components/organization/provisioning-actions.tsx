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

type Open = "approve" | "reject" | "return" | "start" | "provision" | "cancel" | null;

/**
 * The decisions on an account request (E-06 §64): approve or reject it, return
 * it to HR with what needs to change, take it on, create the account, or cancel
 * it. The created account's temporary password is shown here once and never
 * again (PRD #50 §18).
 */
export function ProvisioningActions({ request }: { request: ProvisioningDetailDTO }) {
  const { pending, run } = useCommand();
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
          {request.existingAccount ? "Add company to account" : "Create account"}
        </Button>
      ) : null}
      {actions.canApprove ? (
        <Button size="sm" onClick={() => setOpen("approve")}>
          Approve
        </Button>
      ) : null}
      {actions.canStart ? (
        <Button size="sm" variant="secondary" onClick={() => setOpen("start")}>
          Mark in progress
        </Button>
      ) : null}
      {actions.canSubmit ? (
        <Button size="sm" variant="secondary" onClick={() => void run("submit", () => engineeringApi(`/api/hr/user-provisioning-requests/${request.id}/submit`, { body: {} }), "Request submitted.")} disabled={pending === "submit"}>
          Submit
        </Button>
      ) : null}
      {actions.canReturn ? (
        <Button size="sm" variant="secondary" onClick={() => setOpen("return")}>
          Return to HR
        </Button>
      ) : null}
      {actions.canReject ? (
        <Button size="sm" variant="ghost" onClick={() => setOpen("reject")}>
          Reject
        </Button>
      ) : null}
      {actions.canCancel ? (
        <Button size="sm" variant="ghost" onClick={() => setOpen("cancel")}>
          Cancel request
        </Button>
      ) : null}

      <ConfirmDialog
        open={open === "approve"}
        onOpenChange={close}
        title={`Approve a NESTO account for ${name}?`}
        description={`Group IT can then create it, as ${request.role.label} in ${request.department.name}, ${request.company.name}.`}
        confirmLabel="Approve"
        destructive={false}
        pending={pending === "approve"}
        onConfirm={() => void run("approve", () => engineeringApi(`${base}/approve`, { body: {} }), "Request approved.", () => setOpen(null))}
      />
      <ConfirmDialog
        open={open === "start"}
        onOpenChange={close}
        title="Mark this request in progress?"
        description="Shows HR that Group IT has taken it on."
        confirmLabel="Mark in progress"
        destructive={false}
        pending={pending === "start"}
        onConfirm={() => void run("start", () => engineeringApi(`${base}/start`, { body: {} }), "Request in progress.", () => setOpen(null))}
      />
      <ConfirmDialog
        open={open === "cancel"}
        onOpenChange={close}
        title="Cancel this request?"
        description="No account is created. HR can raise a new request later."
        confirmLabel="Cancel request"
        cancelLabel="Keep it"
        pending={pending === "cancel"}
        onConfirm={() => void run("cancel", () => engineeringApi(`${base}/cancel`, { body: {} }), "Request cancelled.", () => setOpen(null))}
      />
      <ReasonDialog
        open={open === "return"}
        onOpenChange={close}
        title="Return this request to HR?"
        description="Say what needs to change in the HR record. It comes back as a new request for approval."
        label="What needs to change"
        confirmLabel="Return to HR"
        onConfirm={async (payload) => {
          await engineeringApi(`${base}/return`, { body: payload });
          await run("return", async () => null, "Request returned to HR.");
        }}
      />
      <ReasonDialog
        open={open === "reject"}
        onOpenChange={close}
        title={`Reject the account request for ${name}?`}
        confirmLabel="Reject"
        destructive
        onConfirm={async (payload) => {
          await engineeringApi(`${base}/reject`, { body: payload });
          await run("reject", async () => null, "Request rejected.");
        }}
      />
      <FormDialog
        open={open === "provision"}
        onOpenChange={close}
        title={request.existingAccount ? `Add ${request.company.name} to ${name}'s account` : `Create ${name}'s NESTO account`}
        description={
          request.existingAccount
            ? `${name} already signs in as ${request.existingAccount.username}. They gain a membership in ${request.company.name}; no new credentials are issued.`
            : "Everything about the person comes from HR. You choose the username; the password is temporary and must be changed at first sign-in."
        }
        fields={request.existingAccount ? [] : [{ name: "username", label: "Username", type: "text", placeholder: request.requestedUsername ?? request.suggestedUsername, hint: "Leave blank to use the one shown." }]}
        submitLabel={request.existingAccount ? "Add company" : "Create account"}
        testId="provision-dialog"
        onSubmit={async (payload) => {
          const result = await engineeringApi<ProvisionResultDTO>(`${base}/provision`, { body: payload });
          setCreated(result);
          await run("provision", async () => null, result.newAccount ? "Account created." : "Company added to the account.");
        }}
      />

      <Dialog open={created !== null && created.temporaryPassword !== null} onOpenChange={(next) => !next && setCreated(null)}>
        <DialogContent className="max-w-md" data-testid="provisioned-credentials">
          <DialogTitle>Account created</DialogTitle>
          <DialogDescription>Give these to {name} securely. The temporary password is not shown again.</DialogDescription>
          {created?.temporaryPassword ? (
            <dl className="mt-4 space-y-3">
              <div>
                <dt className="text-meta text-fg-subtle">Username</dt>
                <dd className="flex items-center gap-2 font-mono text-body text-fg" data-testid="provisioned-username">
                  {created.username}
                  <CopyButton value={created.username} label="Copy username" />
                </dd>
              </div>
              <div>
                <dt className="text-meta text-fg-subtle">Temporary password</dt>
                <dd className="flex items-center gap-2 font-mono text-body text-fg" data-testid="provisioned-password">
                  {created.temporaryPassword}
                  <CopyButton value={created.temporaryPassword} label="Copy password" />
                </dd>
              </div>
              {created.expiresAt ? <p className="text-meta text-fg-muted">Expires {formatDateTime(created.expiresAt)}.</p> : null}
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
