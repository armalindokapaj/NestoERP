"use client";

import * as React from "react";

import {
  Field,
  FormSection,
  RecordForm,
  selectClass,
} from "@/components/forms/record-form";
import { Textarea } from "@/components/ui/textarea";
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
  if (!likelihood || !severity) {
    return <span className="text-fg-subtle">{emptyLabel}</span>;
  }
  const score = Number(likelihood) * Number(severity);
  return (
    <span>
      Score <strong className="text-fg">{score}</strong> ·{" "}
      <strong className="text-fg">{riskLevelLabels[calculateRiskLevel(score)]}</strong>
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
  const likelihoodName = optional ? "residualLikelihood" : "likelihood";
  const severityName = optional ? "residualSeverity" : "severity";

  return (
    <>
      <Field label={`${label} — likelihood`} name={likelihoodName} required={!optional}>
        <select
          id={`${namePrefix}-likelihood`}
          name={likelihoodName}
          className={selectClass}
          value={likelihood}
          onChange={(event) => onChange({ likelihood: event.target.value })}
          required={!optional}
        >
          {optional ? <option value="">Not assessed</option> : null}
          {AXIS.map((value) => (
            <option key={value} value={value}>
              {value} — {likelihoodLabels[value]}
            </option>
          ))}
        </select>
      </Field>

      <Field label={`${label} — severity`} name={severityName} required={!optional}>
        <select
          id={`${namePrefix}-severity`}
          name={severityName}
          className={selectClass}
          value={severity}
          onChange={(event) => onChange({ severity: event.target.value })}
          required={!optional}
        >
          {optional ? <option value="">Not assessed</option> : null}
          {AXIS.map((value) => (
            <option key={value} value={value}>
              {value} — {axisLabels[value]}
            </option>
          ))}
        </select>
      </Field>

      <p className="text-meta text-fg-muted sm:col-span-2" aria-live="polite">
        <Preview
          likelihood={likelihood}
          severity={severity}
          emptyLabel={optional ? "Not assessed" : "Pick both."}
        />
      </p>
    </>
  );
}

export function HazardAssessForm({ hazard }: { hazard: HazardDetailDTO }) {
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
      action={action}
      cancelHref={`/hse/hazards/${hazard.id}`}
      submitLabel="Save assessment"
      pendingLabel="Saving…"
      versionUpdatedAt={hazard.updatedAt}
    >
      <FormSection title="As it stands" description="Before any further control goes in.">
        <AxisPair
          namePrefix="initial"
          label="Risk"
          likelihood={initial.likelihood}
          severity={initial.severity}
          onChange={(next) => setInitial((current) => ({ ...current, ...next }))}
          optional={false}
        />
      </FormSection>

      <FormSection
        title="Controls"
        description="What is being done about it. A high or critical hazard needs the residual risk assessed before it can close."
      >
        <Field label="Control measure" name="controlMeasure" className="sm:col-span-2">
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
          label="After controls"
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
  const action = controlHazardAction.bind(null, hazard.id);

  return (
    <RecordForm
      action={action}
      cancelHref={`/hse/hazards/${hazard.id}`}
      submitLabel="Record control"
      pendingLabel="Recording…"
    >
      <FormSection
        title="Control"
        description="Recording a control moves the hazard to Controlled. It stays live until it is closed — a control in place is not the same as a hazard dealt with."
      >
        <Field label="Immediate control" name="immediateControl" className="sm:col-span-2">
          <Textarea
            id="immediateControl"
            name="immediateControl"
            rows={2}
            defaultValue={hazard.immediateControl ?? ""}
            maxLength={2000}
          />
        </Field>

        <Field label="Control measure" name="controlMeasure" required className="sm:col-span-2">
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

export function HazardCloseForm({ hazard }: { hazard: HazardDetailDTO }) {
  const [residual, setResidual] = React.useState({
    likelihood: hazard.residualRisk ? String(hazard.residualRisk.likelihood) : "",
    severity: hazard.residualRisk ? String(hazard.residualRisk.severity) : "",
  });

  const action = closeHazardAction.bind(null, hazard.id);
  const needsResidual = hazard.risk.level === "HIGH" || hazard.risk.level === "CRITICAL";

  return (
    <RecordForm
      action={action}
      cancelHref={`/hse/hazards/${hazard.id}`}
      submitLabel="Close hazard"
      pendingLabel="Closing…"
    >
      <FormSection
        title="Closure"
        description="Say what was done and what risk is left. A closed hazard is read-only until somebody reopens it."
      >
        <Field label="Closure note" name="closureNote" required className="sm:col-span-2">
          <Textarea id="closureNote" name="closureNote" rows={4} required maxLength={2000} />
        </Field>

        {needsResidual || hazard.residualRisk ? (
          <AxisPair
            namePrefix="residual"
            label="Risk after controls"
            likelihood={residual.likelihood}
            severity={residual.severity}
            onChange={(next) => setResidual((current) => ({ ...current, ...next }))}
            optional
          />
        ) : null}
      </FormSection>
    </RecordForm>
  );
}
