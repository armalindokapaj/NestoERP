"use client";

import * as React from "react";
import { useRouter } from "@/components/navigation/guarded-router";

import { useTranslations } from "@/components/i18n/i18n-provider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/components/ui/toast";
import { useUnsavedEditor } from "@/components/unsaved/use-unsaved";
import { changePasswordAction } from "@/lib/actions/account";
import { OUTCOME_COPY } from "@/lib/unsaved/outcome";

type Key = Parameters<ReturnType<typeof useTranslations<"settings">>>[0];

const EMPTY = { currentPassword: "", newPassword: "", confirmPassword: "" };

/**
 * Changes the password after proving the current one (PRD #38 §20).
 *
 * Typed passwords are unsaved work (AUD-03 §3): leaving asks. They live in
 * this form's state and nowhere else — the coordinator holds only a flag and
 * the section title, never a value. Changing the password signs other sessions
 * out, so it is the form's own step: the prompt offers Stay or Discard only.
 */
export function PasswordForm() {
  const t = useTranslations("settings");
  const router = useRouter();
  const toast = useToast();
  const [values, setValues] = React.useState(EMPTY);
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [pending, setPending] = React.useState(false);
  const [unknown, setUnknown] = React.useState(false);
  const running = React.useRef(false);
  const editor = useUnsavedEditor({ module: "settings", saveKind: "none", workflow: t("profile.password.submit"), label: t("profile.password.title") });
  const { setDirty, setSaving, setUnresolved } = editor;
  const dirty = values.currentPassword !== "" || values.newPassword !== "" || values.confirmPassword !== "";
  React.useEffect(() => setDirty(dirty), [dirty, setDirty]);

  function submit(event: React.FormEvent) {
    event.preventDefault();
    if (running.current) return;
    running.current = true;
    setPending(true);
    setSaving(true);
    setUnknown(false);
    void (async () => {
      let result: Awaited<ReturnType<typeof changePasswordAction>>;
      try {
        result = await changePasswordAction(values);
      } catch {
        // No answer: the password may or may not have changed (§6).
        setUnresolved(true);
        setUnknown(true);
        return;
      } finally {
        running.current = false;
        setPending(false);
        setSaving(false);
      }
      setUnresolved(false);
      if (result.ok) {
        setDirty(false);
        setValues(EMPTY);
        setErrors({});
        toast({ title: t("profile.password.changed", { count: result.revokedSessions ?? 0 }), tone: "success" });
        router.refresh();
        return;
      }
      const fieldErrors =
        result.code === "CURRENT_PASSWORD_INCORRECT"
          ? { currentPassword: result.code }
          : (result.fieldErrors ?? {});
      setErrors(fieldErrors);
      if (result.code !== "VALIDATION" && result.code !== "CURRENT_PASSWORD_INCORRECT") {
        toast({ title: t(`profile.errors.${result.code}` as Key), tone: "danger" });
      }
    })();
  }

  const field = (
    id: keyof typeof EMPTY,
    label: string,
    autoComplete: "current-password" | "new-password",
    hint?: string,
  ) => (
    <div className="space-y-1.5">
      <Label htmlFor={`password-${id}`}>{label}</Label>
      <Input
        id={`password-${id}`}
        name={id}
        type="password"
        autoComplete={autoComplete}
        value={values[id]}
        readOnly={pending}
        onChange={(event) => setValues((current) => ({ ...current, [id]: event.target.value }))}
        aria-invalid={Boolean(errors[id])}
        aria-describedby={errors[id] ? `password-${id}-error` : hint ? `password-${id}-hint` : undefined}
      />
      {errors[id] ? (
        <p id={`password-${id}-error`} role="alert" className="text-meta text-danger-strong">
          {t(`profile.errors.${errors[id]}` as Key)}
        </p>
      ) : hint ? (
        <p id={`password-${id}-hint`} className="text-meta text-fg-subtle">
          {hint}
        </p>
      ) : null}
    </div>
  );

  return (
    <form onSubmit={submit} noValidate className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-3">
        {field("currentPassword", t("profile.password.current"), "current-password")}
        {field("newPassword", t("profile.password.new"), "new-password", t("profile.password.newHint"))}
        {field("confirmPassword", t("profile.password.confirm"), "new-password")}
      </div>
      {unknown ? (
        <p role="alert" className="text-meta text-danger-strong">
          {OUTCOME_COPY.unknown}
        </p>
      ) : null}
      <div className="flex justify-end">
        <Button type="submit" variant="secondary" disabled={pending}>
          {pending ? t("profile.password.submitting") : t("profile.password.submit")}
        </Button>
      </div>
    </form>
  );
}
