"use client";

import { useState } from "react";
import Link from "next/link";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { CheckCircle2 } from "lucide-react";
import { z } from "zod";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { resetPasswordAction } from "@/lib/actions/auth";

/**
 * Choose a new password (PRD #6 §56, §96).
 *
 * The four states the PRD asks for are all reachable here: valid token,
 * expired/invalid token, submitting, and success.
 */
const formSchema = z
  .object({
    password: z.string().min(10, "Use at least 10 characters"),
    confirmPassword: z.string().min(1, "Confirm your new password"),
  })
  .refine((values) => values.password === values.confirmPassword, {
    message: "Both passwords must match",
    path: ["confirmPassword"],
  });

type FormValues = z.infer<typeof formSchema>;

export function ResetPasswordForm({ token }: { token: string }) {
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: { password: "", confirmPassword: "" },
  });

  if (done) {
    return (
      <div className="rounded-lg border border-line bg-surface-muted px-5 py-6 text-center">
        <div className="mx-auto mb-3 grid size-10 place-items-center rounded-full bg-success-soft text-success-strong">
          <CheckCircle2 className="size-5" />
        </div>
        <p className="text-card font-semibold text-fg">Password updated successfully.</p>
        <p className="mt-1 text-table text-fg-muted">
          Any other sessions have been signed out.
        </p>
        <Button asChild className="mt-4">
          <Link href="/login">Sign in</Link>
        </Button>
      </div>
    );
  }

  return (
    <form
      noValidate
      className="space-y-4"
      onSubmit={handleSubmit(async (values) => {
        setError(null);
        const result = await resetPasswordAction({ token, ...values });
        if (result.ok) setDone(true);
        else setError(result.error);
      })}
    >
      {error ? (
        <p
          role="alert"
          className="rounded-md border border-danger/30 bg-danger-soft px-4 py-3 text-table text-danger-strong"
        >
          {error}{" "}
          <Link href="/forgot-password" className="underline underline-offset-2">
            Request a new link
          </Link>
          .
        </p>
      ) : null}

      <div className="space-y-1.5">
        <Label htmlFor="password">New password</Label>
        <Input
          id="password"
          type="password"
          autoComplete="new-password"
          autoFocus
          aria-invalid={Boolean(errors.password)}
          aria-describedby={errors.password ? "password-error" : undefined}
          {...register("password")}
        />
        {errors.password ? (
          <p id="password-error" className="text-meta text-danger-strong">
            {errors.password.message}
          </p>
        ) : (
          <p className="text-meta text-fg-subtle">At least 10 characters.</p>
        )}
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="confirmPassword">Confirm password</Label>
        <Input
          id="confirmPassword"
          type="password"
          autoComplete="new-password"
          aria-invalid={Boolean(errors.confirmPassword)}
          aria-describedby={errors.confirmPassword ? "confirmPassword-error" : undefined}
          {...register("confirmPassword")}
        />
        {errors.confirmPassword ? (
          <p id="confirmPassword-error" className="text-meta text-danger-strong">
            {errors.confirmPassword.message}
          </p>
        ) : null}
      </div>

      <Button type="submit" className="w-full" disabled={isSubmitting}>
        {isSubmitting ? "Updating…" : "Reset password"}
      </Button>
    </form>
  );
}
