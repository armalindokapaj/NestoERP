"use client";

import * as React from "react";
import { useRouter } from "@/components/navigation/guarded-router";

import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Dialog, DialogContent, DialogDescription, DialogTitle, useDialogClose } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/toast";
import { useUnsavedEditor } from "@/components/unsaved/use-unsaved";
import { cancelScheduledChangeAction, correctEmploymentHistoryAction } from "@/lib/actions/hr";
import { statusReasonLabels } from "@/lib/modules/hr/employment/employment.labels";
import { EMPLOYMENT_TYPES } from "@/lib/modules/hr/hr.schema";
import { hrLabel, useHrServerText, useHrTranslations } from "./hr-text";

const WORK_LOCATION_TYPES = ["OFFICE", "SITE", "REMOTE", "HYBRID", "OTHER"] as const;
import type { EmploymentChangeOptionsDTO } from "@/lib/modules/hr/employment/employment.options";
import type { AssignmentRowDTO, StatusRowDTO } from "@/lib/modules/hr/employment/employment.types";
import type { SaveOutcome } from "@/lib/unsaved/coordinator";
import { OUTCOME_COPY, outcomeOf } from "@/lib/unsaved/outcome";
import { FormSelect } from "@/components/ui/form-select";

const selectClass =
  "h-10 w-full rounded-md border border-line bg-surface px-3 text-body text-fg transition-colors hover:border-line-strong focus:border-accent focus:outline-none focus:ring-2 focus:ring-ring/20";

/** Cancels a scheduled change before it applies (E-03 §157). */
export function CancelScheduledChange({ employeeId, changeId, label }: { employeeId: string; changeId: string; label: string }) {
  const t = useHrTranslations();
  const serverText = useHrServerText();
  const router = useRouter();
  const toast = useToast();
  const [open, setOpen] = React.useState(false);
  const [pending, startTransition] = React.useTransition();
  return (
    <>
      <Button size="sm" variant="secondary" onClick={() => setOpen(true)} disabled={pending}>
        {t("common.cancel")}
      </Button>
      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title={t("historyActions.cancelTitle")}
        description={t("historyActions.cancelDescription", { label })}
        confirmLabel={t("historyActions.cancelConfirm")}
        pending={pending}
        onConfirm={() =>
          startTransition(async () => {
            const result = await cancelScheduledChangeAction(employeeId, changeId);
            if (result.ok) {
              toast({ title: t("historyActions.cancelled"), tone: "success" });
              setOpen(false);
              router.refresh();
            } else {
              toast({ title: serverText(result.error) ?? result.error, tone: "danger" });
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
type CorrectionProps = { employeeId: string; kind: "ASSIGNMENT" | "STATUS"; row: AssignmentRowDTO | StatusRowDTO; options: EmploymentChangeOptionsDTO };

export function CorrectHistoryRow(props: CorrectionProps) {
  const t = useHrTranslations();
  const [open, setOpen] = React.useState(false);
  const { row, kind } = props;
  const from = kind === "ASSIGNMENT" ? (row as AssignmentRowDTO).startDate : (row as StatusRowDTO).effectiveFrom;
  return (
    <>
      <Button size="sm" variant="ghost" onClick={() => setOpen(true)} aria-label={t("historyActions.correctLabel", { date: from })}>
        {t("historyActions.correct")}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
          <DialogTitle>{t("historyActions.correctTitle")}</DialogTitle>
          <DialogDescription>
            {t("historyActions.correctDescription")}
          </DialogDescription>
          {/* Inside the dialog, so its guarded close asks about the correction (AUD-03 §5). */}
          <CorrectionForm {...props} onDone={() => setOpen(false)} />
        </DialogContent>
      </Dialog>
    </>
  );
}

/**
 * The correction as an editor (AUD-03 §3): dirty against the row it opened
 * with, and "Save and continue" runs this same save — the browser's required
 * fields, then the server's validation — without closing or navigating.
 */
function CorrectionForm({ employeeId, kind, row, options, onDone }: CorrectionProps & { onDone: () => void }) {
  const t = useHrTranslations();
  const serverText = useHrServerText();
  const router = useRouter();
  const toast = useToast();
  const close = useDialogClose();
  const formRef = React.useRef<HTMLFormElement>(null);
  const running = React.useRef(false);
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const assignment = kind === "ASSIGNMENT" ? (row as AssignmentRowDTO) : null;
  const status = kind === "STATUS" ? (row as StatusRowDTO) : null;
  const [initial] = React.useState<Record<string, string>>(() => ({
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
  const [draft, setDraft] = React.useState<Record<string, string>>(initial);
  const editor = useUnsavedEditor({ module: "hr", saveKind: "save", label: t("historyActions.correctionLabel"), save: () => save("continue") });
  const { setDirty, setSaving, setUnresolved } = editor;
  const dirty = Object.keys(initial).some((key) => draft[key] !== initial[key]);
  React.useEffect(() => setDirty(dirty), [dirty, setDirty]);
  const set = (key: string) => (event: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setDraft((current) => ({ ...current, [key]: event.target.value }));
  const departments = assignment?.department?.id && !options.departments.some((option) => option.id === assignment.department?.id) ? [{ id: assignment.department.id, name: t("historyActions.asRecorded", { name: assignment.department.name }) }, ...options.departments] : options.departments;
  const managers = assignment?.manager?.memberId && !options.managers.some((option) => option.id === assignment.manager?.memberId) ? [{ id: assignment.manager.memberId, name: t("historyActions.asRecorded", { name: assignment.manager.name }) }, ...options.managers] : options.managers;

  async function save(mode: "normal" | "continue"): Promise<SaveOutcome> {
    const form = formRef.current;
    if (!form || running.current) return { kind: "unknown" };
    if (!form.checkValidity()) {
      if (mode === "normal") form.reportValidity();
      return { kind: "invalid" };
    }
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
    running.current = true;
    setPending(true);
    setSaving(true);
    let result: Awaited<ReturnType<typeof correctEmploymentHistoryAction>>;
    try {
      result = await correctEmploymentHistoryAction(employeeId, input);
    } catch {
      // It may or may not have been corrected: say so, never retry it (§6).
      setUnresolved(true);
      setError(OUTCOME_COPY.unknown);
      return { kind: "unknown" };
    } finally {
      running.current = false;
      setPending(false);
      setSaving(false);
    }
    const outcome = outcomeOf(result);
    if (result.ok) {
      setUnresolved(false);
      setDirty(false);
      toast({ title: t("historyActions.corrected"), tone: "success" });
      if (mode === "normal") onDone();
      router.refresh();
    } else {
      setError(result.fieldErrors ? Object.values(result.fieldErrors).flat()[0] ?? serverText(result.error) ?? result.error : serverText(result.error) ?? result.error);
    }
    return outcome;
  }

  function submit(event: React.FormEvent) {
    event.preventDefault();
    void save("normal");
  }

  return (
    <form ref={formRef} onSubmit={submit} className="mt-4 space-y-3">
      <div className="space-y-1.5">
        <Label htmlFor="correct-date">{kind === "ASSIGNMENT" ? t("columns.started") : t("leave.from")}</Label>
        <Input id="correct-date" type="date" value={draft.date} onChange={set("date")} required />
      </div>
      {assignment ? (
        <>
          <div className="space-y-1.5">
            <Label htmlFor="correct-title">{t("fields.jobTitle")}</Label>
            <Input id="correct-title" value={draft.jobTitle} onChange={set("jobTitle")} maxLength={120} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="correct-department">{t("columns.department")}</Label>
            <FormSelect id="correct-department" className={selectClass} value={draft.departmentId} onChange={set("departmentId")}>
              <option value="">{t("changes.none")}</option>
              {departments.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.name}
                </option>
              ))}
            </FormSelect>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="correct-manager">{t("columns.manager")}</Label>
            <FormSelect id="correct-manager" className={selectClass} value={draft.managerMemberId} onChange={set("managerMemberId")}>
              <option value="">{t("employmentForm.noManager")}</option>
              {managers.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.name}
                </option>
              ))}
            </FormSelect>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="correct-location-type">{t("employmentForm.worksAt")}</Label>
              <FormSelect id="correct-location-type" className={selectClass} value={draft.workLocationType} onChange={set("workLocationType")}>
                <option value="">{t("employmentForm.notSet")}</option>
                {WORK_LOCATION_TYPES.map((value) => (
                  <option key={value} value={value}>
                    {hrLabel(t, "workLocationType", value)}
                  </option>
                ))}
              </FormSelect>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="correct-location">{t("changes.place")}</Label>
              <Input id="correct-location" value={draft.workLocation} onChange={set("workLocation")} maxLength={160} />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="correct-type">{t("fields.employmentType")}</Label>
            <FormSelect id="correct-type" className={selectClass} value={draft.employmentType} onChange={set("employmentType")}>
              {EMPLOYMENT_TYPES.map((value) => (
                <option key={value} value={value}>
                  {hrLabel(t, "employmentType", value)}
                </option>
              ))}
            </FormSelect>
          </div>
        </>
      ) : (
        <div className="space-y-1.5">
          <Label htmlFor="correct-status-reason">{t("historyActions.reasonFor", { status: hrLabel(t, "employmentStatus", status!.status).toLowerCase() })}</Label>
          <FormSelect id="correct-status-reason" className={selectClass} value={draft.statusReason} onChange={set("statusReason")}>
            {Object.keys(statusReasonLabels)
              .filter((value) => value !== "CORRECTION")
              .map((value) => (
                <option key={value} value={value}>
                  {hrLabel(t, "statusReason", value)}
                </option>
              ))}
          </FormSelect>
        </div>
      )}
      <div className="space-y-1.5">
        <Label htmlFor="correct-reason">{t("historyActions.why")}</Label>
        <Textarea id="correct-reason" rows={2} value={draft.correctionReason} onChange={set("correctionReason")} required minLength={3} maxLength={2000} />
      </div>
      {error ? (
        <p role="alert" className="text-meta text-danger-strong">
          {error}
        </p>
      ) : null}
      <div className="flex flex-wrap items-center justify-end gap-2">
        <Button type="button" variant="secondary" onClick={close} disabled={pending}>
          {t("common.cancel")}
        </Button>
        <Button type="submit" disabled={pending}>
          {pending ? t("common.saving") : t("historyActions.save")}
        </Button>
      </div>
    </form>
  );
}
