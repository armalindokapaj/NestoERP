"use client";

import * as React from "react";
import { Plus, Trash2 } from "lucide-react";

import {
  Field,
  FormSection,
  RecordForm,
  selectClass,
  type FormActionResult,
} from "@/components/forms/record-form";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ATTENDANCE_STATUSES, attendanceLabels } from "@/lib/modules/hse/hse.status";
import type { Option } from "./hse-forms";
import { localDay } from "@/components/hr/local-day";
import { CurrentOption } from "./hse-forms";

/**
 * A toolbox talk and who was there (PRD #22 §130, §132, §320).
 *
 * A participant is either a colleague or a name. Subcontractors attend toolbox
 * talks and are not company members, so a list that only took members would
 * record half the people actually briefed (§133).
 *
 * Signature is a tick, not a captured image: the signed paper sheet is filed
 * through Documents (§135, §138).
 */

export type ParticipantValue = {
  companyMemberId?: string;
  externalName?: string;
  attendanceStatus: string;
  signatureRecorded: boolean;
};

export type ToolboxFormValues = {
  title: string;
  topic: string;
  projectId: string;
  talkDate: string;
  locationText: string;
  conductedByMemberId: string;
  notes: string;
  participants: ParticipantValue[];
};

const EMPTY: ParticipantValue = {
  companyMemberId: "",
  externalName: "",
  attendanceStatus: "ATTENDED",
  signatureRecorded: false,
};

export function ToolboxForm({
  action,
  values,
  versionUpdatedAt,
  cancelHref,
  submitLabel,
  pendingLabel,
  projects,
  members,
  workers = [],
}: {
  action: (formData: FormData) => Promise<FormActionResult>;
  values?: ToolboxFormValues;
  versionUpdatedAt?: string;
  cancelHref: string;
  submitLabel: string;
  pendingLabel: string;
  projects: Option[];
  members: Option[];
  /** Workers without a NESTO login, as `employee:<id>` (E-04 §71). Participants only: they do not give talks. */
  workers?: Option[];
}) {
  const [participants, setParticipants] = React.useState<ParticipantValue[]>(
    values?.participants && values.participants.length > 0
      ? values.participants
      : [{ ...EMPTY }],
  );

  function update(index: number, patch: Partial<ParticipantValue>) {
    setParticipants((current) =>
      current.map((row, position) => (position === index ? { ...row, ...patch } : row)),
    );
  }

  return (
    <RecordForm
      module="hse"
      action={action}
      cancelHref={cancelHref}
      submitLabel={submitLabel}
      pendingLabel={pendingLabel}
      versionUpdatedAt={versionUpdatedAt}
    >
      <FormSection
        title="Talk"
        description="A short briefing on one subject. Not a training record — no course, no certificate, no compliance score."
      >
        <Field label="Title" name="title" required>
          <Input id="title" name="title" defaultValue={values?.title ?? ""} required maxLength={200} />
        </Field>

        <Field label="Topic" name="topic" required>
          <Input
            id="topic"
            name="topic"
            defaultValue={values?.topic ?? ""}
            required
            maxLength={200}
            placeholder="Working at height"
          />
        </Field>

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

        <Field label="Conducted by" name="conductedByMemberId" required>
          <select
            id="conductedByMemberId"
            name="conductedByMemberId"
            className={selectClass}
            defaultValue={values?.conductedByMemberId ?? ""}
            required
          >
            <option value="">Choose who gave the talk</option>
            {members.map((member) => (
              <option key={member.value} value={member.value}>
                {member.label}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Date" name="talkDate" required>
          <Input
            id="talkDate"
            name="talkDate"
            type="date"
            defaultValue={values?.talkDate ?? localDay()}
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

        <Field label="Notes" name="notes" className="sm:col-span-2">
          <Textarea
            id="notes"
            name="notes"
            rows={3}
            defaultValue={values?.notes ?? ""}
            maxLength={4000}
          />
        </Field>
      </FormSection>

      <section className="nesto-card p-5">
        <h2 className="text-card font-semibold text-fg">Who was there</h2>
        <p className="mt-1 text-meta text-fg-subtle">
          Pick a colleague, or type a name for anybody who is not on the system.
        </p>

        <div className="mt-4 space-y-3">
          {participants.map((row, index) => (
            <div key={index} className="rounded-md border border-line p-4">
              <div className="flex items-start justify-between gap-3">
                <p className="nesto-eyebrow text-fg-subtle">Person {index + 1}</p>
                {participants.length > 1 ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() =>
                      setParticipants((current) =>
                        current.filter((_, position) => position !== index),
                      )
                    }
                  >
                    <Trash2 aria-hidden="true" />
                    <span className="sr-only">Remove person {index + 1}</span>
                  </Button>
                ) : null}
              </div>

              <div className="mt-3 grid gap-3 sm:grid-cols-4">
                <div className="space-y-1.5 sm:col-span-2">
                  <Label htmlFor={`participant-member-${index}`}>Colleague</Label>
                  <select
                    id={`participant-member-${index}`}
                    name={`participants[${index}][companyMemberId]`}
                    className={selectClass}
                    value={row.companyMemberId ?? ""}
                    onChange={(event) =>
                      update(index, { companyMemberId: event.target.value, externalName: "" })
                    }
                  >
                    <option value="">Not a colleague</option>
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
                    {/* Somebody who attended and has since left stays on the sheet (AUD-09 §5, FV-09). */}
                    <CurrentOption value={row.companyMemberId} options={[...members, ...workers]} />
                  </select>
                </div>

                <div className="space-y-1.5 sm:col-span-2">
                  <Label htmlFor={`participant-name-${index}`}>Or a name</Label>
                  <Input
                    id={`participant-name-${index}`}
                    name={`participants[${index}][externalName]`}
                    value={row.externalName ?? ""}
                    onChange={(event) =>
                      update(index, { externalName: event.target.value, companyMemberId: "" })
                    }
                    maxLength={200}
                    placeholder="Subcontractor or visitor"
                  />
                </div>

                <div className="space-y-1.5 sm:col-span-2">
                  <Label htmlFor={`participant-attendance-${index}`}>Attendance</Label>
                  <select
                    id={`participant-attendance-${index}`}
                    name={`participants[${index}][attendanceStatus]`}
                    className={selectClass}
                    value={row.attendanceStatus}
                    onChange={(event) => update(index, { attendanceStatus: event.target.value })}
                  >
                    {ATTENDANCE_STATUSES.map((value) => (
                      <option key={value} value={value}>
                        {attendanceLabels[value]}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="flex items-end gap-2.5 sm:col-span-2">
                  <Checkbox
                    id={`participant-signature-${index}`}
                    name={`participants[${index}][signatureRecorded]`}
                    checked={row.signatureRecorded}
                    onCheckedChange={(checked) =>
                      update(index, { signatureRecorded: checked === true })
                    }
                    className="mb-2"
                  />
                  <Label
                    htmlFor={`participant-signature-${index}`}
                    className="mb-1.5 text-body font-normal text-fg-muted"
                  >
                    Signed the sheet
                  </Label>
                </div>
              </div>
            </div>
          ))}
        </div>

        <Button
          type="button"
          variant="secondary"
          size="sm"
          className="mt-4"
          onClick={() => setParticipants((current) => [...current, { ...EMPTY }])}
        >
          <Plus aria-hidden="true" />
          Add somebody
        </Button>
      </section>
    </RecordForm>
  );
}
