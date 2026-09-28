"use client";

import { useState } from "react";
import { CheckCircle2 } from "lucide-react";

import { useTranslations } from "@/components/i18n/i18n-provider";
import { Button } from "@/components/ui/button";
import { confirmRecoveryEmailAction } from "@/lib/actions/auth";

export function VerifyRecoveryEmail({ token }: { token: string }) {
  const t = useTranslations("auth");
  const [pending, setPending] = useState(false);
  const [state, setState] = useState<"idle" | "done" | "EXPIRED" | "INVALID" | "RATE_LIMITED">(token ? "idle" : "INVALID");

  if (state === "done") {
    return (
      <div role="status" className="rounded-lg border border-line bg-surface-muted px-5 py-6 text-center">
        <div className="mx-auto mb-3 grid size-10 place-items-center rounded-full bg-success-soft text-success-strong">
          <CheckCircle2 className="size-5" aria-hidden />
        </div>
        <p className="text-card font-semibold text-fg">{t("verifyRecovery.doneTitle")}</p>
        <p className="mt-1 text-table text-fg-muted">{t("verifyRecovery.doneDescription")}</p>
      </div>
    );
  }

  const message = state === "EXPIRED" ? t("verifyRecovery.expired") : state === "INVALID" ? t("verifyRecovery.invalid") : state === "RATE_LIMITED" ? t("verifyRecovery.rateLimited") : null;

  return (
    <div className="space-y-4">
      {message ? <p role="alert" className="rounded-md border border-danger/30 bg-danger-soft px-4 py-3 text-table text-danger-strong">{message}</p> : null}
      {state === "idle" || state === "RATE_LIMITED" ? (
        <Button
          className="w-full"
          disabled={pending}
          onClick={async () => {
            setPending(true);
            try {
              const result = await confirmRecoveryEmailAction(token);
              setState(result.ok ? "done" : result.reason);
            } finally {
              setPending(false);
            }
          }}
        >
          {pending ? t("verifyRecovery.confirming") : t("verifyRecovery.confirm")}
        </Button>
      ) : null}
    </div>
  );
}
