"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { MailCheck } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { requestPasswordResetAction } from "@/lib/actions/auth";
import { forgotPasswordSchema, type ForgotPasswordInput } from "@/lib/auth/schema";

/**
 * Password recovery (PRD #6 §55, §95).
 *
 * The confirmation is identical whether or not the address exists, so this page
 * cannot be used to enumerate accounts. V0.1 has no configured mail provider:
 * the reset link is written to the server log by the default transport, which
 * is also what the tests read.
 */
export function ForgotPasswordForm() {
  const [submitted, setSubmitted] = useState(false);

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
        <p className="text-card font-semibold text-fg">Check your email</p>
        <p className="mt-1 text-table text-fg-muted">
          If an account exists for that address, a reset link is on its way.
        </p>
        <p className="mt-3 text-meta text-fg-subtle">
          No mail provider is configured in V0.1 — the link is written to the
          server log instead of being sent.
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit(async (values) => {
        await requestPasswordResetAction(values.email);
        setSubmitted(true);
      })} className="space-y-4" noValidate>
      <div className="space-y-1.5">
        <Label htmlFor="email">Email</Label>
        <Input
          id="email"
          type="email"
          autoComplete="email"
          autoFocus
          placeholder="you@company.com"
          aria-invalid={Boolean(errors.email)}
          {...register("email")}
        />
        {errors.email ? (
          <p className="text-meta text-danger-strong">{errors.email.message}</p>
        ) : null}
      </div>

      <Button type="submit" size="lg" className="w-full" disabled={isSubmitting}>
        Send reset link
      </Button>
    </form>
  );
}
