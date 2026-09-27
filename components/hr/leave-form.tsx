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
import { hrLabel, useHrFormAction, useHrTranslations } from "./hr-text";
import { countWorkingDays } from "@/lib/modules/hr/hr.calendar";
import { localDay } from "./local-day";

export type LeaveFormValues = {
  employeeId: string | null;
  leaveType: string;
  startDate: string;
  endDate: string;
  reason: string | null;
  /**
   * The reason is private to the requester and to HR readers of reasons
   * (PRD #16 §95). A reader who is not shown it gets no reason field, so their
   * save leaves it as it is rather than erasing it (AUD-09 §5, FV-10).
   */
  reasonHidden?: boolean;
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
  const todayValue = localDay();
  const [startDate, setStartDate] = React.useState(values?.startDate ?? todayValue);
  const [endDate, setEndDate] = React.useState(values?.endDate ?? todayValue);

  const days = workingDayCount(startDate, endDate);
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
        title={t("meta.leaveRequest")}
        description={t("leaveForm.description")}
      >
        {employees ? (
          <Field
            label={t("columns.employee")}
            name="employeeId"
            className="sm:col-span-2"
            hint={t("leaveForm.employeeHint")}
          >
            <select
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
            </select>
          </Field>
        ) : null}

        <Field label={t("reports.leaveType")} name="leaveType" required>
          <select
            id="leaveType"
            name="leaveType"
            className={selectClass}
            defaultValue={values?.leaveType ?? "ANNUAL"}
          >
            {LEAVE_TYPES.map((type) => (
              <option key={type} value={type}>
                {hrLabel(t, "leaveType", type)}
              </option>
            ))}
          </select>
        </Field>

        <div className="flex items-end">
          <p aria-live="polite" className="text-table text-fg-muted">
            {days === null ? (
              t("leaveForm.chooseRange")
            ) : (
              <>
                <span className="font-semibold tabular-nums text-fg">{days}</span>{" "}
                {t("leaveForm.workingDays", { count: days })}
              </>
            )}
          </p>
        </div>

        <Field label={t("leaveForm.firstDay")} name="startDate" required>
          <Input
            id="startDate"
            name="startDate"
            type="date"
            required
            value={startDate}
            onChange={(event) => setStartDate(event.target.value)}
          />
        </Field>

        <Field label={t("progress.lastDay")} name="endDate" required>
          <Input
            id="endDate"
            name="endDate"
            type="date"
            required
            value={endDate}
            onChange={(event) => setEndDate(event.target.value)}
          />
        </Field>

        {values?.reasonHidden ? (
          <p className="text-meta text-fg-subtle sm:col-span-2" data-testid="leave-reason-private">
            {t("leaveForm.reasonPrivate")}
          </p>
        ) : (
          <Field
            label={t("history.reason")}
            name="reason"
            className="sm:col-span-2"
            hint={t("leaveForm.reasonHint")}
          >
            <Textarea
              id="reason"
              name="reason"
              rows={3}
              maxLength={2000}
              defaultValue={values?.reason ?? ""}
            />
          </Field>
        )}
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
