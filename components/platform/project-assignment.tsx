"use client";

import * as React from "react";

import { useTranslations } from "@/components/i18n/i18n-provider";
import { engineeringApi, failureMessage } from "@/components/engineering/engineering-api";
import { useRouter } from "@/components/navigation/guarded-router";
import { Button, type ButtonProps } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/components/ui/toast";
import type { ProjectAssignmentPreview } from "@/lib/modules/platform/platform-project-assignment.service";

type Option = { value: string; label: string };

const select = "h-9 w-full rounded-lg border border-line bg-surface px-2.5 text-table text-fg outline-none focus-visible:ring-2 focus-visible:ring-ring/40";

async function command<T>(body: Record<string, unknown>) {
  return engineeringApi<T>("/api/platform-admin/command", { body });
}

/**
 * Assign Company (Standalone Project PRD §14-§17, §41, §48, §49): choose the
 * destination, read what the assignment keeps and what stops it, then confirm.
 * The group is shown as inherited from the company, never picked on its own.
 * The same project keeps its identity; only its owner changes.
 */
export function AssignProjectCompany({ projectId, projectName, companies, label: labelProp, variant = "primary", size }: { projectId: string; projectName: string; companies: Option[]; label?: string; variant?: ButtonProps["variant"]; size?: ButtonProps["size"] }) {
  const t = useTranslations("adminOrgs");
  const label = labelProp ?? t("assign.label");
  const router = useRouter();
  const toast = useToast();
  const [open, setOpen] = React.useState(false);
  const [companyId, setCompanyId] = React.useState("");
  const [reason, setReason] = React.useState("");
  const [preview, setPreview] = React.useState<ProjectAssignmentPreview | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  function reset() { setCompanyId(""); setReason(""); setPreview(null); setError(null); setLoading(false); }

  async function choose(next: string) {
    setCompanyId(next);
    setPreview(null);
    setError(null);
    if (!next) return;
    setLoading(true);
    try {
      const result = await command<ProjectAssignmentPreview>({ action: "project.assignPreview", projectId, companyId: next });
      setPreview((current) => (current === null ? result : current));
    } catch (failure) {
      setError(failureMessage(failure));
    } finally {
      setLoading(false);
    }
  }

  async function assign() {
    setPending(true);
    setError(null);
    try {
      await command({ action: "project.assign", projectId, companyId, reason });
      toast({ title: t("assign.toast", { project: projectName, company: preview?.company.name ?? t("assign.fallbackCompany") }), tone: "success" });
      setOpen(false);
      reset();
      router.refresh();
    } catch (failure) {
      setError(failureMessage(failure));
      // The page that raced us holds the truth: show it rather than a stale form.
      router.refresh();
    } finally {
      setPending(false);
    }
  }

  const blocked = Boolean(preview?.blockers.length);
  return (
    <>
      <Button type="button" size={size} variant={variant} onClick={() => setOpen(true)} data-testid="assign-company">{label}</Button>
      <Dialog open={open} onOpenChange={(next) => { setOpen(next); if (!next) reset(); }}>
        <DialogContent>
          <DialogTitle>{t("assign.title")}</DialogTitle>
          <DialogDescription>{t("assign.description", { name: projectName })}</DialogDescription>
          <div className="space-y-4">
            <dl className="text-table"><dt className="text-meta text-fg-subtle">{t("assign.project")}</dt><dd className="text-fg">{projectName}</dd></dl>
            <div>
              <label htmlFor="assign-company-select" className="text-meta text-fg-subtle">{t("assign.company")}</label>
              <select id="assign-company-select" className={select} value={companyId} onChange={(event) => void choose(event.target.value)} disabled={pending}>
                <option value="">{t("assign.selectCompany")}</option>
                {companies.map((company) => <option key={company.value} value={company.value}>{company.label}</option>)}
              </select>
            </div>
            {loading ? <p className="text-table text-fg-muted" role="status">{t("assign.checking")}</p> : null}
            {preview ? (
              <div className="space-y-3 rounded-lg border border-line p-3 text-table" data-testid="assignment-preview">
                <dl className="grid gap-3 sm:grid-cols-2">
                  <div><dt className="text-meta text-fg-subtle">{t("assign.destination")}</dt><dd className="text-fg">{preview.company.name}</dd></div>
                  <div><dt className="text-meta text-fg-subtle">{t("assign.parentGroup")}</dt><dd className="text-fg">{preview.group ? <>{preview.group.name} <span className="text-fg-subtle">· {t("assign.inherited")}</span></> : t("assign.standaloneCompany")}</dd></div>
                </dl>
                <p className="text-fg-muted">
                  {t("assign.stays", { units: t("assign.units", { count: preview.data.units }), documents: t("assign.documents", { count: preview.data.documents }), experiences: t("assign.experiences", { count: preview.data.threeDExperiences }) })}
                </p>
                {preview.blockers.length ? <ul className="space-y-1 text-danger-strong" role="alert">{preview.blockers.map((item) => <li key={item.code}>{item.message}</li>)}</ul> : null}
                {preview.warnings.length ? <ul className="space-y-1 text-warning-strong">{preview.warnings.map((item) => <li key={item.code}>{item.message}</li>)}</ul> : null}
                <p className="text-fg-muted">{t("assign.accessNote")}</p>
              </div>
            ) : null}
            {preview ? (
              <div>
                <label htmlFor="assign-company-reason" className="text-meta text-fg-subtle">{t("assign.reasonOptional")}</label>
                <input id="assign-company-reason" className={select} value={reason} onChange={(event) => setReason(event.target.value)} maxLength={500} disabled={pending} />
              </div>
            ) : null}
            {error ? <p className="text-table text-danger-strong" role="alert" data-testid="assignment-error">{error}</p> : null}
          </div>
          <DialogFooter>
            <Button type="button" variant="secondary" onClick={() => { setOpen(false); reset(); }} disabled={pending}>{t("assign.cancel")}</Button>
            <Button type="button" onClick={() => void assign()} disabled={!preview || blocked || pending} data-testid="assign-project-confirm">{pending ? t("assign.assigning") : t("assign.confirm")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
