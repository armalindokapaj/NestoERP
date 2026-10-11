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
import { useHseTranslations } from "@/components/hse/hse-text";
import { FormSelect } from "@/components/ui/form-select";

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
  const t = useHseTranslations();
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
        title={t("forms.check")}
        description={t("forms.ppeIntro")}
      >
        <Field label={t("record.project")} name="projectId">
          <FormSelect
            id="projectId"
            name="projectId"
            className={selectClass}
            defaultValue={values?.projectId ?? ""}
          >
            <option value="">{t("forms.noProject")}</option>
            {projects.map((project) => (
              <option key={project.value} value={project.value}>
                {project.label}
              </option>
            ))}
          </FormSelect>
        </Field>

        <Field label={t("toolbox.detail.date")} name="checkDate" required>
          <Input
            id="checkDate"
            name="checkDate"
            type="date"
            defaultValue={values?.checkDate ?? localDay()}
            required
          />
        </Field>

        <Field label={t("record.location")} name="locationText">
          <Input
            id="locationText"
            name="locationText"
            defaultValue={values?.locationText ?? ""}
            maxLength={200}
          />
        </Field>

        <Field label={t("forms.personChecked")} name="subjectMemberId" hint={t("forms.leaveBlankArea")}>
          <FormSelect
            id="subjectMemberId"
            name="subjectMemberId"
            className={selectClass}
            defaultValue={values?.subjectMemberId ?? ""}
          >
            <option value="">{t("table.areaSpotCheck")}</option>
            {members.map((member) => (
              <option key={member.value} value={member.value}>
                {member.label}
              </option>
            ))}
            {workers.length > 0 ? (
              <optgroup label={t("forms.workersNoAccount")}>
                {workers.map((worker) => (
                  <option key={worker.value} value={worker.value}>
                    {worker.label}
                  </option>
                ))}
              </optgroup>
            ) : null}
            {/* Somebody checked who has since left stays the subject of their check (AUD-09 §5, FV-09). */}
            <CurrentOption value={values?.subjectMemberId} options={[...members, ...workers]} />
          </FormSelect>
        </Field>

        <Field label={t("people.orName")} name="externalSubjectName">
          <Input
            id="externalSubjectName"
            name="externalSubjectName"
            defaultValue={values?.externalSubjectName ?? ""}
            maxLength={200}
            placeholder={t("people.subOrVisitor")}
          />
        </Field>
      </FormSection>

      <section className="nesto-card p-5">
        <h2 className="text-card font-semibold text-fg">{t("forms.equipment")}</h2>
        <p className="mt-1 text-meta text-fg-subtle">{t("forms.equipmentIntro")}</p>

        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          {PPE_ITEMS.map((item) => (
            <div key={item.key} className="space-y-1.5">
              <Label htmlFor={item.key}>{t(`ppeItem.${item.key}`)}</Label>
              <FormSelect
                id={item.key}
                name={item.key}
                className={selectClass}
                value={items[item.key] ?? ""}
                onChange={(event) =>
                  setItems((current) => ({ ...current, [item.key]: event.target.value }))
                }
              >
                <option value="">{t("forms.notChecked")}</option>
                <option value="yes">{t("forms.inOrder")}</option>
                <option value="no">{t("forms.notInOrder")}</option>
              </FormSelect>
            </div>
          ))}
        </div>

        <p className="mt-4 text-meta" aria-live="polite">
          {!anyAnswered ? (
            <span className="text-fg-subtle">{t("forms.nothingRecorded")}</span>
          ) : failed.length > 0 ? (
            <span className="text-danger-strong">
              {t("forms.willFail", { items: failed.map((item) => t(`ppeItem.${item.key}`)).join(", ") })}
            </span>
          ) : (
            <span className="text-success-strong">{t("forms.willPass")}</span>
          )}
        </p>

        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="otherPpeNote">{t("forms.otherEquipment")}</Label>
            <Input
              id="otherPpeNote"
              name="otherPpeNote"
              defaultValue={values?.otherPpeNote ?? ""}
              maxLength={2000}
            />
          </div>

          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="notes">{t("record.notes")}</Label>
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
