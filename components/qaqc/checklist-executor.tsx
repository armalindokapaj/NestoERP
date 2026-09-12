"use client";

import * as React from "react";
import { useRouter } from "next/navigation";

import { selectClass } from "@/components/forms/record-form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/toast";
import { saveChecklistAction } from "@/lib/actions/qaqc";
import type { ChecklistItemDTO } from "@/lib/modules/qaqc/qaqc.types";
import {
  allowsNotApplicable,
  isVerdictResponse,
  responseTypeLabels,
} from "@/lib/modules/qaqc/qaqc.status";

/**
 * Answering a checklist (PRD #21 §70, §71, §72).
 *
 * The snapshot on the inspection, not the template — so editing the template
 * later never changes what somebody was asked (§69).
 *
 * A failed check that needs evidence says so as soon as it is marked FAIL,
 * rather than waiting until the inspector tries to submit. The server enforces
 * the same rule either way (§57, §75).
 */
export function ChecklistExecutor({
  inspectionId,
  items,
  readOnly,
}: {
  inspectionId: string;
  items: ChecklistItemDTO[];
  readOnly: boolean;
}) {
  const router = useRouter();
  const toast = useToast();
  const [pending, startTransition] = React.useTransition();
  const [answers, setAnswers] = React.useState(() =>
    Object.fromEntries(
      items.map((item) => [
        item.id,
        {
          result: item.result ?? "",
          responseValue: item.responseValue ?? "",
          note: item.note ?? "",
        },
      ]),
    ),
  );

  function update(id: string, patch: Partial<(typeof answers)[string]>) {
    setAnswers((current) => ({ ...current, [id]: { ...current[id]!, ...patch } }));
  }

  function submit(formData: FormData) {
    startTransition(async () => {
      const result = await saveChecklistAction(inspectionId, formData);
      if (result.ok) {
        toast({ title: result.message ?? "Answers saved.", tone: "success" });
        router.refresh();
      } else {
        toast({ title: result.error, tone: "danger" });
      }
    });
  }

  if (items.length === 0) {
    return (
      <p className="nesto-card p-5 text-table text-fg-subtle">
        This inspection has no checklist. It was created without a template, so the verdict is
        recorded from the summary alone.
      </p>
    );
  }

  const body = (
    <ul className="space-y-3">
      {items.map((item, index) => {
        const answer = answers[item.id]!;
        const verdict = isVerdictResponse(item.responseType);
        const needsNote = answer.result === "FAIL" && item.requiresEvidenceOnFail;

        return (
          <li key={item.id} className="nesto-card space-y-3 p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-table font-medium text-fg">
                  {item.code ? <span className="text-fg-subtle">{item.code} · </span> : null}
                  {item.label}
                  {item.required ? (
                    <span className="ml-0.5 text-danger-strong" aria-hidden="true">
                      *
                    </span>
                  ) : null}
                </p>
                {item.description ? (
                  <p className="mt-1 text-meta text-fg-subtle">{item.description}</p>
                ) : null}
              </div>
              <span className="shrink-0 text-meta text-fg-subtle">
                {responseTypeLabels[item.responseType]}
              </span>
            </div>

            <input type="hidden" name={`answers[${index}][itemId]`} value={item.id} />

            {verdict ? (
              <div className="space-y-1.5">
                <Label htmlFor={`answer-${index}`}>Result</Label>
                <select
                  id={`answer-${index}`}
                  name={`answers[${index}][result]`}
                  className={selectClass}
                  value={answer.result}
                  onChange={(event) => update(item.id, { result: event.target.value })}
                  disabled={readOnly}
                >
                  <option value="">Not answered</option>
                  <option value="PASS">Pass</option>
                  <option value="FAIL">Fail</option>
                  {allowsNotApplicable(item.responseType) ? (
                    <option value="NA">Not applicable</option>
                  ) : null}
                </select>
              </div>
            ) : (
              <div className="space-y-1.5">
                <Label htmlFor={`answer-${index}`}>
                  {item.responseType === "NUMBER" ? "Measurement" : "Answer"}
                </Label>
                <Input
                  id={`answer-${index}`}
                  name={`answers[${index}][responseValue]`}
                  value={answer.responseValue}
                  onChange={(event) => update(item.id, { responseValue: event.target.value })}
                  inputMode={item.responseType === "NUMBER" ? "decimal" : undefined}
                  readOnly={readOnly}
                  maxLength={2000}
                />
              </div>
            )}

            <div className="space-y-1.5">
              <Label htmlFor={`note-${index}`}>
                Note{needsNote ? <span className="ml-0.5 text-danger-strong">*</span> : null}
              </Label>
              <Textarea
                id={`note-${index}`}
                name={`answers[${index}][note]`}
                rows={2}
                value={answer.note}
                onChange={(event) => update(item.id, { note: event.target.value })}
                readOnly={readOnly}
                maxLength={2000}
              />
              {needsNote && answer.note.trim() === "" ? (
                <p className="text-meta text-danger-strong">
                  This check needs a note explaining the failure before the inspection can be
                  submitted.
                </p>
              ) : null}
            </div>

            {item.passCriteriaText ? (
              <p className="text-meta text-fg-subtle">
                <span className="font-medium text-fg-muted">Passes when:</span>{" "}
                {item.passCriteriaText}
              </p>
            ) : null}
          </li>
        );
      })}
    </ul>
  );

  if (readOnly) return body;

  return (
    <form action={submit} className="space-y-4">
      {body}
      <Button type="submit" disabled={pending}>
        {pending ? "Saving…" : "Save answers"}
      </Button>
    </form>
  );
}
