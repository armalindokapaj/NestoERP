"use client";

import * as React from "react";

import { useTranslations } from "@/components/i18n/i18n-provider";
import { useRouter } from "@/components/navigation/guarded-router";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/components/ui/toast";
import { enumLabel } from "@/lib/i18n/modules/adminAccess/enum-label";
import { startRecoveryEmailAction } from "@/lib/actions/platform-account";

/**
 * Starts a recovery-email change (ADM-01): the current password proves recent
 * authentication, and nothing changes until the new address confirms.
 */
export function RecoveryEmailForm({ hasCurrent }: { hasCurrent: boolean }) {
  const t = useTranslations("adminAccess");
  const router = useRouter();
  const toast = useToast();
  const [email, setEmail] = React.useState("");
  const [currentPassword, setCurrentPassword] = React.useState("");
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [pending, setPending] = React.useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (pending) return;
    setPending(true);
    try {
      const result = await startRecoveryEmailAction({ email, currentPassword });
      if (result.ok) {
        setEmail("");
        setCurrentPassword("");
        setErrors({});
        toast({ title: t("recoveryEmail.sent", { email: email.trim().toLowerCase() }), tone: "success" });
        router.refresh();
        return;
      }
      setErrors(result.fieldErrors ?? { form: result.code });
    } catch {
      setErrors({ form: "SAVE_FAILED" });
    } finally {
      setPending(false);
    }
  }

  const message = (key: string) => (errors[key] ? enumLabel(t, "recoveryEmail.errors", errors[key], t("recoveryEmail.fallbackError")) : null);

  return (
    <form noValidate onSubmit={submit} className="grid gap-4 sm:grid-cols-2">
      {errors.form ? <p role="alert" className="text-meta text-danger-strong sm:col-span-2">{message("form")}</p> : null}
      <div className="space-y-1.5">
        <Label htmlFor="recovery-email">{hasCurrent ? t("recoveryEmail.newLabel") : t("recoveryEmail.label")}</Label>
        <Input id="recovery-email" type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} aria-invalid={Boolean(errors.email)} aria-describedby={errors.email ? "recovery-email-error" : undefined} />
        {errors.email ? <p id="recovery-email-error" className="text-meta text-danger-strong">{message("email")}</p> : null}
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="recovery-current-password">{t("recoveryEmail.currentPassword")}</Label>
        <Input id="recovery-current-password" type="password" autoComplete="current-password" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} aria-invalid={Boolean(errors.currentPassword)} aria-describedby={errors.currentPassword ? "recovery-password-error" : undefined} />
        {errors.currentPassword ? <p id="recovery-password-error" className="text-meta text-danger-strong">{message("currentPassword")}</p> : null}
      </div>
      <div className="sm:col-span-2">
        <Button type="submit" disabled={pending || !email.trim() || !currentPassword}>
          {pending ? t("recoveryEmail.sending") : t("recoveryEmail.send")}
        </Button>
      </div>
    </form>
  );
}
