"use client";

import * as React from "react";
import { useRouter } from "next/navigation";

import { selectClass } from "@/components/forms/record-form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/toast";
import { submitInspectionAction } from "@/lib/actions/hse";
import { checklistGapLabel } from "./gap-labels";
import { inspectionResultLabels } from "@/lib/modules/hse/hse.status";
import type { ChecklistGap } from "@/lib/modules/hse/hse.status";
import type { HseInspectionResult } from "@prisma/client";

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
}: {
  inspectionId: string;
  gaps: ChecklistGap[];
  allowedResults: HseInspectionResult[];
  versionUpdatedAt?: string;
}) {
  const router = useRouter();
  const toast = useToast();
  const [pending, startTransition] = React.useTransition();
  const ready = gaps.length === 0;

  function submit(formData: FormData) {
    startTransition(async () => {
      const result = await submitInspectionAction(inspectionId, formData);
      if (result.ok) {
        toast({ title: result.message ?? "Submitted.", tone: "success" });
        router.refresh();
      } else {
        toast({ title: result.error, tone: "danger" });
      }
    });
  }

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

  const passBlocked = !allowedResults.includes("PASS");

  return (
    <form action={submit} id="submit" className="nesto-card space-y-4 p-5">
      <h2 className="text-table font-medium text-fg">Submit this inspection</h2>

      {versionUpdatedAt ? (
        <input type="hidden" name="versionUpdatedAt" value={versionUpdatedAt} />
      ) : null}

      {passBlocked ? (
        <p className="rounded-lg border border-warning-border bg-warning-subtle p-3 text-meta text-warning-strong">
          A required check failed, so this inspection cannot pass. It can still be conditional if
          the work may continue under a control.
        </p>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2">
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
            defaultValue={new Date().toISOString().slice(0, 10)}
          />
        </div>

        <div className="space-y-1.5 sm:col-span-2">
          <Label htmlFor="summary">Summary</Label>
          <Textarea id="summary" name="summary" rows={3} maxLength={4000} />
        </div>
      </div>

      <Button type="submit" disabled={pending}>
        {pending ? "Submitting…" : "Submit for approval"}
      </Button>
    </form>
  );
}
