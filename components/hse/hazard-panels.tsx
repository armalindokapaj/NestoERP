"use client";

import * as React from "react";

import {
  Field,
  FieldErrorProvider,
  FormSection,
  RecordForm,
  selectClass,
} from "@/components/forms/record-form";
import { useRouter } from "@/components/navigation/guarded-router";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { SaveMessages, UnsavedIndicator } from "@/components/unsaved/editor-status";
import { useEditorSave } from "@/components/unsaved/use-editor-save";
import { useUnsavedFrozen } from "@/components/unsaved/use-unsaved";
import {
  assessHazardAction,
  closeHazardAction,
  controlHazardAction,
} from "@/lib/actions/hse";
import {
  calculateRiskLevel,
  likelihoodLabels,
  riskLevelLabels,
  severityLabels as axisLabels,
} from "@/lib/modules/hse/hse.risk";
import type { HazardDetailDTO } from "@/lib/modules/hse/hse.types";
import { useHseTranslations } from "@/components/hse/hse-text";
import { hseLabel } from "@/lib/i18n/modules/hse/labels";

/**
 * The three hazard panels (PRD #22 §67, §70, §73).
 *
 * Each is its own page rather than a dialog, because each is a decision with
 * consequences: reassessing a hazard changes where it ranks on the register,
 * recording a control changes whether it can close, and closing it is final
 * until somebody reopens it.
 *
 * None of them posts a risk score. The two axes go up and the server does the
 * arithmetic (PRD #22 §243); the preview below each pair runs the same function
 * so the page and the database can never disagree.
 */

const AXIS = [1, 2, 3, 4, 5];

function Preview({
  likelihood,
  severity,
  emptyLabel,
}: {
  likelihood: string;
  severity: string;
  emptyLabel: string;
}) {
  const t = useHseTranslations();
  if (!likelihood || !severity) {
    return <span className="text-fg-subtle">{emptyLabel}</span>;
  }
  const score = Number(likelihood) * Number(severity);
  return (
    <span>
      {t("forms.scoreShort", { score, level: hseLabel(t, "riskLevel", calculateRiskLevel(score), riskLevelLabels[calculateRiskLevel(score)]) })}
    </span>
  );
}

function AxisPair({
  namePrefix,
  likelihood,
  severity,
  onChange,
  optional,
  label,
}: {
  namePrefix: string;
  likelihood: string;
  severity: string;
  onChange: (next: { likelihood?: string; severity?: string }) => void;
  optional: boolean;
  label: string;
}) {
  const t = useHseTranslations();
  const likelihoodName = optional ? "residualLikelihood" : "likelihood";
  const severityName = optional ? "residualSeverity" : "severity";

  return (
    <>
      <Field label={t("forms.likelihoodOf", { label })} name={likelihoodName} required={!optional}>
        <select
          id={`${namePrefix}-likelihood`}
          name={likelihoodName}
          className={selectClass}
          value={likelihood}
          onChange={(event) => onChange({ likelihood: event.target.value })}
          required={!optional}
        >
          {optional ? <option value="">{t("forms.notAssessed")}</option> : null}
          {AXIS.map((value) => (
            <option key={value} value={value}>
              {value} — {hseLabel(t, "likelihood", value, likelihoodLabels[value])}
            </option>
          ))}
        </select>
      </Field>

      <Field label={t("forms.severityOf", { label })} name={severityName} required={!optional}>
        <select
          id={`${namePrefix}-severity`}
          name={severityName}
          className={selectClass}
          value={severity}
          onChange={(event) => onChange({ severity: event.target.value })}
          required={!optional}
        >
          {optional ? <option value="">{t("forms.notAssessed")}</option> : null}
          {AXIS.map((value) => (
            <option key={value} value={value}>
              {value} — {hseLabel(t, "axisSeverity", value, axisLabels[value])}
            </option>
          ))}
        </select>
      </Field>

      <p className="text-meta text-fg-muted sm:col-span-2" aria-live="polite">
        <Preview
          likelihood={likelihood}
          severity={severity}
          emptyLabel={optional ? t("forms.notAssessed") : t("forms.pickBothShort")}
        />
      </p>
    </>
  );
}

export function HazardAssessForm({ hazard }: { hazard: HazardDetailDTO }) {
  const t = useHseTranslations();
  const [initial, setInitial] = React.useState({
    likelihood: String(hazard.risk.likelihood),
    severity: String(hazard.risk.severity),
  });
  const [residual, setResidual] = React.useState({
    likelihood: hazard.residualRisk ? String(hazard.residualRisk.likelihood) : "",
    severity: hazard.residualRisk ? String(hazard.residualRisk.severity) : "",
  });

  const action = assessHazardAction.bind(null, hazard.id);

  return (
    <RecordForm
      module="hse"
      action={action}
      cancelHref={`/hse/hazards/${hazard.id}`}
      submitLabel={t("page.saveAssessment")}
      pendingLabel={t("page.saving")}
      versionUpdatedAt={hazard.updatedAt}
    >
      <FormSection title={t("forms.asItStands")} description={t("forms.beforeFurther")}>
        <AxisPair
          namePrefix="initial"
          label={t("forms.risk")}
          likelihood={initial.likelihood}
          severity={initial.severity}
          onChange={(next) => setInitial((current) => ({ ...current, ...next }))}
          optional={false}
        />
      </FormSection>

      <FormSection
        title={t("hazard.detail.controls")}
        description={t("forms.assessControlsIntro")}
      >
        <Field label={t("forms.controlMeasure")} name="controlMeasure" className="sm:col-span-2">
          <Textarea
            id="controlMeasure"
            name="controlMeasure"
            rows={3}
            defaultValue={hazard.controlMeasure ?? ""}
            maxLength={2000}
          />
        </Field>

        <AxisPair
          namePrefix="residual"
          label={t("hazard.detail.afterControls")}
          likelihood={residual.likelihood}
          severity={residual.severity}
          onChange={(next) => setResidual((current) => ({ ...current, ...next }))}
          optional
        />
      </FormSection>
    </RecordForm>
  );
}

export function HazardControlForm({ hazard }: { hazard: HazardDetailDTO }) {
  const t = useHseTranslations();
  const action = controlHazardAction.bind(null, hazard.id);

  return (
    <RecordForm
      module="hse"
      action={action}
      cancelHref={`/hse/hazards/${hazard.id}`}
      submitLabel={t("page.recordControl2")}
      pendingLabel={t("page.recording")}
      // Recorded on a hazard that exists: an ordinary save, not a create (AUD-03 §3).
      saveKind="save"
    >
      <FormSection
        title={t("page.crumbControl")}
        description={t("forms.controlIntro")}
      >
        <Field label={t("forms.immediateControl")} name="immediateControl" className="sm:col-span-2">
          <Textarea
            id="immediateControl"
            name="immediateControl"
            rows={2}
            defaultValue={hazard.immediateControl ?? ""}
            maxLength={2000}
          />
        </Field>

        <Field label={t("forms.controlMeasure")} name="controlMeasure" required className="sm:col-span-2">
          <Textarea
            id="controlMeasure"
            name="controlMeasure"
            rows={4}
            defaultValue={hazard.controlMeasure ?? ""}
            required
            maxLength={2000}
          />
        </Field>
      </FormSection>
    </RecordForm>
  );
}

/**
 * Closing is a workflow step, not a save (AUD-03 §3): the note exists only to
 * close the hazard, so the form registers as workflow-only and the
 * unsaved-changes prompt offers Stay or Discard — never a "Save and continue"
 * that would close a hazard on the way to somewhere else. The submit itself
 * runs under the same contract as a RecordForm: one request per snapshot, an
 * explicit outcome, and the refusal kept on screen with the note intact.
 */
export function HazardCloseForm({ hazard }: { hazard: HazardDetailDTO }) {
  const t = useHseTranslations();
  const router = useRouter();
  const frozen = useUnsavedFrozen();
  const formRef = React.useRef<HTMLFormElement>(null);
  const [residual, setResidual] = React.useState({
    likelihood: hazard.residualRisk ? String(hazard.residualRisk.likelihood) : "",
    severity: hazard.residualRisk ? String(hazard.residualRisk.severity) : "",
  });

  const action = closeHazardAction.bind(null, hazard.id);
  const needsResidual = hazard.risk.level === "HIGH" || hazard.risk.level === "CRITICAL";
  const cancelHref = `/hse/hazards/${hazard.id}`;

  const save = useEditorSave({
    formRef,
    action,
    module: "hse",
    saveKind: "none",
    workflow: t("page.closeHazard"),
  });
  const { pending, saved, fieldErrors } = save;

  return (
    <FieldErrorProvider value={fieldErrors}>
      <form ref={formRef} onSubmit={save.onSubmit} className="space-y-5">
        <SaveMessages save={save} />

        <fieldset disabled={pending || Boolean(saved)} aria-busy={pending || undefined} className="m-0 min-w-0 space-y-5 border-0 p-0">
          <FormSection
            title={t("forms.closure")}
            description={t("forms.closureIntro")}
          >
            <Field label={t("record.closureNote")} name="closureNote" required className="sm:col-span-2">
              <Textarea id="closureNote" name="closureNote" rows={4} required maxLength={2000} />
            </Field>

            {needsResidual || hazard.residualRisk ? (
              <AxisPair
                namePrefix="residual"
                label={t("forms.riskAfterControls")}
                likelihood={residual.likelihood}
                severity={residual.severity}
                onChange={(next) => setResidual((current) => ({ ...current, ...next }))}
                optional
              />
            ) : null}
          </FormSection>
        </fieldset>

        <div className="flex flex-wrap items-center gap-2">
          <Button type="submit" disabled={pending || frozen || Boolean(saved)}>
            {pending ? t("actions.closing") : t("page.closeHazard")}
          </Button>
          <Button type="button" variant="secondary" onClick={() => router.push(cancelHref)} disabled={pending}>
            {t("actions.cancel")}
          </Button>
          <UnsavedIndicator save={save} />
        </div>
      </form>
    </FieldErrorProvider>
  );
}
