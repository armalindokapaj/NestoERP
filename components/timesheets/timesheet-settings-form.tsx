"use client";

import * as React from "react";
import { useRouter } from "next/navigation";

import { selectClass } from "@/components/forms/record-form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/components/ui/toast";
import { PersonLink } from "@/components/people/person-link";
import type { ApproverAssignmentDTO } from "@/lib/modules/timesheets/timesheet.approvers";
import { formatMinutes, parseDuration } from "@/lib/modules/timesheets/timesheet.time";
import type { TimesheetPerson, TimesheetSettingsDTO } from "@/lib/modules/timesheets/timesheet.types";
import { cn } from "@/lib/utils/cn";
import { failureMessage, timesheetApi } from "./timesheet-api";

/**
 * Company timesheet rules and approvers (PRD #42 §12, §30, §35, §39, §59,
 * §73, §74, §101, §217). Plain policy, no payroll engine (§218).
 */

const WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

function ToggleRow({ id, label, hint, checked, onChange }: { id: string; label: string; hint: string; checked: boolean; onChange: (value: boolean) => void }) {
  return (
    <div className="flex items-start justify-between gap-4 py-3">
      <label htmlFor={id} className="min-w-0">
        <span className="block text-table font-medium text-fg">{label}</span>
        <span className="block text-meta text-fg-muted">{hint}</span>
      </label>
      <Switch id={id} checked={checked} onCheckedChange={onChange} />
    </div>
  );
}

export function TimesheetSettingsForm({ initial }: { initial: TimesheetSettingsDTO }) {
  const toast = useToast();
  const router = useRouter();
  const [state, setState] = React.useState({
    ...initial,
    daily: formatMinutes(initial.standardDailyMinutes),
    weekly: formatMinutes(initial.standardWeeklyMinutes),
  });
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [pending, setPending] = React.useState(false);
  const set = <K extends keyof typeof state>(key: K, value: (typeof state)[K]) => setState((current) => ({ ...current, [key]: value }));

  async function save(event: React.FormEvent) {
    event.preventDefault();
    const daily = parseDuration(state.daily);
    const weekly = parseDuration(state.weekly.replace(/h$/, ""));
    const found: Record<string, string> = {};
    if (!daily || daily < 60 || daily > 1440) found.daily = "Enter a standard day between 1 and 24 hours.";
    const weeklyMinutes = weekly ?? (Number(state.weekly) > 0 ? Number(state.weekly) * 60 : null);
    if (!weeklyMinutes || weeklyMinutes < 60) found.weekly = "Enter the standard week in hours.";
    if (Boolean(state.submitDay) !== Boolean(state.submitTime)) found.deadline = "Set both the deadline day and time, or neither.";
    setErrors(found);
    if (Object.keys(found).length) return;
    setPending(true);
    try {
      await timesheetApi("/api/timesheets/settings", {
        method: "PUT",
        body: {
          weekStartsOn: state.weekStartsOn,
          standardDailyMinutes: daily,
          standardWeeklyMinutes: weeklyMinutes,
          incrementMinutes: state.incrementMinutes,
          enforceIncrement: state.enforceIncrement,
          backdateDays: state.backdateDays,
          submitDay: state.submitDay || null,
          submitTime: state.submitDay ? state.submitTime || null : null,
          descriptionsRequired: state.descriptionsRequired,
          membersSetBillable: state.membersSetBillable,
        },
      });
      toast({ title: "Timesheet settings saved", tone: "success" });
      router.refresh();
    } catch (error) {
      toast({ title: failureMessage(error), tone: "danger" });
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={save} className="nesto-card divide-y divide-line px-5" aria-label="Timesheet settings" noValidate>
      <div className="grid gap-4 py-4 sm:grid-cols-2 lg:grid-cols-4">
        <label>
          <span className="text-table font-medium text-fg">Week starts on</span>
          <select className={cn(selectClass, "mt-1.5")} value={state.weekStartsOn} onChange={(change) => set("weekStartsOn", Number(change.target.value))}>
            {WEEKDAYS.map((day, index) => (
              <option key={day} value={index + 1}>
                {day}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span className="text-table font-medium text-fg">Standard day</span>
          <Input className="mt-1.5 tabular-nums" value={state.daily} onChange={(change) => set("daily", change.target.value)} aria-invalid={Boolean(errors.daily)} />
          {errors.daily ? <span className="mt-1 block text-meta text-danger-strong">{errors.daily}</span> : null}
        </label>
        <label>
          <span className="text-table font-medium text-fg">Standard week</span>
          <Input className="mt-1.5 tabular-nums" value={state.weekly} onChange={(change) => set("weekly", change.target.value)} aria-invalid={Boolean(errors.weekly)} />
          {errors.weekly ? <span className="mt-1 block text-meta text-danger-strong">{errors.weekly}</span> : <span className="mt-1 block text-meta text-fg-subtle">Time above it shows as overtime — never pay.</span>}
        </label>
        <label>
          <span className="text-table font-medium text-fg">Backdating</span>
          <select className={cn(selectClass, "mt-1.5")} value={state.backdateDays} onChange={(change) => set("backdateDays", Number(change.target.value))}>
            {[0, 3, 7, 14, 21, 31, 62].map((days) => (
              <option key={days} value={days}>
                {days === 0 ? "Today only" : `${days} days back`}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="grid gap-4 py-4 sm:grid-cols-2 lg:grid-cols-4">
        <label>
          <span className="text-table font-medium text-fg">Duration steps</span>
          <select className={cn(selectClass, "mt-1.5")} value={state.incrementMinutes} onChange={(change) => set("incrementMinutes", Number(change.target.value))}>
            {[5, 10, 15, 30, 60].map((minutes) => (
              <option key={minutes} value={minutes}>
                {minutes} minutes
              </option>
            ))}
          </select>
        </label>
        <label>
          <span className="text-table font-medium text-fg">Submission deadline</span>
          <select className={cn(selectClass, "mt-1.5")} value={state.submitDay ?? 0} onChange={(change) => set("submitDay", Number(change.target.value) || null)} aria-invalid={Boolean(errors.deadline)}>
            <option value={0}>No deadline</option>
            {WEEKDAYS.map((day, index) => (
              <option key={day} value={index + 1}>
                {day}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span className="text-table font-medium text-fg">Deadline time</span>
          <Input type="time" className="mt-1.5" value={state.submitTime ?? ""} onChange={(change) => set("submitTime", change.target.value || null)} disabled={!state.submitDay} />
        </label>
        <p className="self-end pb-2 text-meta text-fg-muted">{errors.deadline ?? `A week is due on the first ${state.submitDay ? WEEKDAYS[state.submitDay - 1] : "chosen day"} from its fifth day, in ${state.timezone}.`}</p>
      </div>

      <div>
        <ToggleRow id="enforce-increment" label="Only accept whole steps" hint="Refuse durations that are not a multiple of the step." checked={state.enforceIncrement} onChange={(value) => set("enforceIncrement", value)} />
        <ToggleRow id="descriptions-required" label="Descriptions required" hint="Every entry needs a description before a week can be submitted." checked={state.descriptionsRequired} onChange={(value) => set("descriptionsRequired", value)} />
        <ToggleRow id="members-billable" label="Members set billable" hint="Otherwise billable follows the work type, and only approvers change it." checked={state.membersSetBillable} onChange={(value) => set("membersSetBillable", value)} />
      </div>

      <div className="flex justify-end py-3">
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? "Saving…" : "Save settings"}
        </Button>
      </div>
    </form>
  );
}

export function ApproverAssignments({ assignments, options }: { assignments: ApproverAssignmentDTO[]; options: TimesheetPerson[] }) {
  const toast = useToast();
  const router = useRouter();
  const [pending, setPending] = React.useState<string | null>(null);
  const [filter, setFilter] = React.useState("");
  const shown = assignments.filter((row) => !filter || `${row.member.name} ${row.member.department ?? ""}`.toLowerCase().includes(filter.toLowerCase()));

  async function change(memberId: string, approverMemberId: string) {
    setPending(memberId);
    try {
      await timesheetApi("/api/timesheets/approvers", { method: "PUT", body: { memberId, approverMemberId: approverMemberId || null } });
      toast({ title: approverMemberId ? "Approver set" : "Approver cleared", tone: "success" });
      router.refresh();
    } catch (error) {
      toast({ title: failureMessage(error), tone: "danger" });
    } finally {
      setPending(null);
    }
  }

  return (
    <section className="nesto-card" aria-labelledby="approvers-title">
      <div className="flex flex-wrap items-center gap-3 px-5 pt-4">
        <div className="min-w-0 flex-1">
          <h2 id="approvers-title" className="text-card font-semibold text-fg">
            Approvers
          </h2>
          <p className="text-meta text-fg-muted">Each person&apos;s weeks go to one approver. With none set, their department manager decides.</p>
        </div>
        <Input type="search" placeholder="Find a person…" value={filter} onChange={(change) => setFilter(change.target.value)} className="h-9 w-56" aria-label="Find a person" />
      </div>
      <div className="mt-3 overflow-x-auto">
        <table className="w-full min-w-[640px] border-collapse text-table" data-testid="approver-assignments">
          <thead>
            <tr className="border-y border-line text-left text-meta text-fg-muted">
              <th scope="col" className="px-5 py-2 font-medium">Person</th>
              <th scope="col" className="px-3 py-2 font-medium">Designated approver</th>
              <th scope="col" className="px-5 py-2 font-medium">Decides now</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {shown.map((row) => (
              <tr key={row.member.memberId}>
                <th scope="row" className="px-5 py-2 text-left font-normal">
                  <span className="block font-medium text-fg">
                    <PersonLink memberId={row.member.memberId} name={row.member.name} />
                  </span>
                  <span className="block text-meta text-fg-muted">{[row.member.jobTitle, row.member.department].filter(Boolean).join(" · ") || "—"}</span>
                </th>
                <td className="px-3 py-2">
                  <select
                    className={cn(selectClass, "h-9")}
                    value={row.assigned?.memberId ?? ""}
                    onChange={(event) => void change(row.member.memberId, event.target.value)}
                    disabled={pending === row.member.memberId}
                    aria-label={`Approver for ${row.member.name}`}
                  >
                    <option value="">Department manager</option>
                    {options
                      .filter((option) => option.memberId !== row.member.memberId)
                      .map((option) => (
                        <option key={option.memberId} value={option.memberId}>
                          {option.name}
                        </option>
                      ))}
                  </select>
                </td>
                <td className="px-5 py-2 text-fg-muted">
                  {row.effective ? (
                    <>
                      <PersonLink memberId={row.effective.memberId} name={row.effective.name} />
                      {row.effective.source === "DEPARTMENT" ? <span className="ml-1 text-meta text-fg-subtle">(department)</span> : null}
                    </>
                  ) : (
                    <span className="text-warning-strong">Nobody — cannot submit</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
