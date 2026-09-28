"use client";

import * as React from "react";
import Link from "@/components/navigation/nav-link";
import { useRouter } from "@/components/navigation/guarded-router";
import { CheckCircle2, MailWarning } from "lucide-react";

import {
  Field,
  FieldErrorProvider,
  FormSection,
  selectClass,
  type SelectOption,
} from "@/components/forms/record-form";
import { useTeamTranslations } from "@/components/team/team-text";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SaveMessages, UnsavedIndicator } from "@/components/unsaved/editor-status";
import { useEditorSave } from "@/components/unsaved/use-editor-save";
import { inviteMemberAction } from "@/lib/actions/team";

/**
 * Invite a member (PRD #14 §61–§72).
 *
 * Two outcomes are both successes and are reported differently: the invitation
 * exists either way, and whether the message was delivered is a separate fact
 * (PRD #14 §72). A delivery failure offers the link rather than pretending the
 * invitation was lost, so somebody can pass it on by hand.
 *
 * The form's only way forward is sending the invitation, so it registers as
 * workflow-only (AUD-03 §3): leaving with anything typed asks, and the prompt
 * offers Stay or Discard — it never sends an invitation.
 */
export function InviteForm({
  roles,
  departments,
  cancelHref,
}: {
  roles: SelectOption[];
  departments: SelectOption[];
  cancelHref: string;
}) {
  const [sent, setSent] = React.useState<Sent | null>(null);
  const t = useTeamTranslations();

  if (sent) {
    return (
      <div className="nesto-card p-6">
        <div className="flex items-start gap-3">
          <span
            aria-hidden="true"
            className={
              sent.delivered
                ? "mt-0.5 grid size-9 shrink-0 place-items-center rounded-full bg-success-soft text-success-strong"
                : "mt-0.5 grid size-9 shrink-0 place-items-center rounded-full bg-warning-soft text-warning-strong"
            }
          >
            {sent.delivered ? (
              <CheckCircle2 className="size-5" />
            ) : (
              <MailWarning className="size-5" />
            )}
          </span>
          <div className="min-w-0">
            <p className="text-card font-semibold text-fg">
              {sent.delivered
                ? t("invite.sentTo", { email: sent.email })
                : t("invite.createdFor", { email: sent.email })}
            </p>
            <p className="mt-1 text-table text-fg-muted">
              {sent.delivered
                ? t("invite.sentBody")
                : t("invite.createdBody")}
            </p>
            {sent.inviteUrl ? (
              <p className="mt-3 break-all rounded-md border border-line bg-surface-muted px-3 py-2 font-mono text-meta text-fg-muted">
                {sent.inviteUrl}
              </p>
            ) : null}
          </div>
        </div>

        <div className="mt-5 flex flex-wrap items-center gap-2">
          <Button asChild size="sm">
            <Link href="/team/invitations">{t("invite.viewInvitations")}</Link>
          </Button>
          <Button variant="secondary" size="sm" onClick={() => setSent(null)}>
            {t("invite.inviteAnother")}
          </Button>
        </div>
      </div>
    );
  }

  // Mounted afresh for each invitation, so its editor starts clean.
  return <InviteFields roles={roles} departments={departments} cancelHref={cancelHref} onSent={setSent} />;
}

type Sent = { email: string; delivered: boolean; inviteUrl?: string };

function InviteFields({
  roles,
  departments,
  cancelHref,
  onSent,
}: {
  roles: SelectOption[];
  departments: SelectOption[];
  cancelHref: string;
  onSent: (sent: Sent) => void;
}) {
  const router = useRouter();
  const formRef = React.useRef<HTMLFormElement>(null);
  const t = useTeamTranslations();
  const save = useEditorSave({
    formRef,
    action: inviteMemberAction,
    module: "team",
    saveKind: "none",
    workflow: "Send",
    label: t("invite.label"),
    onCommitted: (result) => {
      if (result) onSent({ email: result.email, delivered: result.delivered, ...(result.inviteUrl ? { inviteUrl: result.inviteUrl } : {}) });
      router.refresh();
      return true;
    },
  });
  const { pending, fieldErrors } = save;

  return (
    <FieldErrorProvider value={fieldErrors}>
      <form ref={formRef} onSubmit={save.onSubmit} className="space-y-5">
        <SaveMessages save={save} />

        {/* The submitted snapshot is sent as it was (AUD-03 §6). */}
        <fieldset disabled={pending} className="m-0 min-w-0 space-y-5 border-0 p-0">
        <FormSection
          title={t("invite.whoTitle")}
          description={t("invite.whoDescription")}
        >
          <Field label={t("invite.email")} name="email" required className="sm:col-span-2">
            <Input
              id="email"
              name="email"
              type="email"
              autoComplete="off"
              required
              maxLength={254}
              placeholder="name@company.com"
            />
          </Field>

          <Field label={t("invite.firstName")} name="firstName">
            <Input id="firstName" name="firstName" maxLength={120} />
          </Field>

          <Field label={t("invite.lastName")} name="lastName">
            <Input id="lastName" name="lastName" maxLength={120} />
          </Field>
        </FormSection>

        <FormSection
          title={t("invite.accessTitle")}
          description={t("invite.accessDescription")}
        >
          <Field label={t("invite.role")} name="roleId" required>
            <select id="roleId" name="roleId" required className={selectClass} defaultValue="">
              <option value="" disabled>
                {t("invite.chooseRole")}
              </option>
              {roles.map((role) => (
                <option key={role.value} value={role.value}>
                  {role.label}
                </option>
              ))}
            </select>
          </Field>

          <Field label={t("invite.department")} name="departmentId">
            <select id="departmentId" name="departmentId" className={selectClass} defaultValue="">
              <option value="">{t("invite.noDepartment")}</option>
              {departments.map((department) => (
                <option key={department.value} value={department.value}>
                  {department.label}
                </option>
              ))}
            </select>
          </Field>

          <Field label={t("invite.jobTitle")} name="jobTitle" className="sm:col-span-2">
            <Input id="jobTitle" name="jobTitle" maxLength={160} placeholder={t("invite.jobTitlePlaceholder")} />
          </Field>
        </FormSection>
        </fieldset>

        <div className="flex flex-wrap items-center gap-2">
          <Button type="submit" disabled={pending}>
            {pending ? t("invite.sending") : t("invite.send")}
          </Button>
          <Button asChild type="button" variant="secondary">
            <Link href={cancelHref}>{t("invite.cancel")}</Link>
          </Button>
          <UnsavedIndicator save={save} />
        </div>
      </form>
    </FieldErrorProvider>
  );
}
