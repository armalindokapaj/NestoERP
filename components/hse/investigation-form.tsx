"use client";

import { Field, FormSection, RecordForm } from "@/components/forms/record-form";
import { Textarea } from "@/components/ui/textarea";
import { recordInvestigationAction } from "@/lib/actions/hse";
import type { IncidentDetailDTO } from "@/lib/modules/hse/hse.types";
import { useHseTranslations } from "@/components/hse/hse-text";

/**
 * The investigation panel (PRD #22 §90, §91, §363).
 *
 * Free text in V0.1 — no structured five-whys engine (PRD #22 §91). What
 * matters is that a root cause exists at all before a serious incident closes,
 * not the shape it is written in.
 */
export function InvestigationForm({ incident }: { incident: IncidentDetailDTO }) {
  const t = useHseTranslations();
  const action = recordInvestigationAction.bind(null, incident.id);
  const serious = incident.severity === "HIGH" || incident.severity === "CRITICAL";

  return (
    <RecordForm
      module="hse"
      action={action}
      cancelHref={`/hse/incidents/${incident.id}`}
      submitLabel={t("forms.saveFindings")}
      pendingLabel={t("page.saving")}
      versionUpdatedAt={incident.updatedAt}
    >
      <FormSection
        title={t("forms.findings")}
        description={t("forms.findingsIntro")}
      >
        <Field
          label={t("incident.detail.whatWasFound")}
          name="investigationSummary"
          required={serious}
          className="sm:col-span-2"
        >
          <Textarea
            id="investigationSummary"
            name="investigationSummary"
            rows={6}
            defaultValue={incident.investigationSummary ?? ""}
            maxLength={8000}
          />
        </Field>

        <Field
          label={t("incident.detail.rootCause")}
          name="rootCause"
          required={serious}
          className="sm:col-span-2"
          hint={
            serious
              ? t("forms.rootCauseRequired")
              : t("forms.rootCauseHint")
          }
        >
          <Textarea
            id="rootCause"
            name="rootCause"
            rows={4}
            defaultValue={incident.rootCause ?? ""}
            maxLength={4000}
          />
        </Field>

        <Field label={t("incident.detail.lessonsLearned")} name="lessonsLearned" className="sm:col-span-2">
          <Textarea
            id="lessonsLearned"
            name="lessonsLearned"
            rows={4}
            defaultValue={incident.lessonsLearned ?? ""}
            maxLength={4000}
          />
        </Field>
      </FormSection>
    </RecordForm>
  );
}
