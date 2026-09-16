"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { TriangleAlert } from "lucide-react";

import { useTranslations } from "@/components/i18n/i18n-provider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { signInAction } from "@/lib/actions/auth";
import { credentialsSchema, type CredentialsInput } from "@/lib/auth/schema";
import { translateAuthError } from "@/lib/i18n/auth-errors";

export function LoginForm({ callbackUrl }: { callbackUrl?: string }) {
  const [formError, setFormError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const t = useTranslations("auth");

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<CredentialsInput>({
    resolver: zodResolver(credentialsSchema),
    defaultValues: { username: "", password: "" },
  });

  const onSubmit = handleSubmit((values) => {
    setFormError(null);
    startTransition(async () => {
      // A successful sign-in redirects, so anything returned is a failure.
      const result = await signInAction({ ...values, callbackUrl });
      if (result?.error) setFormError(result.error);
    });
  });

  return (
    <form onSubmit={onSubmit} className="space-y-4" noValidate>
      {formError ? (
        <div
          role="alert"
          className="flex items-start gap-2 rounded-md border border-danger/25 bg-danger-soft px-3 py-2.5 text-table text-danger-strong"
        >
          <TriangleAlert className="mt-0.5 size-4 shrink-0" />
          <span>{translateAuthError(t, formError)}</span>
        </div>
      ) : null}

      <div className="space-y-1.5">
        <Label htmlFor="username">{t("username")}</Label>
        <Input
          id="username"
          type="text"
          autoComplete="username"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          autoFocus
          placeholder={t("usernamePlaceholder")}
          aria-invalid={Boolean(errors.username)}
          {...register("username")}
        />
        {errors.username ? (
          <p className="text-meta text-danger-strong">
            {translateAuthError(t, errors.username.message ?? "")}
          </p>
        ) : null}
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="password">{t("login.password")}</Label>
        <Input
          id="password"
          type="password"
          autoComplete="current-password"
          placeholder="••••••••"
          aria-invalid={Boolean(errors.password)}
          {...register("password")}
        />
        {errors.password ? (
          <p className="text-meta text-danger-strong">
            {translateAuthError(t, errors.password.message ?? "")}
          </p>
        ) : null}
      </div>

      <Button type="submit" size="lg" className="w-full" disabled={isPending}>
        {isPending ? t("login.submitting") : t("login.submit")}
      </Button>

      <div className="text-center">
        <Link
          href="/forgot-password"
          className="text-table text-fg-muted underline-offset-4 transition-colors hover:text-fg hover:underline"
        >
          {t("login.forgotPassword")}
        </Link>
      </div>
    </form>
  );
}
