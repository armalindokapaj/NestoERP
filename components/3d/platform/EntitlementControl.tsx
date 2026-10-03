"use client";

import * as React from "react";
import { useRouter } from "next/navigation";

import { engineeringApi, failureMessage } from "@/components/engineering/engineering-api";
import { selectClass } from "@/components/forms/record-form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { useTranslations } from "@/components/i18n/i18n-provider";
import { enumLabel } from "@/lib/i18n/modules/adminAccess/enum-label";

type Entitlement = { status: "INACTIVE" | "ACTIVE" | "SUSPENDED" | "EXPIRED"; viewerEnabled: boolean; planKey: string | null; activatedAt: Date | string | null; expiresAt: Date | string | null } | null;

export function EntitlementControl({ projectId, entitlement, compact = false }: { projectId: string; entitlement: Entitlement; compact?: boolean }) {
  const [status, setStatus] = React.useState<NonNullable<Entitlement>["status"]>(entitlement?.status ?? "ACTIVE");
  const [viewerEnabled, setViewerEnabled] = React.useState(entitlement?.viewerEnabled ?? true);
  const [planKey, setPlanKey] = React.useState(entitlement?.planKey ?? "premium");
  const [expiresAt, setExpiresAt] = React.useState(entitlement?.expiresAt ? new Date(entitlement.expiresAt).toISOString().slice(0, 10) : "");
  const [reason, setReason] = React.useState("");
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const router = useRouter();
  const toast = useToast();
  const t = useTranslations("adminPlatform");

  async function save() {
    if (reason.trim().length < 3) { setError(t("threeDAdmin.entitlement.reasonRequired")); return; }
    setPending(true); setError(null);
    try {
      await engineeringApi(`/api/platform/3d/projects/${projectId}/entitlement`, { method: "PUT", body: { status, viewerEnabled, planKey: planKey.trim() || null, activatedAt: status === "ACTIVE" ? entitlement?.activatedAt ?? new Date().toISOString() : entitlement?.activatedAt ?? null, expiresAt: expiresAt ? new Date(`${expiresAt}T23:59:59.999Z`).toISOString() : null, reason } });
      toast({ title: entitlement ? t("threeDAdmin.entitlement.updated") : t("threeDAdmin.entitlement.provisioned"), tone: "success" });
      setReason("");
      router.refresh();
    } catch (failure) { setError(failureMessage(failure, t("threeDAdmin.entitlement.saveFailed"))); }
    finally { setPending(false); }
  }

  if (compact && !entitlement) return <div className="flex items-center gap-2"><Input aria-label={t("threeDAdmin.entitlement.provisionReasonLabel")} className="h-8 w-52" value={reason} onChange={(event) => setReason(event.target.value)} placeholder={t("threeDAdmin.entitlement.provisionReasonPlaceholder")} /><Button type="button" size="sm" onClick={() => void save()} disabled={pending}>{pending ? t("threeDAdmin.entitlement.provisioning") : t("threeDAdmin.entitlement.provision")}</Button>{error ? <span className="text-xs text-danger-strong">{error}</span> : null}</div>;

  return <section className="nesto-card p-4"><div className="grid gap-3 md:grid-cols-5"><label className="text-meta font-medium text-fg-muted">{t("threeDAdmin.entitlement.status")}<select className={selectClass} value={status} onChange={(event) => setStatus(event.target.value as NonNullable<Entitlement>["status"])}>{(["ACTIVE", "SUSPENDED", "INACTIVE", "EXPIRED"] as const).map((value) => <option key={value} value={value}>{enumLabel(t, "threeDAdmin.entitlement.statuses", value)}</option>)}</select></label><label className="text-meta font-medium text-fg-muted">{t("threeDAdmin.entitlement.plan")}<Input value={planKey} onChange={(event) => setPlanKey(event.target.value)} /></label><label className="text-meta font-medium text-fg-muted">{t("threeDAdmin.entitlement.expires")}<Input type="date" value={expiresAt} onChange={(event) => setExpiresAt(event.target.value)} /></label><label className="flex items-center gap-2 self-end pb-2 text-body text-fg"><input type="checkbox" checked={viewerEnabled} onChange={(event) => setViewerEnabled(event.target.checked)} />{t("threeDAdmin.entitlement.viewerEnabled")}</label><div className="self-end"><Input aria-label={t("threeDAdmin.entitlement.reasonLabel")} value={reason} onChange={(event) => setReason(event.target.value)} placeholder={t("threeDAdmin.entitlement.reasonPlaceholder")} /><Button className="mt-2 w-full" type="button" size="sm" onClick={() => void save()} disabled={pending}>{pending ? t("threeDAdmin.entitlement.saving") : t("threeDAdmin.entitlement.save")}</Button></div></div>{error ? <p className="mt-2 text-table text-danger-strong">{error}</p> : null}</section>;
}
