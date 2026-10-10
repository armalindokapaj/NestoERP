"use client";

import * as React from "react";
import Link from "@/components/navigation/nav-link";
import { useRouter } from "@/components/navigation/guarded-router";
import { ArrowRight, CalendarClock, ChevronDown, PenLine } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollRegion } from "@/components/ui/scroll-region";
import { Dialog, DialogContent, DialogDescription, DialogTitle, useDialogClose } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/toast";
import { useUnsavedEditor } from "@/components/unsaved/use-unsaved";
import { employmentChangeAction } from "@/lib/actions/hr";
import { addDays } from "@/lib/modules/hr/employment/employment.dates";
import { POSITION_REASONS, STATUS_CHANGE_REASONS, TERMINATION_REASONS } from "@/lib/modules/hr/employment/employment.labels";
import type { EmploymentChangeOptionsDTO, Option } from "@/lib/modules/hr/employment/employment.options";
import { EMPLOYMENT_TYPES } from "@/lib/modules/hr/hr.schema";
import { canTransitionEmployment } from "@/lib/modules/hr/hr.status";
import { hrLabel, useHrServerText, useHrTranslations } from "./hr-text";

const WORK_LOCATION_TYPES = ["OFFICE", "SITE", "REMOTE", "HYBRID", "OTHER"] as const;
import type { EmployeeDetailDTO } from "@/lib/modules/hr/hr.types";
import { OUTCOME_COPY } from "@/lib/unsaved/outcome";
import { FormSelect } from "@/components/ui/form-select";

const selectClass =
  "h-10 w-full rounded-md border border-line bg-surface px-3 text-body text-fg transition-colors hover:border-line-strong focus:border-accent focus:outline-none focus:ring-2 focus:ring-ring/20";

type Action = "POSITION" | "DEPARTMENT" | "LEGAL_ENTITY" | "MANAGER" | "LOCATION" | "EMPLOYMENT_TYPE" | "STATUS" | "TERMINATE" | "REHIRE";


/**
 * Employment changes, one semantic action at a time (E-03 §96-§104, §163-§170).
 *
 * Every change asks for the day it takes effect: today applies it now, a later
 * day schedules it, an earlier day backdates it — which the server allows only
 * with the correction permission (§86). Before anything is applied the form
 * shows what is now and what it will be (§167); ending employment and moving
 * somebody to another company ask to be confirmed (§168). Access to NESTO is
 * not touched by any of these: that is Team's decision (§92).
 */
export function EmploymentChanges({ employee, options, today }: { employee: EmployeeDetailDTO; options: EmploymentChangeOptionsDTO; today: string }) {
  const caps = employee.employment;
  const status = employee.employmentStatus;
  const [action, setAction] = React.useState<Action | null>(null);
  const planned = status === "PLANNED";
  const ended = status === "ENDED";
  const t = useHrTranslations();

  const items: Array<{ action: Action; label: string; show: boolean }> = [
    { action: "STATUS", label: planned ? t("changes.startEmployment") : t("changes.titles.STATUS"), show: caps.canChangeStatus && !ended },
    { action: "POSITION", label: planned ? t("changes.changePlannedPosition") : t("changes.promote"), show: caps.canChangePosition },
    { action: "DEPARTMENT", label: t("changes.transferDepartment"), show: caps.canTransferDepartment },
    { action: "LEGAL_ENTITY", label: t("changes.titles.LEGAL_ENTITY"), show: caps.canTransferCompany && options.companies.length > 0 },
    { action: "MANAGER", label: t("changes.titles.MANAGER"), show: caps.canChangeManager },
    { action: "LOCATION", label: t("changes.titles.LOCATION"), show: caps.canChangeLocation },
    { action: "EMPLOYMENT_TYPE", label: t("changes.titles.EMPLOYMENT_TYPE"), show: caps.canChangeEmploymentType },
    { action: "TERMINATE", label: planned ? t("changes.withdraw") : t("changes.titles.TERMINATE"), show: caps.canChangeStatus && !ended },
    { action: "REHIRE", label: t("changes.titles.REHIRE"), show: caps.canChangeStatus && ended },
  ];
  const visible = items.filter((item) => item.show);

  return (
    <>
      {employee.capabilities.canEditEmployment ? (
        <Button asChild variant="secondary" size="sm">
          <Link href={`/hr/employees/${employee.id}/employment/edit`}>
            <PenLine aria-hidden="true" />
            {t("meta.editDetails")}
          </Link>
        </Button>
      ) : null}
      {visible.length > 0 ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button size="sm" data-testid="employment-change-menu">
              {t("changes.menu")}
              <ChevronDown aria-hidden="true" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuLabel>{planned ? t("changes.plannedEmployment") : ended ? t("changes.endedEmployment") : t("changes.datedChanges")}</DropdownMenuLabel>
            <DropdownMenuSeparator />
            {visible.map((item) => (
              <DropdownMenuItem key={item.action} onSelect={() => setAction(item.action)}>
                {item.label}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
      {action ? <ChangeDialog key={action} action={action} employee={employee} options={options} today={today} onClose={() => setAction(null)} /> : null}
    </>
  );
}

type Draft = Record<string, string>;

type ChangeDialogProps = { action: Action; employee: EmployeeDetailDTO; options: EmploymentChangeOptionsDTO; today: string; onClose: () => void };

/**
 * The dialog's X, Escape, backdrop and Cancel all ask first while the change
 * holds input or is being applied (AUD-03 §5): the body registers inside the
 * dialog's guarded scope. Applying is the workflow step itself — it is
 * reviewed, and ending employment or moving company is confirmed — so the
 * prompt never applies it: Stay or Discard only (§3).
 */
function ChangeDialog(props: ChangeDialogProps) {
  return (
    <Dialog open onOpenChange={(open) => (!open ? props.onClose() : undefined)}>
      <ChangeDialogBody {...props} />
    </Dialog>
  );
}

function ChangeDialogBody({ action, employee, options, today, onClose }: ChangeDialogProps) {
  const t = useHrTranslations();
  const serverText = useHrServerText();
  const router = useRouter();
  const close = useDialogClose();
  const toast = useToast();
  const [pending, startTransition] = React.useTransition();
  const planned = employee.employmentStatus === "PLANNED";
  const revisesPlan = planned && action !== "STATUS";
  const reachable = (["ACTIVE", "ON_LEAVE", "SUSPENDED"] as const).filter((next) => next !== employee.employmentStatus && canTransitionEmployment(employee.employmentStatus, next) && (!planned || next === "ACTIVE"));

  const [initialDraft] = React.useState<Draft>(() => ({
    effectiveDate: planned && action === "STATUS" && employee.startDate ? employee.startDate : today,
    lastWorkingDay: today,
    jobTitle: employee.jobTitle ?? "",
    positionReason: "PROMOTION",
    // A transfer starts with nothing chosen in the other company: this company's department and manager are not its.
    departmentId: action === "LEGAL_ENTITY" ? "" : (employee.department?.id ?? ""),
    managerMemberId: action === "LEGAL_ENTITY" ? "" : (employee.manager?.memberId ?? ""),
    workLocationType: employee.workLocationType ?? "",
    workLocation: employee.workLocation ?? "",
    employmentType: employee.employmentType,
    status: reachable[0] ?? "ACTIVE",
    statusReason: "",
    terminationReason: "RESIGNATION",
    privateReason: "",
    targetCompanyId: options.companies[0]?.id ?? "",
    documentId: "",
    note: "",
  }));
  const [draft, setDraft] = React.useState<Draft>(initialDraft);
  const [step, setStep] = React.useState<"form" | "review">("form");
  const [confirmed, setConfirmed] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = React.useState<Record<string, string[]>>({});
  const running = React.useRef(false);
  const editor = useUnsavedEditor({ module: "hr", saveKind: "none", workflow: "Apply", label: t(`changes.titles.${action}`) });
  const { setDirty, setSaving, setUnresolved } = editor;
  // Dirty against the values it opened with: putting them back makes it clean again.
  const dirty = confirmed || Object.keys(initialDraft).some((key) => draft[key] !== initialDraft[key]);
  React.useEffect(() => setDirty(dirty), [dirty, setDirty]);
  React.useEffect(() => setSaving(pending), [pending, setSaving]);
  const set = (key: string) => (event: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setDraft((current) => ({ ...current, [key]: event.target.value, ...(key === "targetCompanyId" ? { departmentId: "", managerMemberId: "" } : {}) }));

  const target = options.companies.find((company) => company.id === draft.targetCompanyId) ?? null;
  const departments = action === "LEGAL_ENTITY" ? (target?.departments ?? []) : options.departments;
  const managers = action === "LEGAL_ENTITY" ? (target?.managers ?? []) : options.managers;
  const effective = action === "TERMINATE" ? addDays(draft.lastWorkingDay || today, 1) : draft.effectiveDate;
  const timing = revisesPlan || (action === "REHIRE" && effective > today) ? "PLAN" : effective > today ? "FUTURE" : effective < today ? "PAST" : "TODAY";
  const highImpact = action === "LEGAL_ENTITY" || (action === "TERMINATE" && !planned);

  function payload(): Record<string, unknown> {
    const base = { effectiveDate: draft.effectiveDate, documentId: draft.documentId || undefined, note: draft.note || undefined, expectedAssignmentId: employee.currentAssignmentId ?? undefined };
    const manager = draft.managerMemberId === (employee.manager?.memberId ?? "") ? undefined : draft.managerMemberId || null;
    switch (action) {
      case "POSITION":
        return { action, ...base, jobTitle: draft.jobTitle, reason: draft.positionReason, managerMemberId: manager };
      case "DEPARTMENT":
        return { action, ...base, departmentId: draft.departmentId, managerMemberId: manager };
      case "MANAGER":
        return { action, ...base, managerMemberId: draft.managerMemberId || null };
      case "LOCATION":
        return { action, ...base, workLocationType: draft.workLocationType, workLocation: draft.workLocation || undefined };
      case "EMPLOYMENT_TYPE":
        return { action, ...base, employmentType: draft.employmentType };
      case "STATUS":
        return { action, ...base, status: draft.status, reason: draft.statusReason || undefined, privateReason: draft.privateReason || undefined };
      case "TERMINATE":
        return { action, lastWorkingDay: draft.lastWorkingDay, reason: draft.terminationReason, privateReason: draft.privateReason || undefined, documentId: base.documentId, note: base.note, expectedAssignmentId: base.expectedAssignmentId };
      case "REHIRE":
        return { action, ...base, jobTitle: draft.jobTitle || undefined, departmentId: draft.departmentId || undefined, managerMemberId: draft.managerMemberId || undefined, employmentType: draft.employmentType };
      case "LEGAL_ENTITY":
        return { action, ...base, targetCompanyId: draft.targetCompanyId, departmentId: draft.departmentId, jobTitle: draft.jobTitle, managerMemberId: draft.managerMemberId || undefined, employmentType: draft.employmentType, workLocationType: draft.workLocationType || undefined, workLocation: draft.workLocation || undefined };
    }
  }

  const name = (list: Option[], id: string) => list.find((option) => option.id === id)?.name ?? null;
  const location = (type: string, place: string) => [type ? hrLabel(t, "workLocationType", type) : null, place].filter(Boolean).join(", ") || null;
  const review: Array<{ label: string; from: string | null; to: string | null }> = (() => {
    const rows: Array<{ label: string; from: string | null; to: string | null }> = [];
    const add = (label: string, from: string | null, to: string | null) => rows.push({ label, from, to });
    if (action === "LEGAL_ENTITY") add(t("recruitment.company"), t("changes.thisCompany"), target?.name ?? null);
    if (["POSITION", "LEGAL_ENTITY", "REHIRE"].includes(action)) add(t("fields.jobTitle"), employee.jobTitle, draft.jobTitle || employee.jobTitle);
    if (["DEPARTMENT", "LEGAL_ENTITY", "REHIRE"].includes(action)) add(t("columns.department"), employee.department?.name ?? null, name(departments, draft.departmentId) ?? (action === "LEGAL_ENTITY" ? null : (employee.department?.name ?? null)));
    if (["POSITION", "DEPARTMENT", "MANAGER", "LEGAL_ENTITY", "REHIRE"].includes(action)) add(t("columns.manager"), employee.manager?.fullName ?? null, draft.managerMemberId ? name(managers, draft.managerMemberId) : action === "MANAGER" || action === "LEGAL_ENTITY" ? null : (employee.manager?.fullName ?? null));
    if (action === "LOCATION") add(t("fields.workLocation"), location(employee.workLocationType ?? "", employee.workLocation ?? ""), location(draft.workLocationType, draft.workLocation));
    if (action === "EMPLOYMENT_TYPE") add(t("fields.employmentType"), hrLabel(t, "employmentType", employee.employmentType), hrLabel(t, "employmentType", draft.employmentType));
    if (action === "STATUS") add(t("columns.status"), hrLabel(t, "employmentStatus", employee.employmentStatus), hrLabel(t, "employmentStatus", draft.status));
    if (action === "TERMINATE") add(t("columns.status"), hrLabel(t, "employmentStatus", employee.employmentStatus), hrLabel(t, "employmentStatus", "ENDED"));
    if (action === "REHIRE") add(t("columns.status"), hrLabel(t, "employmentStatus", "ENDED"), hrLabel(t, "employmentStatus", effective > today ? "PLANNED" : "ACTIVE"));
    return rows;
  })();

  function submit() {
    // One request per reviewed change, whatever is clicked meanwhile (AUD-03 §6).
    if (running.current) return;
    running.current = true;
    setError(null);
    setFieldErrors({});
    startTransition(async () => {
      let result: Awaited<ReturnType<typeof employmentChangeAction>>;
      try {
        result = await employmentChangeAction(employee.id, payload());
      } catch {
        // It may or may not have been applied: say so, and never retry it (§6).
        running.current = false;
        setUnresolved(true);
        setError(OUTCOME_COPY.unknown);
        return;
      }
      running.current = false;
      if (result.ok) {
        setUnresolved(false);
        setDirty(false);
        toast({ title: serverText(result.message) ?? t("server.saved"), tone: "success" });
        onClose();
        router.refresh();
      } else {
        setError(serverText(result.error) ?? result.error);
        setFieldErrors(result.fieldErrors ?? {});
        setStep("form");
      }
    });
  }

  const field = (key: string) => fieldErrors[key]?.[0] ? <p className="text-meta text-danger-strong">{fieldErrors[key]![0]}</p> : null;
  const selectOf = (id: string, label: string, key: string, list: Option[], empty?: string) => (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <FormSelect id={id} className={selectClass} value={draft[key]} onChange={set(key)}>
        {empty !== undefined ? <option value="">{empty}</option> : null}
        {list.map((option) => (
          <option key={option.id} value={option.id}>
            {option.name}
            {option.detail ? ` — ${option.detail}` : ""}
          </option>
        ))}
      </FormSelect>
      {field(key)}
    </div>
  );

  return (
    <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
      <DialogTitle>{t(`changes.titles.${action}`)}</DialogTitle>
      <DialogDescription>
        {revisesPlan
          ? t("changes.revisesPlan")
          : action === "LEGAL_ENTITY"
            ? t("changes.transferDescription")
            : t("changes.recordedDescription")}
      </DialogDescription>

      {step === "form" ? (
        <form
          className="mt-4 space-y-3"
          onSubmit={(event) => {
            event.preventDefault();
            setStep("review");
          }}
        >
          {action === "LEGAL_ENTITY" ? selectOf("change-company", t("recruitment.company"), "targetCompanyId", options.companies) : null}
          {["POSITION", "LEGAL_ENTITY", "REHIRE"].includes(action) ? (
            <div className="space-y-1.5">
              <Label htmlFor="change-title">{t("fields.jobTitle")}</Label>
              <Input id="change-title" value={draft.jobTitle} onChange={set("jobTitle")} maxLength={120} required={action !== "REHIRE"} />
              {field("jobTitle")}
            </div>
          ) : null}
          {action === "POSITION" ? (
            <div className="space-y-1.5">
              <Label htmlFor="change-position-reason">{t("changes.kindOfChange")}</Label>
              <FormSelect id="change-position-reason" className={selectClass} value={draft.positionReason} onChange={set("positionReason")}>
                {POSITION_REASONS.map((reason) => (
                  <option key={reason} value={reason}>
                    {hrLabel(t, "assignmentReason", reason)}
                  </option>
                ))}
              </FormSelect>
            </div>
          ) : null}
          {["DEPARTMENT", "LEGAL_ENTITY", "REHIRE"].includes(action) ? selectOf("change-department", t("columns.department"), "departmentId", departments, action === "REHIRE" ? t("changes.asBefore") : t("changes.choose")) : null}
          {["POSITION", "DEPARTMENT", "MANAGER", "LEGAL_ENTITY", "REHIRE"].includes(action) ? selectOf("change-manager", t("columns.manager"), "managerMemberId", managers, t("employmentForm.noManager")) : null}
          {action === "LOCATION" || action === "LEGAL_ENTITY" ? (
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="change-location-type">{t("employmentForm.worksAt")}</Label>
                <FormSelect id="change-location-type" className={selectClass} value={draft.workLocationType} onChange={set("workLocationType")} required={action === "LOCATION"}>
                  <option value="">{action === "LOCATION" ? t("changes.choose") : t("changes.asBefore")}</option>
                  {WORK_LOCATION_TYPES.map((value) => (
                    <option key={value} value={value}>
                      {hrLabel(t, "workLocationType", value)}
                    </option>
                  ))}
                </FormSelect>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="change-location">{t("changes.place")}</Label>
                <Input id="change-location" value={draft.workLocation} onChange={set("workLocation")} maxLength={160} placeholder={t("changes.placePlaceholder")} />
              </div>
            </div>
          ) : null}
          {["EMPLOYMENT_TYPE", "LEGAL_ENTITY", "REHIRE"].includes(action) ? (
            <div className="space-y-1.5">
              <Label htmlFor="change-type">{t("fields.employmentType")}</Label>
              <FormSelect id="change-type" className={selectClass} value={draft.employmentType} onChange={set("employmentType")}>
                {EMPLOYMENT_TYPES.map((value) => (
                  <option key={value} value={value}>
                    {hrLabel(t, "employmentType", value)}
                  </option>
                ))}
              </FormSelect>
            </div>
          ) : null}
          {action === "STATUS" ? (
            <>
              <div className="space-y-1.5">
                <Label htmlFor="change-status">{t("changes.newStatus")}</Label>
                <FormSelect id="change-status" className={selectClass} value={draft.status} onChange={set("status")}>
                  {reachable.map((next) => (
                    <option key={next} value={next}>
                      {planned ? t("changes.activeStarts") : hrLabel(t, "employmentStatus", next)}
                    </option>
                  ))}
                </FormSelect>
              </div>
              {!planned ? (
                <div className="space-y-1.5">
                  <Label htmlFor="change-status-reason">{t("history.reason")}</Label>
                  <FormSelect id="change-status-reason" className={selectClass} value={draft.statusReason} onChange={set("statusReason")}>
                    <option value="">{t("changes.usualReason")}</option>
                    {STATUS_CHANGE_REASONS.map((reason) => (
                      <option key={reason} value={reason}>
                        {hrLabel(t, "statusReason", reason)}
                      </option>
                    ))}
                  </FormSelect>
                </div>
              ) : null}
            </>
          ) : null}
          {action === "TERMINATE" ? (
            <>
              {!planned ? (
                <div className="space-y-1.5">
                  <Label htmlFor="change-last-day">{t("changes.lastWorkingDay")}</Label>
                  <Input id="change-last-day" type="date" value={draft.lastWorkingDay} onChange={set("lastWorkingDay")} required />
                  {field("lastWorkingDay")}
                  {employee.guards.openLeaveRequests > 0 || employee.guards.managedEmployees > 0 ? (
                    <p className="text-meta text-fg-subtle">
                      {employee.guards.openLeaveRequests > 0 ? t("changes.openLeave", { count: employee.guards.openLeaveRequests }) : ""}
                      {employee.guards.managedEmployees > 0 ? t("changes.manages", { count: employee.guards.managedEmployees }) : ""}
                      {t("changes.nothingReassigned")}
                    </p>
                  ) : null}
                </div>
              ) : null}
              <div className="space-y-1.5">
                <Label htmlFor="change-end-reason">{t("history.reason")}</Label>
                <FormSelect id="change-end-reason" className={selectClass} value={draft.terminationReason} onChange={set("terminationReason")}>
                  {TERMINATION_REASONS.map((reason) => (
                    <option key={reason} value={reason}>
                      {hrLabel(t, "statusReason", reason)}
                    </option>
                  ))}
                </FormSelect>
              </div>
            </>
          ) : null}
          {(action === "STATUS" && !planned) || action === "TERMINATE" ? (
            <div className="space-y-1.5">
              <Label htmlFor="change-private-reason">{t("history.privateReason")}</Label>
              <Textarea id="change-private-reason" rows={2} maxLength={2000} value={draft.privateReason} onChange={set("privateReason")} placeholder={t("changes.privateReasonPlaceholder")} />
            </div>
          ) : null}
          {!revisesPlan && action !== "TERMINATE" ? (
            <div className="space-y-1.5">
              <Label htmlFor="change-effective">{action === "STATUS" && planned ? t("leaveForm.firstDay") : action === "REHIRE" ? t("changes.newStartDate") : t("compensation.effectiveFrom")}</Label>
              <Input id="change-effective" type="date" value={draft.effectiveDate} onChange={set("effectiveDate")} required />
              {field("effectiveDate")}
            </div>
          ) : null}
          <TimingNote timing={timing} effective={effective} />
          {options.documents.length > 0 ? (
            <div className="space-y-1.5">
              <Label htmlFor="change-document">{t("changes.supportingDocument")}</Label>
              <FormSelect id="change-document" className={selectClass} value={draft.documentId} onChange={set("documentId")}>
                <option value="">{t("changes.none")}</option>
                {options.documents.map((document) => (
                  <option key={document.id} value={document.id}>
                    {document.name}
                  </option>
                ))}
              </FormSelect>
              <p className="text-meta text-fg-subtle">{t("changes.linkedNotCopied")}</p>
            </div>
          ) : (
            <p className="text-meta text-fg-subtle">
              {t("changes.toLink")}{" "}
              <Link className="text-accent-strong hover:underline" href={`/hr/employees/${employee.id}/documents`}>
                {t("changes.employeesDocuments")}
              </Link>
              {t("employee.fullStop")}
            </p>
          )}
          <div className="space-y-1.5">
            <Label htmlFor="change-note">{t("changes.hrNote")}</Label>
            <Textarea id="change-note" rows={2} maxLength={2000} value={draft.note} onChange={set("note")} placeholder={t("changes.hrNotePlaceholder")} />
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
              {t("changes.review")}
            </Button>
          </div>
        </form>
      ) : (
        <div className="mt-4 space-y-4">
          {/* Values wrap inside the dialog at 320px; a very long one pans in its own region (AUD-04 §6, D-07-09, MW-10). */}
          <ScrollRegion label={t("changes.beforeAfter")}>
          <table className="w-full text-table [overflow-wrap:anywhere]" aria-label={t("changes.beforeAfter")}>
            <thead>
              <tr className="text-left text-meta text-fg-subtle">
                <th className="pb-2 font-medium">&nbsp;</th>
                <th className="pb-2 font-medium">{t("changes.now")}</th>
                <th className="pb-2 font-medium">
                  <span className="sr-only">{t("changes.becomes")}</span>
                </th>
                <th className="pb-2 font-medium">{t("changes.fromDate", { date: effective })}</th>
              </tr>
            </thead>
            <tbody>
              {review.map((row) => (
                <tr key={row.label} className="border-t border-line">
                  <th scope="row" className="py-2 pr-2 text-left font-medium text-fg-muted">
                    {row.label}
                  </th>
                  <td className="py-2">{row.from ?? "—"}</td>
                  <td className="py-2 text-fg-subtle">
                    <ArrowRight aria-hidden="true" className="size-3.5" />
                  </td>
                  <td className={row.from !== row.to ? "py-2 font-medium text-fg" : "py-2"}>{row.to ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
          </ScrollRegion>
          <TimingNote timing={timing} effective={effective} />
          {highImpact ? (
            <label className="flex items-start gap-2 text-body text-fg">
              <input type="checkbox" className="mt-1" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} data-testid="confirm-high-impact" />
              <span>{action === "TERMINATE" ? t("changes.confirmEnd", { name: employee.name.fullName, date: draft.lastWorkingDay }) : t("changes.confirmMove", { name: employee.name.fullName, company: target?.name ?? t("changes.otherCompany"), date: effective })}</span>
            </label>
          ) : null}
          {error ? (
            <p role="alert" className="text-meta text-danger-strong">
              {error}
            </p>
          ) : null}
          <div className="flex flex-wrap items-center justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => setStep("form")} disabled={pending}>
              {t("changes.back")}
            </Button>
            <Button type="button" onClick={submit} disabled={pending || (highImpact && !confirmed)}>
              {pending ? t("common.saving") : timing === "FUTURE" ? t("changes.schedule") : t("changes.apply")}
            </Button>
          </div>
        </div>
      )}
    </DialogContent>
  );
}

function TimingNote({ timing, effective }: { timing: "PLAN" | "FUTURE" | "PAST" | "TODAY"; effective: string }) {
  const t = useHrTranslations();
  if (timing === "FUTURE") {
    return (
      <p className="flex items-center gap-2 text-meta text-fg-muted">
        <CalendarClock aria-hidden="true" className="size-3.5" />
        <Badge tone="info">{t("history.scheduledFor", { date: effective })}</Badge>
        {t("changes.takesEffect")}
      </p>
    );
  }
  if (timing === "PAST") {
    return <p className="text-meta text-warning-strong">{t("changes.backdated", { date: effective })}</p>;
  }
  return null;
}
