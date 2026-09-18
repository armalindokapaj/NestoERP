"use client";

import * as React from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/toast";
import { cancelScheduledChangeAction, correctEmploymentHistoryAction } from "@/lib/actions/hr";
import { statusReasonLabels, workLocationTypeLabels } from "@/lib/modules/hr/employment/employment.labels";
import type { EmploymentChangeOptionsDTO } from "@/lib/modules/hr/employment/employment.options";
import type { AssignmentRowDTO, StatusRowDTO } from "@/lib/modules/hr/employment/employment.types";
import { employmentStatusLabels, employmentTypeLabels } from "@/lib/modules/hr/hr.status";

const selectClass =
  "h-10 w-full rounded-md border border-line bg-surface px-3 text-body text-fg transition-colors hover:border-line-strong focus:border-accent focus:outline-none focus:ring-2 focus:ring-ring/20";

/** Cancels a scheduled change before it applies (E-03 §157). */
export function CancelScheduledChange({ memberId, changeId, label }: { memberId: string; changeId: string; label: string }) {
  const router = useRouter();
  const toast = useToast();
  const [open, setOpen] = React.useState(false);
  const [pending, startTransition] = React.useTransition();
  return (
    <>
      <Button size="sm" variant="secondary" onClick={() => setOpen(true)} disabled={pending}>
        Cancel
      </Button>
      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title="Cancel this scheduled change?"
        description={`${label} will not take effect. It stays listed as cancelled.`}
        confirmLabel="Cancel the change"
        pending={pending}
        onConfirm={() =>
          startTransition(async () => {
            const result = await cancelScheduledChangeAction(memberId, changeId);
            if (result.ok) {
              toast({ title: "Scheduled change cancelled.", tone: "success" });
              setOpen(false);
              router.refresh();
            } else {
              toast({ title: result.error, tone: "danger" });
            }
          })
        }
      />
    </>
  );
}

/**
 * Corrects one history row (E-03 §42-§44, §171, §224). The original stays,
 * marked as corrected; the new row names it and the reason, which is required.
 * Moving a start moves the end of the row before it.
 */
export function CorrectHistoryRow({ memberId, kind, row, options }: { memberId: string; kind: "ASSIGNMENT" | "STATUS"; row: AssignmentRowDTO | StatusRowDTO; options: EmploymentChangeOptionsDTO }) {
  const router = useRouter();
  const toast = useToast();
  const [open, setOpen] = React.useState(false);
  const [pending, startTransition] = React.useTransition();
  const [error, setError] = React.useState<string | null>(null);
  const assignment = kind === "ASSIGNMENT" ? (row as AssignmentRowDTO) : null;
  const status = kind === "STATUS" ? (row as StatusRowDTO) : null;
  const [draft, setDraft] = React.useState<Record<string, string>>(() => ({
    date: assignment?.startDate ?? status?.effectiveFrom ?? "",
    jobTitle: assignment?.jobTitle ?? "",
    departmentId: assignment?.department?.id ?? "",
    managerMemberId: assignment?.manager?.memberId ?? "",
    workLocationType: assignment?.workLocationType ?? "",
    workLocation: assignment?.workLocation ?? "",
    employmentType: assignment?.employmentType ?? "FULL_TIME",
    statusReason: status?.reason ?? "",
    correctionReason: "",
  }));
  const set = (key: string) => (event: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setDraft((current) => ({ ...current, [key]: event.target.value }));
  const departments = assignment?.department?.id && !options.departments.some((option) => option.id === assignment.department?.id) ? [{ id: assignment.department.id, name: `${assignment.department.name} (as recorded)` }, ...options.departments] : options.departments;
  const managers = assignment?.manager?.memberId && !options.managers.some((option) => option.id === assignment.manager?.memberId) ? [{ id: assignment.manager.memberId, name: `${assignment.manager.name} (as recorded)` }, ...options.managers] : options.managers;

  function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    const input =
      kind === "ASSIGNMENT"
        ? {
            kind,
            rowId: row.id,
            correctionReason: draft.correctionReason,
            ...(draft.date !== assignment!.startDate ? { startDate: draft.date } : {}),
            ...((draft.jobTitle || null) !== assignment!.jobTitle ? { jobTitle: draft.jobTitle || null } : {}),
            ...((draft.departmentId || null) !== (assignment!.department?.id ?? null) ? { departmentId: draft.departmentId || null } : {}),
            ...((draft.managerMemberId || null) !== (assignment!.manager?.memberId ?? null) ? { managerMemberId: draft.managerMemberId || null } : {}),
            ...((draft.workLocationType || null) !== assignment!.workLocationType ? { workLocationType: draft.workLocationType || null } : {}),
            ...((draft.workLocation || null) !== assignment!.workLocation ? { workLocation: draft.workLocation || null } : {}),
            ...(draft.employmentType !== assignment!.employmentType ? { employmentType: draft.employmentType } : {}),
          }
        : {
            kind,
            rowId: row.id,
            correctionReason: draft.correctionReason,
            ...(draft.date !== status!.effectiveFrom ? { effectiveFrom: draft.date } : {}),
            ...(draft.statusReason !== status!.reason ? { reason: draft.statusReason } : {}),
          };
    startTransition(async () => {
      const result = await correctEmploymentHistoryAction(memberId, input);
      if (result.ok) {
        toast({ title: "History corrected. The original is kept.", tone: "success" });
        setOpen(false);
        router.refresh();
      } else {
        setError(result.fieldErrors ? Object.values(result.fieldErrors).flat()[0] ?? result.error : result.error);
      }
    });
  }

  return (
    <>
      <Button size="sm" variant="ghost" onClick={() => setOpen(true)} aria-label={`Correct the row from ${assignment?.startDate ?? status?.effectiveFrom}`}>
        Correct
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
          <DialogTitle>Correct history</DialogTitle>
          <DialogDescription>
            The original row stays, marked as corrected, and the audit trail keeps both. Say why the history was wrong.
          </DialogDescription>
          <form onSubmit={submit} className="mt-4 space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="correct-date">{kind === "ASSIGNMENT" ? "Started" : "From"}</Label>
              <Input id="correct-date" type="date" value={draft.date} onChange={set("date")} required />
            </div>
            {assignment ? (
              <>
                <div className="space-y-1.5">
                  <Label htmlFor="correct-title">Job title</Label>
                  <Input id="correct-title" value={draft.jobTitle} onChange={set("jobTitle")} maxLength={120} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="correct-department">Department</Label>
                  <select id="correct-department" className={selectClass} value={draft.departmentId} onChange={set("departmentId")}>
                    <option value="">None</option>
                    {departments.map((option) => (
                      <option key={option.id} value={option.id}>
                        {option.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="correct-manager">Manager</Label>
                  <select id="correct-manager" className={selectClass} value={draft.managerMemberId} onChange={set("managerMemberId")}>
                    <option value="">No manager</option>
                    {managers.map((option) => (
                      <option key={option.id} value={option.id}>
                        {option.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label htmlFor="correct-location-type">Works at</Label>
                    <select id="correct-location-type" className={selectClass} value={draft.workLocationType} onChange={set("workLocationType")}>
                      <option value="">Not set</option>
                      {Object.entries(workLocationTypeLabels).map(([value, label]) => (
                        <option key={value} value={value}>
                          {label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="correct-location">Place</Label>
                    <Input id="correct-location" value={draft.workLocation} onChange={set("workLocation")} maxLength={160} />
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="correct-type">Employment type</Label>
                  <select id="correct-type" className={selectClass} value={draft.employmentType} onChange={set("employmentType")}>
                    {Object.entries(employmentTypeLabels).map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </select>
                </div>
              </>
            ) : (
              <div className="space-y-1.5">
                <Label htmlFor="correct-status-reason">Reason for the {employmentStatusLabels[status!.status].toLowerCase()} status</Label>
                <select id="correct-status-reason" className={selectClass} value={draft.statusReason} onChange={set("statusReason")}>
                  {Object.entries(statusReasonLabels)
                    .filter(([value]) => value !== "CORRECTION")
                    .map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                </select>
              </div>
            )}
            <div className="space-y-1.5">
              <Label htmlFor="correct-reason">Why is this being corrected?</Label>
              <Textarea id="correct-reason" rows={2} value={draft.correctionReason} onChange={set("correctionReason")} required minLength={3} maxLength={2000} />
            </div>
            {error ? (
              <p role="alert" className="text-meta text-danger-strong">
                {error}
              </p>
            ) : null}
            <div className="flex flex-wrap items-center justify-end gap-2">
              <Button type="button" variant="secondary" onClick={() => setOpen(false)} disabled={pending}>
                Cancel
              </Button>
              <Button type="submit" disabled={pending}>
                {pending ? "Saving…" : "Save correction"}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
