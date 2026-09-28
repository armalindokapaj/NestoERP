"use client";

import * as React from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useMiscTranslations } from "@/components/activity/misc-text";
import { acceptInviteAction } from "@/lib/actions/team";
import type { Translate } from "@/lib/i18n/translator";

/**
 * Set up an account from an invitation (PRD #14 §74, §77).
 *
 * The email is fixed by the token and is shown read-only: the invitation is
 * bound to that address, and letting somebody retype it would be inviting a
 * mismatch the server then has to refuse (PRD #14 §76).
 */
const formSchema = (m: Translate<"misc">) =>
  z
    .object({
      firstName: z.string().trim().min(1, m("invite.firstNameRequired")).max(120),
      lastName: z.string().trim().min(1, m("invite.lastNameRequired")).max(120),
      password: z.string().min(12, m("invite.passwordLength")),
      confirmPassword: z.string().min(1, m("invite.confirmRequired")),
    })
    .refine((values) => values.password === values.confirmPassword, {
      message: m("invite.passwordsMatch"),
      path: ["confirmPassword"],
    });

type FormValues = z.infer<ReturnType<typeof formSchema>>;

export function AcceptInviteForm({ token, email }: { token: string; email: string }) {
  const m = useMiscTranslations();
  const schema = React.useMemo(() => formSchema(m), [m]);
  const [error, setError] = React.useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { firstName: "", lastName: "", password: "", confirmPassword: "" },
  });

  return (
    <form
      noValidate
      className="space-y-4"
      onSubmit={handleSubmit(async (values) => {
        setError(null);
        const formData = new FormData();
        formData.set("token", token);
        for (const [key, value] of Object.entries(values)) formData.set(key, value);

        // On success the action signs the person in and redirects, so anything
        // that comes back is a failure.
        const result = await acceptInviteAction(formData);
        if (result && !result.ok) setError(result.error);
      })}
    >
      {error ? (
        <p
          role="alert"
          className="rounded-md border border-danger/30 bg-danger-soft px-4 py-3 text-table text-danger-strong"
        >
          {error}
        </p>
      ) : null}

      <div className="space-y-1.5">
        <Label htmlFor="invite-email">{m("invite.email")}</Label>
        <Input id="invite-email" value={email} readOnly disabled />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="firstName">{m("invite.firstName")}</Label>
          <Input id="firstName" autoComplete="given-name" {...register("firstName")} />
          {errors.firstName ? (
            <p className="text-meta text-danger-strong">{errors.firstName.message}</p>
          ) : null}
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="lastName">{m("invite.lastName")}</Label>
          <Input id="lastName" autoComplete="family-name" {...register("lastName")} />
          {errors.lastName ? (
            <p className="text-meta text-danger-strong">{errors.lastName.message}</p>
          ) : null}
        </div>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="password">{m("invite.password")}</Label>
        <Input
          id="password"
          type="password"
          autoComplete="new-password"
          {...register("password")}
        />
        {errors.password ? (
          <p className="text-meta text-danger-strong">{errors.password.message}</p>
        ) : (
          <p className="text-meta text-fg-subtle">{m("invite.passwordHint")}</p>
        )}
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="confirmPassword">{m("invite.confirmPassword")}</Label>
        <Input
          id="confirmPassword"
          type="password"
          autoComplete="new-password"
          {...register("confirmPassword")}
        />
        {errors.confirmPassword ? (
          <p className="text-meta text-danger-strong">{errors.confirmPassword.message}</p>
        ) : null}
      </div>

      <Button type="submit" className="w-full" disabled={isSubmitting}>
        {isSubmitting ? m("invite.creating") : m("invite.accept")}
      </Button>
    </form>
  );
}
