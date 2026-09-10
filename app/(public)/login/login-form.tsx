"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { TriangleAlert } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { signInAction } from "@/lib/actions/auth";
import { credentialsSchema, type CredentialsInput } from "@/lib/auth/schema";

export function LoginForm({ callbackUrl }: { callbackUrl?: string }) {
  const [formError, setFormError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<CredentialsInput>({
    resolver: zodResolver(credentialsSchema),
    defaultValues: { email: "", password: "" },
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
          <span>{formError}</span>
        </div>
      ) : null}

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

      <div className="space-y-1.5">
        <Label htmlFor="password">Password</Label>
        <Input
          id="password"
          type="password"
          autoComplete="current-password"
          placeholder="••••••••"
          aria-invalid={Boolean(errors.password)}
          {...register("password")}
        />
        {errors.password ? (
          <p className="text-meta text-danger-strong">{errors.password.message}</p>
        ) : null}
      </div>

      <Button type="submit" size="lg" className="w-full" disabled={isPending}>
        {isPending ? "Signing in…" : "Sign In"}
      </Button>

      <div className="text-center">
        <Link
          href="/forgot-password"
          className="text-table text-fg-muted underline-offset-4 transition-colors hover:text-fg hover:underline"
        >
          Forgot password?
        </Link>
      </div>
    </form>
  );
}
