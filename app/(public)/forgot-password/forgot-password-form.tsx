"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { MailCheck } from "lucide-react";

import { useTranslations } from "@/components/i18n/i18n-provider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { requestPasswordResetAction } from "@/lib/actions/auth";
import { forgotPasswordSchema, type ForgotPasswordInput } from "@/lib/auth/schema";
import { translateAuthError } from "@/lib/i18n/auth-errors";

/**
 * Password recovery (PRD #6 §55, §95).
 *
 * The confirmation is identical whether or not the address exists, so this page
 * cannot be used to enumerate accounts — including by timing, because the
 * message is sent after the response (PRD #38 §16).
 */
export function ForgotPasswordForm() {
  const [submitted, setSubmitted] = useState(false);
  const t = useTranslations("auth");

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<ForgotPasswordInput>({
    resolver: zodResolver(forgotPasswordSchema),
    defaultValues: { email: "" },
  });

  if (submitted) {
    return (
      <div className="rounded-lg border border-line bg-surface-muted px-5 py-6 text-center">
        <div className="mx-auto mb-3 grid size-10 place-items-center rounded-full bg-success-soft text-success-strong">
          <MailCheck className="size-5" />
        </div>
        <p className="text-card font-semibold text-fg">{t("forgot.sentTitle")}</p>
        <p className="mt-1 text-table text-fg-muted">{t("forgot.sentDescription")}</p>
        <p className="mt-3 text-meta text-fg-subtle">{t("forgot.sentHint")}</p>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit(async (values) => {
        await requestPasswordResetAction(values.email);
        setSubmitted(true);
      })} className="space-y-4" noValidate>
      <div className="space-y-1.5">
        <Label htmlFor="email">{t("email")}</Label>
        <Input
          id="email"
          type="email"
          autoComplete="email"
          autoFocus
          placeholder={t("emailPlaceholder")}
          aria-invalid={Boolean(errors.email)}
          {...register("email")}
        />
        {errors.email ? (
          <p className="text-meta text-danger-strong">
            {translateAuthError(t, errors.email.message ?? "")}
          </p>
        ) : null}
      </div>

      <Button type="submit" size="lg" className="w-full" disabled={isSubmitting}>
        {t("forgot.submit")}
      </Button>
    </form>
  );
}
