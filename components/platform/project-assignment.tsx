"use client";

import * as React from "react";

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
export function AssignProjectCompany({ projectId, projectName, companies, label = "Assign Company", variant = "primary", size }: { projectId: string; projectName: string; companies: Option[]; label?: string; variant?: ButtonProps["variant"]; size?: ButtonProps["size"] }) {
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
      toast({ title: `${projectName} assigned to ${preview?.company.name ?? "the company"}.`, tone: "success" });
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
          <DialogTitle>Assign Project</DialogTitle>
          <DialogDescription>Choose the company that will own {projectName}. The project is not copied: it keeps its identity, history and everything attached to it.</DialogDescription>
          <div className="space-y-4">
            <dl className="text-table"><dt className="text-meta text-fg-subtle">Project</dt><dd className="text-fg">{projectName}</dd></dl>
            <div>
              <label htmlFor="assign-company-select" className="text-meta text-fg-subtle">Company</label>
              <select id="assign-company-select" className={select} value={companyId} onChange={(event) => void choose(event.target.value)} disabled={pending}>
                <option value="">Select company</option>
                {companies.map((company) => <option key={company.value} value={company.value}>{company.label}</option>)}
              </select>
            </div>
            {loading ? <p className="text-table text-fg-muted" role="status">Checking the assignment…</p> : null}
            {preview ? (
              <div className="space-y-3 rounded-lg border border-line p-3 text-table" data-testid="assignment-preview">
                <dl className="grid gap-3 sm:grid-cols-2">
                  <div><dt className="text-meta text-fg-subtle">Destination</dt><dd className="text-fg">{preview.company.name}</dd></div>
                  <div><dt className="text-meta text-fg-subtle">Parent Group</dt><dd className="text-fg">{preview.group ? <>{preview.group.name} <span className="text-fg-subtle">· inherited automatically</span></> : "Standalone company"}</dd></div>
                </dl>
                <p className="text-fg-muted">
                  Stays with the project: {preview.data.units} {preview.data.units === 1 ? "unit" : "units"}, {preview.data.documents} {preview.data.documents === 1 ? "document" : "documents"}, {preview.data.threeDExperiences} 3D {preview.data.threeDExperiences === 1 ? "experience" : "experiences"}.
                </p>
                {preview.blockers.length ? <ul className="space-y-1 text-danger-strong" role="alert">{preview.blockers.map((item) => <li key={item.code}>{item.message}</li>)}</ul> : null}
                {preview.warnings.length ? <ul className="space-y-1 text-warning-strong">{preview.warnings.map((item) => <li key={item.code}>{item.message}</li>)}</ul> : null}
                <p className="text-fg-muted">Access changes with this company&apos;s roles and permissions. Nobody is added to the company by this action.</p>
              </div>
            ) : null}
            {preview ? (
              <div>
                <label htmlFor="assign-company-reason" className="text-meta text-fg-subtle">Reason (optional)</label>
                <input id="assign-company-reason" className={select} value={reason} onChange={(event) => setReason(event.target.value)} maxLength={500} disabled={pending} />
              </div>
            ) : null}
            {error ? <p className="text-table text-danger-strong" role="alert" data-testid="assignment-error">{error}</p> : null}
          </div>
          <DialogFooter>
            <Button type="button" variant="secondary" onClick={() => { setOpen(false); reset(); }} disabled={pending}>Cancel</Button>
            <Button type="button" onClick={() => void assign()} disabled={!preview || blocked || pending} data-testid="assign-project-confirm">{pending ? "Assigning…" : "Assign Project"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
