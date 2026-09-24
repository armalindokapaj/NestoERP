"use client";

import * as React from "react";
import Link from "@/components/navigation/nav-link";
import { useRouter } from "next/navigation";
import { ArrowRight, CalendarClock, ChevronDown, PenLine } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/toast";
import { employmentChangeAction } from "@/lib/actions/hr";
import { addDays } from "@/lib/modules/hr/employment/employment.dates";
import { POSITION_REASONS, STATUS_CHANGE_REASONS, TERMINATION_REASONS, assignmentReasonLabels, statusReasonLabels, workLocationTypeLabels } from "@/lib/modules/hr/employment/employment.labels";
import type { EmploymentChangeOptionsDTO, Option } from "@/lib/modules/hr/employment/employment.options";
import { canTransitionEmployment, employmentStatusLabels, employmentTypeLabels } from "@/lib/modules/hr/hr.status";
import type { EmployeeDetailDTO } from "@/lib/modules/hr/hr.types";

const selectClass =
  "h-10 w-full rounded-md border border-line bg-surface px-3 text-body text-fg transition-colors hover:border-line-strong focus:border-accent focus:outline-none focus:ring-2 focus:ring-ring/20";

type Action = "POSITION" | "DEPARTMENT" | "LEGAL_ENTITY" | "MANAGER" | "LOCATION" | "EMPLOYMENT_TYPE" | "STATUS" | "TERMINATE" | "REHIRE";

const TITLES: Record<Action, string> = {
  POSITION: "Change position or title",
  DEPARTMENT: "Transfer to another department",
  LEGAL_ENTITY: "Transfer to another company",
  MANAGER: "Change manager",
  LOCATION: "Change work location",
  EMPLOYMENT_TYPE: "Change employment type",
  STATUS: "Change status",
  TERMINATE: "End employment",
  REHIRE: "Rehire",
};

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

  const items: Array<{ action: Action; label: string; show: boolean }> = [
    { action: "STATUS", label: planned ? "Start employment" : "Change status", show: caps.canChangeStatus && !ended },
    { action: "POSITION", label: planned ? "Change planned position" : "Promote or change title", show: caps.canChangePosition },
    { action: "DEPARTMENT", label: "Transfer department", show: caps.canTransferDepartment },
    { action: "LEGAL_ENTITY", label: "Transfer to another company", show: caps.canTransferCompany && options.companies.length > 0 },
    { action: "MANAGER", label: "Change manager", show: caps.canChangeManager },
    { action: "LOCATION", label: "Change work location", show: caps.canChangeLocation },
    { action: "EMPLOYMENT_TYPE", label: "Change employment type", show: caps.canChangeEmploymentType },
    { action: "TERMINATE", label: planned ? "Withdraw planned employment" : "End employment", show: caps.canChangeStatus && !ended },
    { action: "REHIRE", label: "Rehire", show: caps.canChangeStatus && ended },
  ];
  const visible = items.filter((item) => item.show);

  return (
    <>
      {employee.capabilities.canEditEmployment ? (
        <Button asChild variant="secondary" size="sm">
          <Link href={`/hr/employees/${employee.id}/employment/edit`}>
            <PenLine aria-hidden="true" />
            Edit details
          </Link>
        </Button>
      ) : null}
      {visible.length > 0 ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button size="sm" data-testid="employment-change-menu">
              Change employment
              <ChevronDown aria-hidden="true" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuLabel>{planned ? "Planned employment" : ended ? "Ended employment" : "Dated changes"}</DropdownMenuLabel>
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

function ChangeDialog({ action, employee, options, today, onClose }: { action: Action; employee: EmployeeDetailDTO; options: EmploymentChangeOptionsDTO; today: string; onClose: () => void }) {
  const router = useRouter();
  const toast = useToast();
  const [pending, startTransition] = React.useTransition();
  const planned = employee.employmentStatus === "PLANNED";
  const revisesPlan = planned && action !== "STATUS";
  const reachable = (["ACTIVE", "ON_LEAVE", "SUSPENDED"] as const).filter((next) => next !== employee.employmentStatus && canTransitionEmployment(employee.employmentStatus, next) && (!planned || next === "ACTIVE"));

  const [draft, setDraft] = React.useState<Draft>(() => ({
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
  const [step, setStep] = React.useState<"form" | "review">("form");
  const [confirmed, setConfirmed] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = React.useState<Record<string, string[]>>({});
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
  const location = (type: string, place: string) => [type ? workLocationTypeLabels[type as keyof typeof workLocationTypeLabels] : null, place].filter(Boolean).join(", ") || null;
  const review: Array<{ label: string; from: string | null; to: string | null }> = (() => {
    const rows: Array<{ label: string; from: string | null; to: string | null }> = [];
    const add = (label: string, from: string | null, to: string | null) => rows.push({ label, from, to });
    if (action === "LEGAL_ENTITY") add("Company", "This company", target?.name ?? null);
    if (["POSITION", "LEGAL_ENTITY", "REHIRE"].includes(action)) add("Job title", employee.jobTitle, draft.jobTitle || employee.jobTitle);
    if (["DEPARTMENT", "LEGAL_ENTITY", "REHIRE"].includes(action)) add("Department", employee.department?.name ?? null, name(departments, draft.departmentId) ?? (action === "LEGAL_ENTITY" ? null : (employee.department?.name ?? null)));
    if (["POSITION", "DEPARTMENT", "MANAGER", "LEGAL_ENTITY", "REHIRE"].includes(action)) add("Manager", employee.manager?.fullName ?? null, draft.managerMemberId ? name(managers, draft.managerMemberId) : action === "MANAGER" || action === "LEGAL_ENTITY" ? null : (employee.manager?.fullName ?? null));
    if (action === "LOCATION") add("Work location", location(employee.workLocationType ?? "", employee.workLocation ?? ""), location(draft.workLocationType, draft.workLocation));
    if (action === "EMPLOYMENT_TYPE") add("Employment type", employmentTypeLabels[employee.employmentType], employmentTypeLabels[draft.employmentType as keyof typeof employmentTypeLabels]);
    if (action === "STATUS") add("Status", employmentStatusLabels[employee.employmentStatus], employmentStatusLabels[draft.status as keyof typeof employmentStatusLabels]);
    if (action === "TERMINATE") add("Status", employmentStatusLabels[employee.employmentStatus], employmentStatusLabels.ENDED);
    if (action === "REHIRE") add("Status", employmentStatusLabels.ENDED, effective > today ? employmentStatusLabels.PLANNED : employmentStatusLabels.ACTIVE);
    return rows;
  })();

  function submit() {
    setError(null);
    setFieldErrors({});
    startTransition(async () => {
      const result = await employmentChangeAction(employee.id, payload());
      if (result.ok) {
        toast({ title: result.message ?? "Saved.", tone: "success" });
        onClose();
        router.refresh();
      } else {
        setError(result.error);
        setFieldErrors(result.fieldErrors ?? {});
        setStep("form");
      }
    });
  }

  const field = (key: string) => fieldErrors[key]?.[0] ? <p className="text-meta text-danger-strong">{fieldErrors[key]![0]}</p> : null;
  const selectOf = (id: string, label: string, key: string, list: Option[], empty?: string) => (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <select id={id} className={selectClass} value={draft[key]} onChange={set(key)}>
        {empty !== undefined ? <option value="">{empty}</option> : null}
        {list.map((option) => (
          <option key={option.id} value={option.id}>
            {option.name}
            {option.detail ? ` — ${option.detail}` : ""}
          </option>
        ))}
      </select>
      {field(key)}
    </div>
  );

  return (
    <Dialog open onOpenChange={(open) => (!open ? onClose() : undefined)}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogTitle>{TITLES[action]}</DialogTitle>
        <DialogDescription>
          {revisesPlan
            ? "The employment has not started, so this revises the plan."
            : action === "LEGAL_ENTITY"
              ? "Their employment here ends the day before, and one begins in the other company. Company access is managed in Team."
              : "Recorded in the employment history from the day it takes effect. Company access is managed in Team, and is not touched here."}
        </DialogDescription>

        {step === "form" ? (
          <form
            className="mt-4 space-y-3"
            onSubmit={(event) => {
              event.preventDefault();
              setStep("review");
            }}
          >
            {action === "LEGAL_ENTITY" ? selectOf("change-company", "Company", "targetCompanyId", options.companies) : null}
            {["POSITION", "LEGAL_ENTITY", "REHIRE"].includes(action) ? (
              <div className="space-y-1.5">
                <Label htmlFor="change-title">Job title</Label>
                <Input id="change-title" value={draft.jobTitle} onChange={set("jobTitle")} maxLength={120} required={action !== "REHIRE"} />
                {field("jobTitle")}
              </div>
            ) : null}
            {action === "POSITION" ? (
              <div className="space-y-1.5">
                <Label htmlFor="change-position-reason">Kind of change</Label>
                <select id="change-position-reason" className={selectClass} value={draft.positionReason} onChange={set("positionReason")}>
                  {POSITION_REASONS.map((reason) => (
                    <option key={reason} value={reason}>
                      {assignmentReasonLabels[reason]}
                    </option>
                  ))}
                </select>
              </div>
            ) : null}
            {["DEPARTMENT", "LEGAL_ENTITY", "REHIRE"].includes(action) ? selectOf("change-department", "Department", "departmentId", departments, action === "REHIRE" ? "As before" : "Choose…") : null}
            {["POSITION", "DEPARTMENT", "MANAGER", "LEGAL_ENTITY", "REHIRE"].includes(action) ? selectOf("change-manager", "Manager", "managerMemberId", managers, "No manager") : null}
            {action === "LOCATION" || action === "LEGAL_ENTITY" ? (
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="change-location-type">Works at</Label>
                  <select id="change-location-type" className={selectClass} value={draft.workLocationType} onChange={set("workLocationType")} required={action === "LOCATION"}>
                    <option value="">{action === "LOCATION" ? "Choose…" : "As before"}</option>
                    {Object.entries(workLocationTypeLabels).map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="change-location">Place</Label>
                  <Input id="change-location" value={draft.workLocation} onChange={set("workLocation")} maxLength={160} placeholder="Tirana office, site name…" />
                </div>
              </div>
            ) : null}
            {["EMPLOYMENT_TYPE", "LEGAL_ENTITY", "REHIRE"].includes(action) ? (
              <div className="space-y-1.5">
                <Label htmlFor="change-type">Employment type</Label>
                <select id="change-type" className={selectClass} value={draft.employmentType} onChange={set("employmentType")}>
                  {Object.entries(employmentTypeLabels).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </div>
            ) : null}
            {action === "STATUS" ? (
              <>
                <div className="space-y-1.5">
                  <Label htmlFor="change-status">New status</Label>
                  <select id="change-status" className={selectClass} value={draft.status} onChange={set("status")}>
                    {reachable.map((next) => (
                      <option key={next} value={next}>
                        {planned ? "Active — employment starts" : employmentStatusLabels[next]}
                      </option>
                    ))}
                  </select>
                </div>
                {!planned ? (
                  <div className="space-y-1.5">
                    <Label htmlFor="change-status-reason">Reason</Label>
                    <select id="change-status-reason" className={selectClass} value={draft.statusReason} onChange={set("statusReason")}>
                      <option value="">Usual for this change</option>
                      {STATUS_CHANGE_REASONS.map((reason) => (
                        <option key={reason} value={reason}>
                          {statusReasonLabels[reason]}
                        </option>
                      ))}
                    </select>
                  </div>
                ) : null}
              </>
            ) : null}
            {action === "TERMINATE" ? (
              <>
                {!planned ? (
                  <div className="space-y-1.5">
                    <Label htmlFor="change-last-day">Last working day</Label>
                    <Input id="change-last-day" type="date" value={draft.lastWorkingDay} onChange={set("lastWorkingDay")} required />
                    {field("lastWorkingDay")}
                    {employee.guards.openLeaveRequests > 0 || employee.guards.managedEmployees > 0 ? (
                      <p className="text-meta text-fg-subtle">
                        {employee.guards.openLeaveRequests > 0 ? `${employee.guards.openLeaveRequests} open leave request(s). ` : ""}
                        {employee.guards.managedEmployees > 0 ? `Manages ${employee.guards.managedEmployees} employee(s). ` : ""}
                        Nothing is reassigned automatically.
                      </p>
                    ) : null}
                  </div>
                ) : null}
                <div className="space-y-1.5">
                  <Label htmlFor="change-end-reason">Reason</Label>
                  <select id="change-end-reason" className={selectClass} value={draft.terminationReason} onChange={set("terminationReason")}>
                    {TERMINATION_REASONS.map((reason) => (
                      <option key={reason} value={reason}>
                        {statusReasonLabels[reason]}
                      </option>
                    ))}
                  </select>
                </div>
              </>
            ) : null}
            {(action === "STATUS" && !planned) || action === "TERMINATE" ? (
              <div className="space-y-1.5">
                <Label htmlFor="change-private-reason">Private reason</Label>
                <Textarea id="change-private-reason" rows={2} maxLength={2000} value={draft.privateReason} onChange={set("privateReason")} placeholder="Optional. Seen only by HR with private access — never by colleagues or in notifications." />
              </div>
            ) : null}
            {!revisesPlan && action !== "TERMINATE" ? (
              <div className="space-y-1.5">
                <Label htmlFor="change-effective">{action === "STATUS" && planned ? "First day" : action === "REHIRE" ? "New start date" : "Effective from"}</Label>
                <Input id="change-effective" type="date" value={draft.effectiveDate} onChange={set("effectiveDate")} required />
                {field("effectiveDate")}
              </div>
            ) : null}
            <TimingNote timing={timing} effective={effective} />
            {options.documents.length > 0 ? (
              <div className="space-y-1.5">
                <Label htmlFor="change-document">Supporting document</Label>
                <select id="change-document" className={selectClass} value={draft.documentId} onChange={set("documentId")}>
                  <option value="">None</option>
                  {options.documents.map((document) => (
                    <option key={document.id} value={document.id}>
                      {document.name}
                    </option>
                  ))}
                </select>
                <p className="text-meta text-fg-subtle">Linked, not copied: the document stays in the employee&apos;s files.</p>
              </div>
            ) : (
              <p className="text-meta text-fg-subtle">
                To link a contract or letter, first file it in the{" "}
                <Link className="text-accent-strong hover:underline" href={`/hr/employees/${employee.id}/documents`}>
                  employee&apos;s documents
                </Link>
                .
              </p>
            )}
            <div className="space-y-1.5">
              <Label htmlFor="change-note">HR note</Label>
              <Textarea id="change-note" rows={2} maxLength={2000} value={draft.note} onChange={set("note")} placeholder="Optional. HR only." />
            </div>
            {error ? (
              <p role="alert" className="text-meta text-danger-strong">
                {error}
              </p>
            ) : null}
            <div className="flex flex-wrap items-center justify-end gap-2">
              <Button type="button" variant="secondary" onClick={onClose} disabled={pending}>
                Cancel
              </Button>
              <Button type="submit" disabled={pending}>
                Review
              </Button>
            </div>
          </form>
        ) : (
          <div className="mt-4 space-y-4">
            <table className="w-full text-table" aria-label="Before and after">
              <thead>
                <tr className="text-left text-meta text-fg-subtle">
                  <th className="pb-2 font-medium">&nbsp;</th>
                  <th className="pb-2 font-medium">Now</th>
                  <th className="pb-2 font-medium">
                    <span className="sr-only">becomes</span>
                  </th>
                  <th className="pb-2 font-medium">From {effective}</th>
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
            <TimingNote timing={timing} effective={effective} />
            {highImpact ? (
              <label className="flex items-start gap-2 text-body text-fg">
                <input type="checkbox" className="mt-1" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} data-testid="confirm-high-impact" />
                <span>{action === "TERMINATE" ? `I confirm ${employee.name.fullName}'s employment ends after ${draft.lastWorkingDay}.` : `I confirm ${employee.name.fullName} moves to ${target?.name ?? "the other company"} from ${effective}.`}</span>
              </label>
            ) : null}
            {error ? (
              <p role="alert" className="text-meta text-danger-strong">
                {error}
              </p>
            ) : null}
            <div className="flex flex-wrap items-center justify-end gap-2">
              <Button type="button" variant="secondary" onClick={() => setStep("form")} disabled={pending}>
                Back
              </Button>
              <Button type="button" onClick={submit} disabled={pending || (highImpact && !confirmed)}>
                {pending ? "Saving…" : timing === "FUTURE" ? "Schedule" : "Apply"}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function TimingNote({ timing, effective }: { timing: "PLAN" | "FUTURE" | "PAST" | "TODAY"; effective: string }) {
  if (timing === "FUTURE") {
    return (
      <p className="flex items-center gap-2 text-meta text-fg-muted">
        <CalendarClock aria-hidden="true" className="size-3.5" />
        <Badge tone="info">Scheduled for {effective}</Badge>
        It takes effect on that day, and can be cancelled until then.
      </p>
    );
  }
  if (timing === "PAST") {
    return <p className="text-meta text-warning-strong">Backdated to {effective}: this needs the right to correct history, and can only fall within the current period.</p>;
  }
  return null;
}
