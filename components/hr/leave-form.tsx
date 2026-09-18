"use client";

import * as React from "react";

import {
  Field,
  FormSection,
  RecordForm,
  selectClass,
  type FormActionResult,
  type SelectOption,
} from "@/components/forms/record-form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { LEAVE_TYPES } from "@/lib/modules/hr/hr.schema";
import { leaveTypeLabels } from "@/lib/modules/hr/hr.status";
import { countWorkingDays } from "@/lib/modules/hr/hr.calendar";

export type LeaveFormValues = {
  employeeId: string | null;
  leaveType: string;
  startDate: string;
  endDate: string;
  reason: string | null;
};

/**
 * Request leave (PRD #16 §75, §322).
 *
 * The day count shown while typing is a courtesy. The server counts the days
 * again with the same helper before storing anything, so the figure on the
 * record is never the one the browser arrived at (PRD #16 §77).
 */
export function LeaveForm({
  action,
  employees,
  values,
  versionUpdatedAt,
  cancelHref,
  submitLabel,
  pendingLabel,
}: {
  action: (formData: FormData) => Promise<FormActionResult>;
  /** Only when filing on somebody else's behalf (PRD #16 §191). */
  employees?: SelectOption[];
  values?: LeaveFormValues;
  versionUpdatedAt?: string;
  cancelHref: string;
  submitLabel: string;
  pendingLabel: string;
}) {
  const todayValue = new Date().toISOString().slice(0, 10);
  const [startDate, setStartDate] = React.useState(values?.startDate ?? todayValue);
  const [endDate, setEndDate] = React.useState(values?.endDate ?? todayValue);

  const days = workingDayCount(startDate, endDate);

  return (
    <RecordForm
      action={action}
      cancelHref={cancelHref}
      submitLabel={submitLabel}
      pendingLabel={pendingLabel}
      versionUpdatedAt={versionUpdatedAt}
    >
      <FormSection
        title="Leave request"
        description="Saved as a draft. It reaches an approver once you submit it."
      >
        {employees ? (
          <Field
            label="Employee"
            name="employeeId"
            required
            className="sm:col-span-2"
            hint="Leave empty to request your own leave."
          >
            <select
              id="employeeId"
              name="employeeId"
              className={selectClass}
              defaultValue={values?.employeeId ?? ""}
            >
              <option value="">Myself</option>
              {employees.map((employee) => (
                <option key={employee.value} value={employee.value}>
                  {employee.label}
                </option>
              ))}
            </select>
          </Field>
        ) : null}

        <Field label="Leave type" name="leaveType" required>
          <select
            id="leaveType"
            name="leaveType"
            className={selectClass}
            defaultValue={values?.leaveType ?? "ANNUAL"}
          >
            {LEAVE_TYPES.map((type) => (
              <option key={type} value={type}>
                {leaveTypeLabels[type]}
              </option>
            ))}
          </select>
        </Field>

        <div className="flex items-end">
          <p aria-live="polite" className="text-table text-fg-muted">
            {days === null ? (
              "Choose a date range."
            ) : (
              <>
                <span className="font-semibold tabular-nums text-fg">{days}</span> working{" "}
                {days === 1 ? "day" : "days"}, weekends excluded
              </>
            )}
          </p>
        </div>

        <Field label="First day" name="startDate" required>
          <Input
            id="startDate"
            name="startDate"
            type="date"
            required
            value={startDate}
            onChange={(event) => setStartDate(event.target.value)}
          />
        </Field>

        <Field label="Last day" name="endDate" required>
          <Input
            id="endDate"
            name="endDate"
            type="date"
            required
            value={endDate}
            onChange={(event) => setEndDate(event.target.value)}
          />
        </Field>

        <Field
          label="Reason"
          name="reason"
          className="sm:col-span-2"
          hint="Optional. Only you and readers with the reason permission can see it."
        >
          <Textarea
            id="reason"
            name="reason"
            rows={3}
            maxLength={2000}
            defaultValue={values?.reason ?? ""}
          />
        </Field>
      </FormSection>
    </RecordForm>
  );
}

function workingDayCount(start: string, end: string): number | null {
  if (!start || !end) return null;
  const from = new Date(`${start}T12:00:00.000Z`);
  const to = new Date(`${end}T12:00:00.000Z`);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) return null;
  if (to.getTime() < from.getTime()) return null;
  return countWorkingDays(from, to);
}
