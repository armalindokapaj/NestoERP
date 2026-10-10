"use client";

import * as React from "react";

import { useTranslations } from "@/components/i18n/i18n-provider";
import { adminModuleText } from "@/components/platform/admin-modules";
import { engineeringApi } from "@/components/engineering/engineering-api";
import { useRouter } from "@/components/navigation/guarded-router";
import { AdminStatusBadge } from "@/components/platform/admin-status-badge";
import { useUnsavedEditor } from "@/components/unsaved/use-unsaved";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/components/ui/toast";
import { FormSelect } from "@/components/ui/form-select";

type Mode = "INHERIT" | "ENABLED" | "DISABLED" | "TRIAL";
type ModuleRow = {
  key: string; name: string; description: string; state: string; entitled: boolean; inPlan: boolean; source: "core" | "plan" | "override";
  override: { mode: "ENABLED" | "DISABLED" | "TRIAL"; startsAt: string | null; endsAt: string | null } | null;
  switchedOn: boolean;
};
type Change = { mode: Mode; startsAt: string; endsAt: string };
type Preview = { disable: string[]; enable: string[]; keep: string[] };

const day = (iso: string | null) => (iso ? iso.slice(0, 10) : "");
const MODE_KEY = { INHERIT: "editor.mode.INHERIT", ENABLED: "editor.mode.ENABLED", DISABLED: "editor.mode.DISABLED", TRIAL: "editor.mode.TRIAL" } as const;

/**
 * A company's module entitlements, staged (Admin Modules PRD #4 §14-§23,
 * §27, §28, §61-§64): changes collect on the page, a review lists them, and
 * Apply sends them all in one request that the server applies atomically
 * against the version it was opened at. Leaving with staged changes asks
 * first.
 */
export function EntitlementEditor({ companyId, version, plan, plans, modules, canManage }: {
  companyId: string; version: number; plan: { id: string | null; name: string };
  plans: Array<{ value: string; label: string }>; modules: ModuleRow[]; canManage: boolean;
}) {
  const router = useRouter();
  const toast = useToast();
  const t = useTranslations("adminOrgs");
  const tm = useTranslations("modules");
  const modeLabel = (mode: Mode) => t(MODE_KEY[mode]);
  const [changes, setChanges] = React.useState<Record<string, Change>>({});
  const [planId, setPlanId] = React.useState<string | null>(plan.id);
  const [preview, setPreview] = React.useState<Preview | null>(null);
  const [review, setReview] = React.useState(false);
  const [reason, setReason] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [pending, setPending] = React.useState(false);
  const planChanged = planId !== plan.id;
  const count = Object.keys(changes).length + (planChanged ? 1 : 0);
  const editor = useUnsavedEditor({ module: "platform", saveKind: "none", workflow: t("editor.workflow"), label: t("editor.unsavedLabel") });
  React.useEffect(() => { editor.setDirty(count > 0); }, [count, editor]);

  React.useEffect(() => {
    if (!planChanged) { setPreview(null); return; }
    let live = true;
    void engineeringApi<Preview>("/api/platform-admin/command", { body: { action: "entitlements.preview", companyId, planId } }).then((value) => { if (live) setPreview(value); }, () => { if (live) setPreview(null); });
    return () => { live = false; };
  }, [planChanged, planId, companyId]);

  const current = (row: ModuleRow): Change => changes[row.key] ?? { mode: row.override?.mode ?? "INHERIT", startsAt: day(row.override?.startsAt ?? null), endsAt: day(row.override?.endsAt ?? null) };
  const stage = (row: ModuleRow, next: Change) => {
    const original: Change = { mode: row.override?.mode ?? "INHERIT", startsAt: day(row.override?.startsAt ?? null), endsAt: day(row.override?.endsAt ?? null) };
    setChanges((all) => {
      const copy = { ...all };
      if (next.mode === original.mode && next.startsAt === original.startsAt && next.endsAt === original.endsAt) delete copy[row.key];
      else copy[row.key] = next;
      return copy;
    });
  };

  async function apply() {
    setPending(true);
    setError(null);
    try {
      await engineeringApi("/api/platform-admin/command", {
        body: {
          action: "entitlements.apply", companyId, version, reason,
          ...(planChanged ? { planId } : {}),
          changes: Object.entries(changes).map(([moduleKey, change]) => ({ moduleKey, mode: change.mode, startsAt: change.startsAt || null, endsAt: change.endsAt || null })),
        },
      });
      editor.setDirty(false);
      setChanges({});
      setReview(false);
      setReason("");
      toast({ title: t("editor.toast"), tone: "success" });
      router.refresh();
    } catch (failure) {
      // Nothing was applied: the server takes all of it or none (§64, §79).
      setError(failure instanceof Error ? t("editor.failedWith", { message: failure.message }) : t("editor.failed"));
    } finally {
      setPending(false);
    }
  }

  const staged = modules.filter((row) => changes[row.key]);
  const selectClass = "h-8 cursor-pointer rounded-md border border-line bg-surface px-2 text-table text-fg disabled:cursor-not-allowed disabled:opacity-60";

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <label className="flex flex-col gap-1 text-meta text-fg-subtle">
          {t("editor.plan")}
          <FormSelect value={planId ?? ""} disabled={!canManage} onChange={(event) => setPlanId(event.target.value || null)} className={`${selectClass} h-9 min-w-56`} aria-label={t("editor.plan")}>
            {plans.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            <option value="">{t("editor.customOption")}</option>
          </FormSelect>
        </label>
        {canManage ? (
          <div className="flex items-center gap-2">
            {count ? <Button variant="secondary" size="sm" onClick={() => { setChanges({}); setPlanId(plan.id); }}>{t("editor.discard")}</Button> : null}
            <Button size="sm" disabled={count === 0} onClick={() => setReview(true)} data-testid="entitlements-review">{count ? t("editor.reviewCount", { count }) : t("editor.review")}</Button>
          </div>
        ) : null}
      </div>
      {planChanged && preview ? (
        <div className="nesto-card space-y-1 p-4 text-table" data-testid="plan-impact">
          <p className="font-medium text-fg">{t("editor.impactTitle", { from: plan.name, to: plans.find((option) => option.value === planId)?.label ?? t("editor.custom") })}</p>
          {preview.disable.length ? <p className="text-fg-muted"><span className="font-medium text-danger-strong">{t("editor.disable")}</span> {preview.disable.join(", ")}</p> : null}
          {preview.enable.length ? <p className="text-fg-muted"><span className="font-medium text-success-strong">{t("editor.enable")}</span> {preview.enable.join(", ")}</p> : null}
          <p className="text-fg-muted"><span className="font-medium">{t("editor.keep")}</span> {preview.keep.join(", ") || "—"}</p>
          <p className="text-meta text-fg-subtle">{t("editor.impactNote")}</p>
        </div>
      ) : null}

      <div className="nesto-card overflow-x-auto">
        <table className="w-full min-w-[640px] text-left text-table" aria-label={t("editor.tableLabel")}>
          <thead className="border-b border-line text-meta text-fg-subtle">
            <tr><th className="px-4 py-2.5 font-medium">{t("editor.module")}</th><th className="px-4 py-2.5 font-medium max-md:hidden">{t("editor.planDefault")}</th><th className="px-4 py-2.5 font-medium">{t("editor.entitlement")}</th><th className="px-4 py-2.5 font-medium">{t("editor.status")}</th></tr>
          </thead>
          <tbody className="divide-y divide-line">
            {modules.map((row) => {
              const value = current(row);
              const dirty = Boolean(changes[row.key]);
              return (
                <tr key={row.key} className={dirty ? "bg-accent-soft/40" : undefined} data-testid="entitlement-row" data-module={row.key}>
                  <td className="px-4 py-2.5">
                    <p className="font-medium text-fg">{adminModuleText(tm, row.key, "label", row.name)}</p>
                    <p className="max-w-md truncate text-meta text-fg-subtle max-lg:hidden">{adminModuleText(tm, row.key, "description", row.description)}</p>
                  </td>
                  <td className="px-4 py-2.5 text-fg-muted max-md:hidden">{row.source === "core" ? t("editor.required") : row.inPlan ? t("editor.included") : t("editor.notIncluded")}</td>
                  <td className="px-4 py-2.5">
                    {row.source === "core" ? (
                      <span className="text-fg-subtle">{t("editor.alwaysOn")}</span>
                    ) : (
                      <div className="flex flex-wrap items-center gap-2">
                        <FormSelect aria-label={t("editor.entitlementAria", { name: row.name })} disabled={!canManage} value={value.mode} onChange={(event) => stage(row, { ...value, mode: event.target.value as Mode, endsAt: event.target.value === "DISABLED" || event.target.value === "INHERIT" ? "" : value.endsAt, startsAt: event.target.value === "INHERIT" ? "" : value.startsAt })} className={selectClass}>
                          {(Object.keys(MODE_KEY) as Mode[]).map((mode) => <option key={mode} value={mode}>{modeLabel(mode)}</option>)}
                        </FormSelect>
                        {value.mode === "ENABLED" || value.mode === "TRIAL" ? (
                          <label className="flex items-center gap-1 text-meta text-fg-subtle">{t("editor.from")}<input type="date" disabled={!canManage} value={value.startsAt} onChange={(event) => stage(row, { ...value, startsAt: event.target.value })} className={selectClass} aria-label={t("editor.startsAria", { name: row.name })} /></label>
                        ) : null}
                        {value.mode === "TRIAL" ? (
                          <label className="flex items-center gap-1 text-meta text-fg-subtle">{t("editor.until")}<input type="date" required disabled={!canManage} value={value.endsAt} onChange={(event) => stage(row, { ...value, endsAt: event.target.value })} className={selectClass} aria-label={t("editor.trialEndsAria", { name: row.name })} /></label>
                        ) : null}
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-2.5">
                    <AdminStatusBadge status={row.state} />
                    {row.state === "Trial" && row.override?.endsAt ? <span className="ml-1 text-meta text-fg-subtle">{t("editor.untilDate", { date: new Date(row.override.endsAt).toLocaleDateString("en-GB") })}</span> : null}
                    {row.entitled && !row.switchedOn && row.source !== "core" ? <p className="text-meta text-fg-subtle">{t("editor.switchedOff")}</p> : null}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <Dialog open={review} onOpenChange={(open) => { if (!pending) setReview(open); }}>
        <DialogContent className="max-w-lg" data-testid="entitlements-review-dialog">
          <DialogTitle>{t("editor.dialogTitle")}</DialogTitle>
          <DialogDescription>{t("editor.dialogDescription")}</DialogDescription>
          <div className="mt-3 space-y-3 text-table">
            {planChanged ? <p><span className="font-medium">{t("editor.planChange")}</span> {plan.name} → {plans.find((option) => option.value === planId)?.label ?? t("editor.custom")}</p> : null}
            {staged.length ? (
              <ul className="space-y-1">
                {staged.map((row) => {
                  const change = changes[row.key];
                  const sign = change.mode === "DISABLED" ? "−" : change.mode === "INHERIT" ? "↺" : "+";
                  return <li key={row.key}><span className="font-mono">{sign}</span> {row.name}: {modeLabel(change.mode)}{change.mode === "TRIAL" && change.endsAt ? ` ${t("editor.untilDate", { date: change.endsAt })}` : ""}{change.startsAt && change.mode !== "INHERIT" ? ` ${t("editor.fromDate", { date: change.startsAt })}` : ""}</li>;
                })}
              </ul>
            ) : null}
            <label className="flex flex-col gap-1 text-meta text-fg-subtle">
              {t("editor.reasonLabel")}
              <textarea value={reason} onChange={(event) => setReason(event.target.value)} rows={2} maxLength={500} className="rounded-md border border-line bg-surface px-2 py-1.5 text-table text-fg" placeholder={t("editor.reasonPlaceholder")} />
            </label>
            {error ? <p role="alert" className="text-danger-strong">{error}</p> : null}
          </div>
          <DialogFooter>
            <Button variant="secondary" disabled={pending} onClick={() => setReview(false)}>{t("editor.cancel")}</Button>
            <Button disabled={pending} onClick={() => void apply()} data-testid="entitlements-apply">{pending ? t("editor.applying") : t("editor.apply")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
