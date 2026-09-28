"use client";

import * as React from "react";

import { engineeringApi } from "@/components/engineering/engineering-api";
import { useRouter } from "@/components/navigation/guarded-router";
import { AdminStatusBadge } from "@/components/platform/admin-status-badge";
import { useUnsavedEditor } from "@/components/unsaved/use-unsaved";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/components/ui/toast";

type Mode = "INHERIT" | "ENABLED" | "DISABLED" | "TRIAL";
type ModuleRow = {
  key: string; name: string; description: string; state: string; entitled: boolean; inPlan: boolean; source: "core" | "plan" | "override";
  override: { mode: "ENABLED" | "DISABLED" | "TRIAL"; startsAt: string | null; endsAt: string | null } | null;
  switchedOn: boolean;
};
type Change = { mode: Mode; startsAt: string; endsAt: string };
type Preview = { disable: string[]; enable: string[]; keep: string[] };

const day = (iso: string | null) => (iso ? iso.slice(0, 10) : "");
const MODE_LABEL: Record<Mode, string> = { INHERIT: "Plan default", ENABLED: "Enabled", DISABLED: "Disabled", TRIAL: "Trial" };

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
  const [changes, setChanges] = React.useState<Record<string, Change>>({});
  const [planId, setPlanId] = React.useState<string | null>(plan.id);
  const [preview, setPreview] = React.useState<Preview | null>(null);
  const [review, setReview] = React.useState(false);
  const [reason, setReason] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [pending, setPending] = React.useState(false);
  const planChanged = planId !== plan.id;
  const count = Object.keys(changes).length + (planChanged ? 1 : 0);
  const editor = useUnsavedEditor({ module: "platform", saveKind: "none", workflow: "Apply Changes", label: "Module entitlements" });
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
      toast({ title: "Entitlements updated.", tone: "success" });
      router.refresh();
    } catch (failure) {
      // Nothing was applied: the server takes all of it or none (§64, §79).
      setError(failure instanceof Error ? `Changes were not applied. ${failure.message}` : "Changes were not applied. Review the error and try again.");
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
          Plan
          <select value={planId ?? ""} disabled={!canManage} onChange={(event) => setPlanId(event.target.value || null)} className={`${selectClass} h-9 min-w-56`} aria-label="Plan">
            {plans.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            <option value="">Custom (exceptions only)</option>
          </select>
        </label>
        {canManage ? (
          <div className="flex items-center gap-2">
            {count ? <Button variant="secondary" size="sm" onClick={() => { setChanges({}); setPlanId(plan.id); }}>Discard</Button> : null}
            <Button size="sm" disabled={count === 0} onClick={() => setReview(true)} data-testid="entitlements-review">Review changes{count ? ` (${count})` : ""}</Button>
          </div>
        ) : null}
      </div>
      {planChanged && preview ? (
        <div className="nesto-card space-y-1 p-4 text-table" data-testid="plan-impact">
          <p className="font-medium text-fg">Changing from {plan.name} to {plans.find((option) => option.value === planId)?.label ?? "Custom"} will:</p>
          {preview.disable.length ? <p className="text-fg-muted"><span className="font-medium text-danger-strong">Disable:</span> {preview.disable.join(", ")}</p> : null}
          {preview.enable.length ? <p className="text-fg-muted"><span className="font-medium text-success-strong">Enable:</span> {preview.enable.join(", ")}</p> : null}
          <p className="text-fg-muted"><span className="font-medium">Keep:</span> {preview.keep.join(", ") || "—"}</p>
          <p className="text-meta text-fg-subtle">No data will be deleted. The plan&apos;s limits replace the current ones.</p>
        </div>
      ) : null}

      <div className="nesto-card overflow-x-auto">
        <table className="w-full min-w-[640px] text-left text-table" aria-label="Module entitlements">
          <thead className="border-b border-line text-meta text-fg-subtle">
            <tr><th className="px-4 py-2.5 font-medium">Module</th><th className="px-4 py-2.5 font-medium max-md:hidden">Plan default</th><th className="px-4 py-2.5 font-medium">Entitlement</th><th className="px-4 py-2.5 font-medium">Status</th></tr>
          </thead>
          <tbody className="divide-y divide-line">
            {modules.map((row) => {
              const value = current(row);
              const dirty = Boolean(changes[row.key]);
              return (
                <tr key={row.key} className={dirty ? "bg-accent-soft/40" : undefined} data-testid="entitlement-row" data-module={row.key}>
                  <td className="px-4 py-2.5">
                    <p className="font-medium text-fg">{row.name}</p>
                    <p className="max-w-md truncate text-meta text-fg-subtle max-lg:hidden">{row.description}</p>
                  </td>
                  <td className="px-4 py-2.5 text-fg-muted max-md:hidden">{row.source === "core" ? "Required" : row.inPlan ? "Included" : "Not included"}</td>
                  <td className="px-4 py-2.5">
                    {row.source === "core" ? (
                      <span className="text-fg-subtle">Always on</span>
                    ) : (
                      <div className="flex flex-wrap items-center gap-2">
                        <select aria-label={`${row.name} entitlement`} disabled={!canManage} value={value.mode} onChange={(event) => stage(row, { ...value, mode: event.target.value as Mode, endsAt: event.target.value === "DISABLED" || event.target.value === "INHERIT" ? "" : value.endsAt, startsAt: event.target.value === "INHERIT" ? "" : value.startsAt })} className={selectClass}>
                          {(Object.keys(MODE_LABEL) as Mode[]).map((mode) => <option key={mode} value={mode}>{MODE_LABEL[mode]}</option>)}
                        </select>
                        {value.mode === "ENABLED" || value.mode === "TRIAL" ? (
                          <label className="flex items-center gap-1 text-meta text-fg-subtle">from<input type="date" disabled={!canManage} value={value.startsAt} onChange={(event) => stage(row, { ...value, startsAt: event.target.value })} className={selectClass} aria-label={`${row.name} starts`} /></label>
                        ) : null}
                        {value.mode === "TRIAL" ? (
                          <label className="flex items-center gap-1 text-meta text-fg-subtle">until<input type="date" required disabled={!canManage} value={value.endsAt} onChange={(event) => stage(row, { ...value, endsAt: event.target.value })} className={selectClass} aria-label={`${row.name} trial ends`} /></label>
                        ) : null}
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-2.5">
                    <AdminStatusBadge status={row.state} />
                    {row.state === "Trial" && row.override?.endsAt ? <span className="ml-1 text-meta text-fg-subtle">until {new Date(row.override.endsAt).toLocaleDateString("en-GB")}</span> : null}
                    {row.entitled && !row.switchedOn && row.source !== "core" ? <p className="text-meta text-fg-subtle">Switched off by the company</p> : null}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <Dialog open={review} onOpenChange={(open) => { if (!pending) setReview(open); }}>
        <DialogContent className="max-w-lg" data-testid="entitlements-review-dialog">
          <DialogTitle>Review changes</DialogTitle>
          <DialogDescription>They are applied together, or not at all. No data is deleted.</DialogDescription>
          <div className="mt-3 space-y-3 text-table">
            {planChanged ? <p><span className="font-medium">Plan:</span> {plan.name} → {plans.find((option) => option.value === planId)?.label ?? "Custom"}</p> : null}
            {staged.length ? (
              <ul className="space-y-1">
                {staged.map((row) => {
                  const change = changes[row.key];
                  const sign = change.mode === "DISABLED" ? "−" : change.mode === "INHERIT" ? "↺" : "+";
                  return <li key={row.key}><span className="font-mono">{sign}</span> {row.name}: {MODE_LABEL[change.mode]}{change.mode === "TRIAL" && change.endsAt ? ` until ${change.endsAt}` : ""}{change.startsAt && change.mode !== "INHERIT" ? ` from ${change.startsAt}` : ""}</li>;
                })}
              </ul>
            ) : null}
            <label className="flex flex-col gap-1 text-meta text-fg-subtle">
              Reason / note (optional)
              <textarea value={reason} onChange={(event) => setReason(event.target.value)} rows={2} maxLength={500} className="rounded-md border border-line bg-surface px-2 py-1.5 text-table text-fg" placeholder="Included in contract amendment #2." />
            </label>
            {error ? <p role="alert" className="text-danger-strong">{error}</p> : null}
          </div>
          <DialogFooter>
            <Button variant="secondary" disabled={pending} onClick={() => setReview(false)}>Cancel</Button>
            <Button disabled={pending} onClick={() => void apply()} data-testid="entitlements-apply">{pending ? "Applying…" : "Apply Changes"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
