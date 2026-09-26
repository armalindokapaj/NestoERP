"use client";

import * as React from "react";
import { useRouter } from "@/components/navigation/guarded-router";

import { useTranslations } from "@/components/i18n/i18n-provider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/components/ui/toast";
import { useUnsavedEditor } from "@/components/unsaved/use-unsaved";
import { updateProfileAction } from "@/lib/actions/account";
import type { SaveOutcome } from "@/lib/unsaved/coordinator";
import { OUTCOME_COPY } from "@/lib/unsaved/outcome";

type ErrorKey = Parameters<ReturnType<typeof useTranslations<"settings">>>[0];

/**
 * The editable half of Profile (PRD #38 §20): the person's own name and phone.
 *
 * The username is shown and never editable — it is what the account signs in
 * with, and an identifier that can be changed by its holder is one that cannot
 * be relied on in an audit trail (PRD #50 §6, §63). Email is contact metadata
 * and may be absent entirely (§67).
 *
 * Dirty against the saved values (AUD-03 §3); "Save and continue" runs this
 * same save, and only its explicit success moves the baseline.
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
  const [baseline, setBaseline] = React.useState(() => ({
    firstName: initial.firstName,
    lastName: initial.lastName,
    phone: initial.phone ?? "",
  }));
  const [values, setValues] = React.useState(baseline);
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [pending, setPending] = React.useState(false);
  const [unknown, setUnknown] = React.useState(false);
  const running = React.useRef(false);
  const editor = useUnsavedEditor({ module: "settings", saveKind: "save", label: t("profile.details"), save: () => save() });
  const { setDirty, setSaving, setUnresolved } = editor;
  const dirty = values.firstName !== baseline.firstName || values.lastName !== baseline.lastName || values.phone !== baseline.phone;
  React.useEffect(() => setDirty(dirty), [dirty, setDirty]);

  const errorText = (code: string | undefined) =>
    code ? t(`profile.errors.${code}` as ErrorKey) : undefined;

  async function save(): Promise<SaveOutcome> {
    if (running.current) return { kind: "unknown" };
    running.current = true;
    const submitted = values;
    setPending(true);
    setSaving(true);
    setUnknown(false);
    let result: Awaited<ReturnType<typeof updateProfileAction>>;
    try {
      result = await updateProfileAction(submitted);
    } catch {
      // No answer: it may have saved. Say so, keep the values (§6).
      setUnresolved(true);
      setUnknown(true);
      return { kind: "unknown" };
    } finally {
      running.current = false;
      setPending(false);
      setSaving(false);
    }
    setUnresolved(false);
    if (result.ok) {
      setErrors({});
      // The fields were read-only while it saved: what was sent is what they hold.
      setBaseline(submitted);
      setDirty(false);
      toast({ title: t("profile.saved"), tone: "success" });
      router.refresh();
      return { kind: "committed" };
    }
    setErrors(result.fieldErrors ?? {});
    toast({ title: errorText(result.code) ?? result.code, tone: "danger" });
    return { kind: result.code === "SAVE_FAILED" ? "failed" : result.code === "VALIDATION" ? "invalid" : "refused" };
  }

  function submit(event: React.FormEvent) {
    event.preventDefault();
    void save();
  }

  const field = (id: "firstName" | "lastName" | "phone", label: string, autoComplete: string) => (
    <div className="space-y-1.5">
      <Label htmlFor={`profile-${id}`}>{label}</Label>
      <Input
        id={`profile-${id}`}
        name={id}
        autoComplete={autoComplete}
        value={values[id]}
        readOnly={pending}
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
      {unknown ? (
        <p role="alert" className="text-meta text-danger-strong">
          {OUTCOME_COPY.unknown}
        </p>
      ) : null}
      <div className="flex justify-end">
        <Button type="submit" disabled={pending}>
          {pending ? t("profile.saving") : t("profile.save")}
        </Button>
      </div>
    </form>
  );
}
