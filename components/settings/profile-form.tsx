"use client";

import * as React from "react";
import { useRouter } from "next/navigation";

import { useTranslations } from "@/components/i18n/i18n-provider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/components/ui/toast";
import { updateProfileAction } from "@/lib/actions/account";

type ErrorKey = Parameters<ReturnType<typeof useTranslations<"settings">>>[0];

/**
 * The editable half of Profile (PRD #38 §20): the person's own name and phone.
 *
 * The username is shown and never editable — it is what the account signs in
 * with, and an identifier that can be changed by its holder is one that cannot
 * be relied on in an audit trail (PRD #50 §6, §63). Email is contact metadata
 * and may be absent entirely (§67).
 */
export function ProfileForm({
  initial,
  username,
  email,
}: {
  initial: { firstName: string; lastName: string; phone: string | null };
  username: string;
  email: string | null;
}) {
  const t = useTranslations("settings");
  const router = useRouter();
  const toast = useToast();
  const [values, setValues] = React.useState({
    firstName: initial.firstName,
    lastName: initial.lastName,
    phone: initial.phone ?? "",
  });
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [pending, startTransition] = React.useTransition();

  const errorText = (code: string | undefined) =>
    code ? t(`profile.errors.${code}` as ErrorKey) : undefined;

  function submit(event: React.FormEvent) {
    event.preventDefault();
    startTransition(async () => {
      const result = await updateProfileAction(values);
      if (result.ok) {
        setErrors({});
        toast({ title: t("profile.saved"), tone: "success" });
        router.refresh();
      } else {
        setErrors(result.fieldErrors ?? {});
        toast({ title: errorText(result.code) ?? result.code, tone: "danger" });
      }
    });
  }

  const field = (id: "firstName" | "lastName" | "phone", label: string, autoComplete: string) => (
    <div className="space-y-1.5">
      <Label htmlFor={`profile-${id}`}>{label}</Label>
      <Input
        id={`profile-${id}`}
        name={id}
        autoComplete={autoComplete}
        value={values[id]}
        onChange={(event) => setValues((current) => ({ ...current, [id]: event.target.value }))}
        aria-invalid={Boolean(errors[id])}
        aria-describedby={errors[id] ? `profile-${id}-error` : undefined}
      />
      {errors[id] ? (
        <p id={`profile-${id}-error`} className="text-meta text-danger-strong">
          {errorText(errors[id])}
        </p>
      ) : null}
    </div>
  );

  return (
    <form onSubmit={submit} noValidate className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        {field("firstName", t("profile.firstName"), "given-name")}
        {field("lastName", t("profile.lastName"), "family-name")}
        <div className="space-y-1.5">
          <Label htmlFor="profile-username">{t("profile.username")}</Label>
          <Input id="profile-username" value={username} readOnly disabled aria-describedby="profile-username-hint" />
          <p id="profile-username-hint" className="text-meta text-fg-subtle">
            {t("profile.usernameHint")}
          </p>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="profile-email">{t("profile.email")}</Label>
          <Input id="profile-email" value={email ?? ""} placeholder="—" readOnly disabled />
        </div>
        {field("phone", t("profile.phone"), "tel")}
      </div>
      <div className="flex justify-end">
        <Button type="submit" disabled={pending}>
          {pending ? t("profile.saving") : t("profile.save")}
        </Button>
      </div>
    </form>
  );
}
