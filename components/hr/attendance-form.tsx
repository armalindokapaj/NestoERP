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
import { acceptsTimes } from "@/lib/modules/hr/hr.status";
import { hrLabel, useHrFormAction, useHrTranslations } from "./hr-text";
import type { AttendanceStatus } from "@prisma/client";
import { localDay } from "./local-day";
import { FormSelect } from "@/components/ui/form-select";

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
  const t = useHrTranslations();
  const translatedAction = useHrFormAction(action);

  return (
    <RecordForm
      action={translatedAction}
      cancelHref={cancelHref}
      submitLabel={submitLabel}
      pendingLabel={pendingLabel}
      versionUpdatedAt={versionUpdatedAt}
      module="hr"
    >
      <FormSection
        title={lockedDate ? `${lockedDate.employee} — ${lockedDate.date}` : t("meta.attendance")}
        description={
          lockedDate
            ? t("attendanceForm.lockedDescription")
            : t("attendanceForm.description")
        }
      >
        {!lockedDate && employees ? (
          <Field label={t("columns.employee")} name="employeeId" hint={t("attendanceForm.employeeHint")}>
            <FormSelect
              id="employeeId"
              name="employeeId"
              className={selectClass}
              defaultValue={values?.employeeId ?? ""}
            >
              <option value="">{t("common.myself")}</option>
              {employees.map((employee) => (
                <option key={employee.value} value={employee.value}>
                  {employee.label}
                </option>
              ))}
            </FormSelect>
          </Field>
        ) : null}

        {!lockedDate ? (
          <Field label={t("attendance.date")} name="date" required>
            <Input
              id="date"
              name="date"
              type="date"
              required
              defaultValue={values?.date ?? localDay()}
            />
          </Field>
        ) : null}

        <Field label={t("columns.status")} name="status" required>
          <FormSelect
            id="status"
            name="status"
            className={selectClass}
            value={status}
            onChange={(event) => setStatus(event.target.value as AttendanceStatus)}
          >
            {ATTENDANCE_STATUSES.map((value) => (
              <option key={value} value={value}>
                {hrLabel(t, "attendanceStatus", value)}
              </option>
            ))}
          </FormSelect>
        </Field>

        {timed ? (
          <>
            <Field label={t("attendance.checkIn")} name="checkIn" hint={t("attendanceForm.checkInHint")}>
              <Input
                id="checkIn"
                name="checkIn"
                type="time"
                defaultValue={values?.checkIn ?? ""}
              />
            </Field>

            <Field label={t("attendance.checkOut")} name="checkOut" hint={t("attendanceForm.checkOutHint")}>
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
            {t("attendanceForm.noTimes", { status: hrLabel(t, "attendanceStatus", status) })}
          </p>
        )}

        <Field label={t("attendance.notes")} name="notes" className="sm:col-span-2">
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
