"use client";

import * as React from "react";

import {
  Field,
  FormSection,
  RecordForm,
  selectClass,
  type FormActionResult,
} from "@/components/forms/record-form";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { PPE_ITEMS } from "@/lib/modules/hse/hse.status";
import type { Option } from "./hse-forms";
import { localDay } from "@/components/hr/local-day";
import { CurrentOption } from "./hse-forms";

/**
 * A PPE check (PRD #22 §159, §160, §161).
 *
 * Each item is yes / no / not looked at, and "not looked at" is the default.
 * That third state is the point: a check that recorded nothing must not be
 * filed as a pass, and a check of one person's harness should not imply
 * anything about their gloves.
 *
 * The subject is optional, because a check may be about one person or about an
 * area (§161). It never touches Inventory (§162).
 */

export type PpeFormValues = {
  projectId: string;
  checkDate: string;
  locationText: string;
  subjectMemberId: string;
  externalSubjectName: string;
  items: Record<string, string>;
  otherPpeNote: string;
  notes: string;
};

export function PpeForm({
  action,
  values,
  cancelHref,
  submitLabel,
  pendingLabel,
  projects,
  members,
  workers = [],
}: {
  action: (formData: FormData) => Promise<FormActionResult>;
  values?: PpeFormValues;
  cancelHref: string;
  submitLabel: string;
  pendingLabel: string;
  projects: Option[];
  members: Option[];
  /** Workers without a NESTO login, as `employee:<id>` (E-04 §72). */
  workers?: Option[];
}) {
  const [items, setItems] = React.useState<Record<string, string>>(values?.items ?? {});

  const anyAnswered = PPE_ITEMS.some((item) => items[item.key] === "yes" || items[item.key] === "no");
  const failed = PPE_ITEMS.filter((item) => items[item.key] === "no");

  return (
    <RecordForm
      module="hse"
      action={action}
      cancelHref={cancelHref}
      submitLabel={submitLabel}
      pendingLabel={pendingLabel}
    >
      <FormSection
        title="Check"
        description="One person or one area. Recording that the helmets were fine says nothing about the harnesses unless you say so."
      >
        <Field label="Project" name="projectId">
          <select
            id="projectId"
            name="projectId"
            className={selectClass}
            defaultValue={values?.projectId ?? ""}
          >
            <option value="">No project — company-wide</option>
            {projects.map((project) => (
              <option key={project.value} value={project.value}>
                {project.label}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Date" name="checkDate" required>
          <Input
            id="checkDate"
            name="checkDate"
            type="date"
            defaultValue={values?.checkDate ?? localDay()}
            required
          />
        </Field>

        <Field label="Location" name="locationText">
          <Input
            id="locationText"
            name="locationText"
            defaultValue={values?.locationText ?? ""}
            maxLength={200}
          />
        </Field>

        <Field label="Person checked" name="subjectMemberId" hint="Leave blank for an area check.">
          <select
            id="subjectMemberId"
            name="subjectMemberId"
            className={selectClass}
            defaultValue={values?.subjectMemberId ?? ""}
          >
            <option value="">Area spot check</option>
            {members.map((member) => (
              <option key={member.value} value={member.value}>
                {member.label}
              </option>
            ))}
            {workers.length > 0 ? (
              <optgroup label="Workers without a NESTO account">
                {workers.map((worker) => (
                  <option key={worker.value} value={worker.value}>
                    {worker.label}
                  </option>
                ))}
              </optgroup>
            ) : null}
            {/* Somebody checked who has since left stays the subject of their check (AUD-09 §5, FV-09). */}
            <CurrentOption value={values?.subjectMemberId} options={[...members, ...workers]} />
          </select>
        </Field>

        <Field label="Or a name" name="externalSubjectName">
          <Input
            id="externalSubjectName"
            name="externalSubjectName"
            defaultValue={values?.externalSubjectName ?? ""}
            maxLength={200}
            placeholder="Subcontractor or visitor"
          />
        </Field>
      </FormSection>

      <section className="nesto-card p-5">
        <h2 className="text-card font-semibold text-fg">Equipment</h2>
        <p className="mt-1 text-meta text-fg-subtle">
          Record at least one item. Anything left as “not checked” is exactly that — it is not a
          pass.
        </p>

        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          {PPE_ITEMS.map((item) => (
            <div key={item.key} className="space-y-1.5">
              <Label htmlFor={item.key}>{item.label}</Label>
              <select
                id={item.key}
                name={item.key}
                className={selectClass}
                value={items[item.key] ?? ""}
                onChange={(event) =>
                  setItems((current) => ({ ...current, [item.key]: event.target.value }))
                }
              >
                <option value="">Not checked</option>
                <option value="yes">In order</option>
                <option value="no">Not in order</option>
              </select>
            </div>
          ))}
        </div>

        <p className="mt-4 text-meta" aria-live="polite">
          {!anyAnswered ? (
            <span className="text-fg-subtle">Nothing recorded yet.</span>
          ) : failed.length > 0 ? (
            <span className="text-danger-strong">
              This will be recorded as a failure: {failed.map((item) => item.label).join(", ")}.
            </span>
          ) : (
            <span className="text-success-strong">This will be recorded as a pass.</span>
          )}
        </p>

        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="otherPpeNote">Other equipment</Label>
            <Input
              id="otherPpeNote"
              name="otherPpeNote"
              defaultValue={values?.otherPpeNote ?? ""}
              maxLength={2000}
            />
          </div>

          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="notes">Notes</Label>
            <Textarea
              id="notes"
              name="notes"
              rows={3}
              defaultValue={values?.notes ?? ""}
              maxLength={2000}
            />
          </div>
        </div>
      </section>
    </RecordForm>
  );
}
