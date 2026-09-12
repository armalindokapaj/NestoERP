"use client";

import { Field, FormSection, RecordForm } from "@/components/forms/record-form";
import { Textarea } from "@/components/ui/textarea";
import { recordInvestigationAction } from "@/lib/actions/hse";
import type { IncidentDetailDTO } from "@/lib/modules/hse/hse.types";

/**
 * The investigation panel (PRD #22 §90, §91, §363).
 *
 * Free text in V0.1 — no structured five-whys engine (PRD #22 §91). What
 * matters is that a root cause exists at all before a serious incident closes,
 * not the shape it is written in.
 */
export function InvestigationForm({ incident }: { incident: IncidentDetailDTO }) {
  const action = recordInvestigationAction.bind(null, incident.id);
  const serious = incident.severity === "HIGH" || incident.severity === "CRITICAL";

  return (
    <RecordForm
      action={action}
      cancelHref={`/hse/incidents/${incident.id}`}
      submitLabel="Save findings"
      pendingLabel="Saving…"
      versionUpdatedAt={incident.updatedAt}
    >
      <FormSection
        title="Findings"
        description="Saved as you go. Nothing here closes the incident — that is a separate act, and somebody else decides it."
      >
        <Field
          label="What was found"
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
          label="Root cause"
          name="rootCause"
          required={serious}
          className="sm:col-span-2"
          hint={
            serious
              ? "Required before this incident can be closed. Why it was able to happen, not who was involved."
              : "Why it was able to happen."
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

        <Field label="Lessons learned" name="lessonsLearned" className="sm:col-span-2">
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
