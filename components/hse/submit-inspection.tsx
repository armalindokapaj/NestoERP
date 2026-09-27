"use client";

import * as React from "react";

import { selectClass } from "@/components/forms/record-form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/toast";
import { SaveMessages, UnsavedIndicator } from "@/components/unsaved/editor-status";
import { useEditorSave } from "@/components/unsaved/use-editor-save";
import { submitInspectionAction } from "@/lib/actions/hse";
import { checklistGapLabel } from "./gap-labels";
import { inspectionResultLabels } from "@/lib/modules/hse/hse.status";
import type { ChecklistGap } from "@/lib/modules/hse/hse.status";
import type { HseInspectionResult } from "@prisma/client";
import { localDay } from "@/components/hr/local-day";

/**
 * Handing an inspection in (PRD #22 §51, §49).
 *
 * Two things this panel refuses to hide.
 *
 * **What is still unanswered.** The gaps are named, item by item — being told
 * "not ready" and left to hunt through forty rows for the blank one is how
 * checklists get abandoned half-finished.
 *
 * **That a required failure rules out PASS.** The dropdown offers only the
 * results the answers can honestly support, and says why. The server refuses
 * the rest independently.
 */
export function SubmitInspection({
  inspectionId,
  gaps,
  allowedResults,
  versionUpdatedAt,
  summary,
}: {
  inspectionId: string;
  gaps: ChecklistGap[];
  allowedResults: HseInspectionResult[];
  versionUpdatedAt?: string;
  /** The notes the inspection already has: submitting starts from them rather than erasing them (AUD-09 §4, FV-05). */
  summary?: string | null;
}) {
  const ready = gaps.length === 0;

  if (!ready) {
    return (
      <section id="submit" className="nesto-card space-y-3 p-5">
        <h2 className="text-table font-medium text-fg">Not ready to submit</h2>
        <ul className="list-disc space-y-1 pl-5 text-meta text-fg-muted">
          {gaps.map((gap, index) => (
            <li key={`${gap.kind}-${gap.label}-${index}`}>{checklistGapLabel(gap)}</li>
          ))}
        </ul>
      </section>
    );
  }

  return (
    <SubmitInspectionForm
      inspectionId={inspectionId}
      allowedResults={allowedResults}
      versionUpdatedAt={versionUpdatedAt}
      summary={summary}
    />
  );
}

/**
 * Its own component so the editor mounts with the form: the panel above turns
 * into this form in place once the gaps are answered.
 */
function SubmitInspectionForm({
  inspectionId,
  allowedResults,
  versionUpdatedAt,
  summary,
}: {
  inspectionId: string;
  allowedResults: HseInspectionResult[];
  versionUpdatedAt?: string;
  summary?: string | null;
}) {
  const toast = useToast();
  const formRef = React.useRef<HTMLFormElement>(null);

  /**
   * Submitting is a workflow step with a verdict and a summary to lose (AUD-03
   * §3): the panel registers as workflow-only, so leaving with them typed asks
   * first and "Save and continue" never submits anything. A committed submit
   * opens the inspection, where the action said.
   */
  const save = useEditorSave({
    formRef,
    action: (formData: FormData) => submitInspectionAction(inspectionId, formData),
    module: "hse",
    saveKind: "none",
    workflow: "Submit for approval",
    label: "Submission",
    onCommitted: (result) => {
      toast({ title: result?.message ?? "Submitted.", tone: "success" });
    },
  });
  const { pending } = save;
  const passBlocked = !allowedResults.includes("PASS");

  return (
    <form ref={formRef} onSubmit={save.onSubmit} id="submit" className="nesto-card space-y-4 p-5">
      <h2 className="text-table font-medium text-fg">Submit this inspection</h2>

      <SaveMessages save={save} />

      {versionUpdatedAt ? (
        <input type="hidden" name="versionUpdatedAt" value={versionUpdatedAt} />
      ) : null}

      {passBlocked ? (
        <p className="rounded-lg border border-warning-border bg-warning-subtle p-3 text-meta text-warning-strong">
          A required check failed, so this inspection cannot pass. It can still be conditional if
          the work may continue under a control.
        </p>
      ) : null}

      <fieldset disabled={pending || Boolean(save.saved)} aria-busy={pending || undefined} className="m-0 grid min-w-0 gap-4 border-0 p-0 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="result">Overall result</Label>
          <select id="result" name="result" className={selectClass} required>
            {allowedResults.map((value) => (
              <option key={value} value={value}>
                {inspectionResultLabels[value]}
              </option>
            ))}
          </select>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="inspectionDate">Date inspected</Label>
          <Input
            id="inspectionDate"
            name="inspectionDate"
            type="date"
            defaultValue={localDay()}
          />
        </div>

        <div className="space-y-1.5 sm:col-span-2">
          <Label htmlFor="summary">Summary</Label>
          <Textarea id="summary" name="summary" rows={3} maxLength={4000} defaultValue={summary ?? ""} />
        </div>
      </fieldset>

      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" disabled={pending || Boolean(save.saved)}>
          {pending ? "Submitting…" : "Submit for approval"}
        </Button>
        <UnsavedIndicator save={save} />
      </div>
    </form>
  );
}
