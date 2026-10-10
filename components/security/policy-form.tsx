"use client";

import * as React from "react";
import { useRouter } from "@/components/navigation/guarded-router";

import { useTranslations } from "@/components/i18n/i18n-provider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/toast";
import { APP_LOCK_TIMEOUT_OPTIONS, PROTECTABLE_MODULES, type MobilePolicySettings } from "@/lib/core/security/mobile-policy.schema";
import { useReauth } from "./use-reauth";
import { FormSelect } from "@/components/ui/form-select";

type Target = { scope: "PARENT_GROUP" | "COMPANY"; id: string } | { scope: "PLATFORM"; id: "platform" };

const selectClass = "h-10 w-full rounded-md border border-control bg-surface px-3 text-body text-fg touch:h-11 disabled:opacity-60";

/**
 * One level of the mobile policy (MOB-11 §73, §74, §79). Every value can be left
 * on "Inherit" — a level stores only what it sets — and the server refuses a
 * value weaker than a higher level requires, so what is saved is what applies.
 */
export function PolicyForm({ target, initial, editable, isGroup }: { target: Target; initial: MobilePolicySettings; editable: boolean; isGroup: boolean }) {
  const t = useTranslations("security");
  const router = useRouter();
  const toast = useToast();
  const platform = target.scope === "PLATFORM";
  const { ensure, dialog } = useReauth(platform ? "/api/platform-admin/reauthenticate" : undefined);
  const [reason, setReason] = React.useState("");
  const [values, setValues] = React.useState<MobilePolicySettings>(initial);
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [pending, startTransition] = React.useTransition();

  const set = <K extends keyof MobilePolicySettings>(key: K, value: MobilePolicySettings[K] | undefined) => setValues((current) => {
    const next = { ...current };
    if (value === undefined) delete next[key];
    else next[key] = value;
    return next;
  });

  const tri = (key: "appLockRequired" | "biometricRequired" | "offlineAllowed" | "documentExportAllowed" | "nativeShareAllowed" | "externalOpenAllowed" | "sensitiveScreenProtection" | "allowCompanyOverride") => (
    <Field id={`${target.id}-${key}`} label={t(`admin.policy.fields.${key}`)} error={errors[key]}>
      <FormSelect id={`${target.id}-${key}`} className={selectClass} disabled={!editable} value={values[key] === undefined ? "" : values[key] ? "1" : "0"} onChange={(e) => set(key, e.target.value === "" ? undefined : e.target.value === "1")}>
        <option value="">{t("admin.policy.options.inherit")}</option>
        <option value="1">{t("admin.policy.options.yes")}</option>
        <option value="0">{t("admin.policy.options.no")}</option>
      </FormSelect>
    </Field>
  );
  const number = (key: "offlineAuthorizationHours" | "recentAuthMinutes", min: number, max: number) => (
    <Field id={`${target.id}-${key}`} label={t(`admin.policy.fields.${key}`)} error={errors[key]}>
      <Input id={`${target.id}-${key}`} type="number" min={min} max={max} disabled={!editable} placeholder={t("admin.policy.options.inherit")} value={values[key] ?? ""} onChange={(e) => set(key, e.target.value === "" ? undefined : Number(e.target.value))} />
    </Field>
  );
  const version = (key: "minimumAppVersion" | "minimumSecureVersion" | "recommendedAppVersion") => (
    <Field id={`${target.id}-${key}`} label={t(`admin.policy.fields.${key}`)} error={errors[key]}>
      <Input id={`${target.id}-${key}`} inputMode="numeric" pattern="\d+\.\d+\.\d+" disabled={!editable} placeholder="1.4.0" value={values[key] ?? ""} onChange={(e) => set(key, e.target.value.trim() === "" ? undefined : e.target.value.trim())} />
    </Field>
  );

  function save() {
    startTransition(async () => {
      if (!(await ensure())) return;
      setErrors({});
      try {
        const response = platform
          ? await fetch("/api/platform-admin/command", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "mobilePolicy.save", settings: values, reason }) })
          : await fetch("/api/security/policy", { method: "PUT", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify({ target, settings: values }) });
        const body = (await response.json().catch(() => null)) as { data?: { devicesUpdated: number }; error?: { code?: string; details?: Record<string, string[]> } } | null;
        if (!response.ok) {
          if (body?.error?.details && response.status === 422) {
            setErrors(Object.fromEntries(Object.keys(body.error.details).map((key) => [key.split(".")[0]!, t("admin.policy.errors.weaker")])));
          }
          toast({ title: body?.error?.code === "CONFLICT" ? t("admin.policy.errors.locked") : t("admin.policy.errors.SAVE_FAILED"), tone: "danger" });
          return;
        }
        toast({ title: t("admin.policy.saved", { count: body?.data?.devicesUpdated ?? 0 }), tone: "success" });
        router.refresh();
      } catch {
        toast({ title: t("admin.policy.errors.SAVE_FAILED"), tone: "danger" });
      }
    });
  }

  const blocked = (values.blockedBuilds ?? []).join("\n");

  return (
    <form onSubmit={(event) => { event.preventDefault(); if (editable) save(); }} className="space-y-6" data-testid={`policy-form-${target.scope.toLowerCase()}`}>
      <Section title={t("admin.policy.sections.authentication")}>{tri("biometricRequired")}</Section>
      <Section title={t("admin.policy.sections.appLock")}>
        {tri("appLockRequired")}
        <Field id={`${target.id}-timeout`} label={t("admin.policy.fields.appLockTimeoutSeconds")} error={errors.appLockTimeoutSeconds}>
          <FormSelect id={`${target.id}-timeout`} className={selectClass} disabled={!editable} value={values.appLockTimeoutSeconds === undefined ? "" : String(values.appLockTimeoutSeconds)} onChange={(e) => set("appLockTimeoutSeconds", e.target.value === "" ? undefined : Number(e.target.value))}>
            <option value="">{t("admin.policy.options.inherit")}</option>
            {APP_LOCK_TIMEOUT_OPTIONS.map((seconds) => <option key={seconds} value={seconds}>{t(`admin.policy.options.timeout.t${seconds}`)}</option>)}
          </FormSelect>
        </Field>
      </Section>
      <Section title={t("admin.policy.sections.offline")}>
        {tri("offlineAllowed")}
        {number("offlineAuthorizationHours", 1, 336)}
      </Section>
      <Section title={t("admin.policy.sections.devices")}>
        <Field id={`${target.id}-risk`} label={t("admin.policy.fields.deviceRiskPolicy")} error={errors.deviceRiskPolicy} hint={t("admin.policy.hints.risk")}>
          <FormSelect id={`${target.id}-risk`} className={selectClass} disabled={!editable} value={values.deviceRiskPolicy ?? ""} onChange={(e) => set("deviceRiskPolicy", e.target.value === "" ? undefined : (e.target.value as "ALLOW"))}>
            <option value="">{t("admin.policy.options.inherit")}</option>
            {(["ALLOW", "WARN", "BLOCK"] as const).map((value) => <option key={value} value={value}>{t(`admin.policy.options.risk.${value}`)}</option>)}
          </FormSelect>
        </Field>
        <Field id={`${target.id}-os-ios`} label={t("admin.policy.fields.minimumOsVersionIos")} error={errors.minimumOsVersion}>
          <Input id={`${target.id}-os-ios`} inputMode="decimal" disabled={!editable} placeholder="17" value={values.minimumOsVersion?.ios ?? ""} onChange={(e) => set("minimumOsVersion", { ...values.minimumOsVersion, ios: e.target.value.trim() || undefined })} />
        </Field>
        <Field id={`${target.id}-os-android`} label={t("admin.policy.fields.minimumOsVersionAndroid")} error={errors.minimumOsVersion}>
          <Input id={`${target.id}-os-android`} inputMode="decimal" disabled={!editable} placeholder="13" value={values.minimumOsVersion?.android ?? ""} onChange={(e) => set("minimumOsVersion", { ...values.minimumOsVersion, android: e.target.value.trim() || undefined })} />
        </Field>
      </Section>
      <Section title={t("admin.policy.sections.downloads")}>
        {tri("documentExportAllowed")}
        {tri("nativeShareAllowed")}
        {tri("externalOpenAllowed")}
      </Section>
      <Section title={t("admin.policy.sections.versions")}>
        {version("minimumAppVersion")}
        {version("minimumSecureVersion")}
        {version("recommendedAppVersion")}
        <Field id={`${target.id}-blocked`} label={t("admin.policy.fields.blockedBuilds")} error={errors.blockedBuilds}>
          <Textarea id={`${target.id}-blocked`} disabled={!editable} value={blocked} onChange={(e) => { const list = e.target.value.split("\n").map((line) => line.trim()).filter(Boolean); set("blockedBuilds", list.length ? list : undefined); }} />
        </Field>
      </Section>
      <Section title={t("admin.policy.sections.compliance")}>
        <Field id={`${target.id}-preview`} label={t("admin.policy.fields.notificationPreviewPolicy")} error={errors.notificationPreviewPolicy}>
          <FormSelect id={`${target.id}-preview`} className={selectClass} disabled={!editable} value={values.notificationPreviewPolicy ?? ""} onChange={(e) => set("notificationPreviewPolicy", e.target.value === "" ? undefined : (e.target.value as "FULL"))}>
            <option value="">{t("admin.policy.options.inherit")}</option>
            {(["FULL", "LIMITED", "HIDDEN"] as const).map((value) => <option key={value} value={value}>{t(`admin.policy.options.preview.${value}`)}</option>)}
          </FormSelect>
        </Field>
      </Section>
      <Section title={t("admin.policy.sections.data")}>
        {tri("sensitiveScreenProtection")}
        <fieldset className="space-y-1.5">
          <legend className="text-meta text-fg-subtle">{t("admin.policy.fields.protectedModules")}</legend>
          <div className="flex flex-wrap gap-4">
            {PROTECTABLE_MODULES.map((module) => (
              <label key={module} className="flex items-center gap-2 text-table">
                <input type="checkbox" disabled={!editable} checked={values.protectedModules?.includes(module) ?? false} onChange={(e) => {
                  const current = new Set(values.protectedModules ?? []);
                  if (e.target.checked) current.add(module); else current.delete(module);
                  set("protectedModules", current.size ? [...current] : undefined);
                }} />
                {t(`admin.policy.options.modules.${module}`)}
              </label>
            ))}
          </div>
          <p className="text-micro text-fg-subtle">{t("admin.policy.hints.protect")}</p>
        </fieldset>
        {number("recentAuthMinutes", 1, 240)}
        {isGroup ? tri("allowCompanyOverride") : null}
      </Section>
      <p className="text-micro text-fg-subtle">{t("admin.policy.hints.inherit")}</p>
      {editable && platform ? (
        <Field id="platform-policy-reason" label={t("admin.devices.reason")}>
          <Input id="platform-policy-reason" value={reason} minLength={3} maxLength={500} onChange={(event) => setReason(event.target.value)} />
        </Field>
      ) : null}
      {editable ? <Button type="submit" disabled={pending || (platform && reason.trim().length < 3)}>{t("admin.policy.save")}</Button> : <p className="text-meta text-fg-subtle">{t("admin.policy.readOnly")}</p>}
      {dialog}
    </form>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <fieldset className="space-y-3">
      <legend className="text-table font-semibold text-fg">{title}</legend>
      <div className="grid gap-3 sm:grid-cols-2">{children}</div>
    </fieldset>
  );
}

function Field({ id, label, hint, error, children }: { id: string; label: string; hint?: string; error?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="text-meta text-fg-subtle">{label}</label>
      {children}
      {hint ? <p className="text-micro text-fg-subtle">{hint}</p> : null}
      {error ? <p role="alert" className="text-meta text-danger-strong">{error}</p> : null}
    </div>
  );
}
