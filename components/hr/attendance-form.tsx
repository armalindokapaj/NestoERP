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
import { ATTENDANCE_STATUSES } from "@/lib/modules/hr/hr.schema";
import { acceptsTimes, attendanceStatusLabels } from "@/lib/modules/hr/hr.status";
import type { AttendanceStatus } from "@prisma/client";

export type AttendanceFormValues = {
  employeeId: string | null;
  date: string;
  status: string;
  checkIn: string | null;
  checkOut: string | null;
  notes: string | null;
};

/**
 * Record or correct a day of attendance (PRD #16 §102, §111, §323).
 *
 * Times are only offered for statuses that can carry them: an absent day with a
 * check-in time is a contradiction, and the server drops such times rather than
 * storing them (PRD #16 §105, §107). Worked hours are never entered — they are
 * derived (PRD #16 §106).
 */
export function AttendanceForm({
  action,
  employees,
  values,
  lockedDate,
  versionUpdatedAt,
  cancelHref,
  submitLabel,
  pendingLabel,
}: {
  action: (formData: FormData) => Promise<FormActionResult>;
  /** Only when recording for somebody else (PRD #16 §102). */
  employees?: SelectOption[];
  values?: AttendanceFormValues;
  /** On edit: the day and the person are fixed, only the day's facts change. */
  lockedDate?: { date: string; employee: string };
  versionUpdatedAt?: string;
  cancelHref: string;
  submitLabel: string;
  pendingLabel: string;
}) {
  const [status, setStatus] = React.useState<AttendanceStatus>(
    (values?.status as AttendanceStatus) ?? "PRESENT",
  );

  const timed = acceptsTimes(status);

  return (
    <RecordForm
      action={action}
      cancelHref={cancelHref}
      submitLabel={submitLabel}
      pendingLabel={pendingLabel}
      versionUpdatedAt={versionUpdatedAt}
    >
      <FormSection
        title={lockedDate ? `${lockedDate.employee} — ${lockedDate.date}` : "Attendance"}
        description={
          lockedDate
            ? "One record per person per day, so the day itself cannot be changed here."
            : "One record per person per day."
        }
      >
        {!lockedDate && employees ? (
          <Field label="Employee" name="employeeId" hint="Leave empty to record your own day.">
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

        {!lockedDate ? (
          <Field label="Date" name="date" required>
            <Input
              id="date"
              name="date"
              type="date"
              required
              defaultValue={values?.date ?? new Date().toISOString().slice(0, 10)}
            />
          </Field>
        ) : null}

        <Field label="Status" name="status" required>
          <select
            id="status"
            name="status"
            className={selectClass}
            value={status}
            onChange={(event) => setStatus(event.target.value as AttendanceStatus)}
          >
            {ATTENDANCE_STATUSES.map((value) => (
              <option key={value} value={value}>
                {attendanceStatusLabels[value]}
              </option>
            ))}
          </select>
        </Field>

        {timed ? (
          <>
            <Field label="Check in" name="checkIn" hint="24-hour time, such as 09:00.">
              <Input
                id="checkIn"
                name="checkIn"
                type="time"
                defaultValue={values?.checkIn ?? ""}
              />
            </Field>

            <Field label="Check out" name="checkOut" hint="Worked hours are calculated from these.">
              <Input
                id="checkOut"
                name="checkOut"
                type="time"
                defaultValue={values?.checkOut ?? ""}
              />
            </Field>
          </>
        ) : (
          <p className="self-end text-meta text-fg-subtle sm:col-span-2">
            {attendanceStatusLabels[status]} days do not carry check-in and check-out times.
          </p>
        )}

        <Field label="Notes" name="notes" className="sm:col-span-2">
          <Textarea
            id="notes"
            name="notes"
            rows={3}
            maxLength={1000}
            defaultValue={values?.notes ?? ""}
          />
        </Field>
      </FormSection>
    </RecordForm>
  );
}
