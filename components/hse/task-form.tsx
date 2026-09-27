"use client";

import { Field, FormSection, RecordForm, selectClass } from "@/components/forms/record-form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { createHseTaskAction } from "@/lib/actions/hse";
import type { Option } from "./hse-forms";
import { useHseTranslations } from "@/components/hse/hse-text";

/** A canonical Task raised to discharge an HSE action (PRD #22 §126). */
export function HseTaskForm({
  actionId,
  defaultTitle,
  cancelHref,
  members,
}: {
  actionId: string;
  defaultTitle: string;
  cancelHref: string;
  members: Option[];
}) {
  const t = useHseTranslations();
  const action = createHseTaskAction.bind(null, actionId);

  return (
    <RecordForm
      module="hse"
      action={action}
      cancelHref={cancelHref}
      submitLabel={t("forms.createTask")}
      pendingLabel={t("page.creating")}
    >
      <FormSection
        title={t("page.crumbTask")}
        description={t("forms.taskIntro")}
      >
        <Field label={t("forms.title")} name="title" required className="sm:col-span-2">
          <Input id="title" name="title" defaultValue={defaultTitle} required maxLength={200} />
        </Field>

        <Field label={t("record.description")} name="description" className="sm:col-span-2">
          <Textarea id="description" name="description" rows={3} maxLength={4000} />
        </Field>

        <Field label={t("forms.assignTo")} name="assigneeMemberId">
          <select id="assigneeMemberId" name="assigneeMemberId" className={selectClass}>
            <option value="">{t("forms.nobodyYet")}</option>
            {members.map((member) => (
              <option key={member.value} value={member.value}>
                {member.label}
              </option>
            ))}
          </select>
        </Field>

        <Field label={t("record.due")} name="dueDate">
          <Input id="dueDate" name="dueDate" type="date" />
        </Field>
      </FormSection>
    </RecordForm>
  );
}
