"use client";

import { useState } from "react";
import { MailCheck } from "lucide-react";

import { useTranslations } from "@/components/i18n/i18n-provider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { requestPasswordResetAction } from "@/lib/actions/auth";

/**
 * The acknowledgement is the same whether or not the account exists, so this
 * form cannot enumerate accounts (ADM-01; OWASP Forgot Password).
 */
export function ForgotPasswordForm() {
  const t = useTranslations("auth");
  const [identifier, setIdentifier] = useState("");
  const [pending, setPending] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  if (submitted) {
    return (
      <div role="status" className="rounded-lg border border-line bg-surface-muted px-5 py-6 text-center">
        <div className="mx-auto mb-3 grid size-10 place-items-center rounded-full bg-success-soft text-success-strong">
          <MailCheck className="size-5" aria-hidden />
        </div>
        <p className="text-card font-semibold text-fg">{t("forgot.sentTitle")}</p>
        <p className="mt-1 text-table text-fg-muted">{t("forgot.sentDescription")}</p>
        <p className="mt-3 text-meta text-fg-subtle">{t("forgot.sentHint")}</p>
      </div>
    );
  }

  return (
    <form
      noValidate
      className="space-y-4"
      onSubmit={async (event) => {
        event.preventDefault();
        if (!identifier.trim() || pending) return;
        setPending(true);
        try {
          await requestPasswordResetAction(identifier);
        } finally {
          // The same acknowledgement whatever happened, a failed request included.
          setPending(false);
          setSubmitted(true);
        }
      }}
    >
      <div className="space-y-1.5">
        <Label htmlFor="identifier">{t("forgot.identifier")}</Label>
        <Input id="identifier" autoComplete="username" autoFocus required placeholder={t("forgot.identifierPlaceholder")} value={identifier} onChange={(event) => setIdentifier(event.target.value)} />
      </div>
      <Button type="submit" size="lg" className="w-full" disabled={pending || !identifier.trim()}>
        {t("forgot.submit")}
      </Button>
    </form>
  );
}
