"use client";

import * as React from "react";
import { useRouter } from "@/components/navigation/guarded-router";

import { selectClass } from "@/components/forms/record-form";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/toast";
import { SaveMessages, UnsavedIndicator } from "@/components/unsaved/editor-status";
import { useEditorSave } from "@/components/unsaved/use-editor-save";
import { submitInspectionAction } from "@/lib/actions/qaqc";
import { inspectionResultLabels } from "@/lib/modules/qaqc/qaqc.status";
import type { QualityInspectionResult } from "@prisma/client";

/**
 * Finishing an inspection (PRD #21 §76–§79).
 *
 * The verdict is chosen, not derived — a checklist where everything passed can
 * still be a conditional acceptance. But a required check that failed makes an
 * overall PASS impossible, so it is simply not offered (§77).
 *
 * A conditional result has to say what the condition is, or "accepted with a
 * condition" means nothing to whoever reads it later (§78).
 */
export function SubmitInspection({
  inspectionId,
  allowedResults,
  blockers,
  defaultSummary,
}: {
  inspectionId: string;
  allowedResults: Exclude<QualityInspectionResult, "NOT_SET">[];
  blockers: string[];
  defaultSummary: string;
}) {
  if (blockers.length > 0) {
    return (
      <div className="nesto-card space-y-2 p-5">
        <h3 className="text-card font-semibold text-fg">Before this can be submitted</h3>
        <ul className="space-y-1">
          {blockers.map((blocker) => (
            <li key={blocker} className="text-table text-fg-muted">
              {blocker}
            </li>
          ))}
        </ul>
      </div>
    );
  }

  return (
    <SubmitInspectionForm
      inspectionId={inspectionId}
      allowedResults={allowedResults}
      defaultSummary={defaultSummary}
    />
  );
}

/**
 * Its own component so the editor mounts with the form: the blockers above
 * turn into this form in place once the checklist is answered.
 */
function SubmitInspectionForm({
  inspectionId,
  allowedResults,
  defaultSummary,
}: {
  inspectionId: string;
  allowedResults: Exclude<QualityInspectionResult, "NOT_SET">[];
  defaultSummary: string;
}) {
  const router = useRouter();
  const toast = useToast();
  const formRef = React.useRef<HTMLFormElement>(null);
  const [result, setResult] = React.useState<string>(allowedResults[0] ?? "PASS");

  /**
   * Recording the verdict is a workflow step (AUD-03 §3): the form registers
   * as workflow-only, so leaving with a verdict or a condition typed asks
   * first, and "Save and continue" never sends anything for approval.
   */
  const save = useEditorSave({
    formRef,
    action: (formData: FormData) => submitInspectionAction(inspectionId, formData),
    module: "qaqc",
    saveKind: "none",
    workflow: "Submit for approval",
    label: "Result",
    onCommitted: (outcome) => {
      toast({ title: outcome?.message ?? "Sent for approval.", tone: "success" });
      router.push(`/qaqc/inspections/${inspectionId}`);
      router.refresh();
      return true;
    },
  });
  const { pending } = save;
  const passBlocked = !allowedResults.includes("PASS");

  return (
    <form ref={formRef} onSubmit={save.onSubmit} className="nesto-card space-y-4 p-5">
      <div>
        <h3 className="text-card font-semibold text-fg">Record the result</h3>
        <p className="mt-1 text-meta text-fg-subtle">
          {passBlocked
            ? "A required check failed, so this cannot be recorded as a pass. It can still be accepted with a condition."
            : "Every required check is answered. Choose the overall verdict."}
        </p>
      </div>

      <SaveMessages save={save} />

      <fieldset disabled={pending || Boolean(save.saved)} aria-busy={pending || undefined} className="m-0 min-w-0 space-y-4 border-0 p-0">
        <div className="space-y-1.5">
          <Label htmlFor="result">Result</Label>
          <select
            id="result"
            name="result"
            className={selectClass}
            value={result}
            onChange={(event) => setResult(event.target.value)}
            required
          >
            {allowedResults.map((option) => (
              <option key={option} value={option}>
                {inspectionResultLabels[option]}
              </option>
            ))}
          </select>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="summary">Summary</Label>
          <Textarea
            id="summary"
            name="summary"
            rows={3}
            defaultValue={defaultSummary}
            maxLength={4000}
            placeholder="What was found?"
          />
        </div>

        {result === "CONDITIONAL" ? (
          <div className="space-y-1.5">
            <Label htmlFor="decisionNote">
              The condition<span className="ml-0.5 text-danger-strong">*</span>
            </Label>
            <Textarea
              id="decisionNote"
              name="decisionNote"
              rows={3}
              maxLength={4000}
              placeholder="What has to happen for this acceptance to hold?"
              required
            />
            <p className="text-meta text-fg-subtle">
              &ldquo;Accepted with a condition&rdquo; is not a verdict until somebody says what the
              condition is.
            </p>
          </div>
        ) : null}
      </fieldset>

      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" disabled={pending}>
          {pending ? "Submitting…" : "Submit for approval"}
        </Button>
        <UnsavedIndicator save={save} />
      </div>
    </form>
  );
}
