"use client";

import * as React from "react";
import { useRouter } from "next/navigation";

import { selectClass } from "@/components/forms/record-form";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/toast";
import { executeInspectionAction } from "@/lib/actions/hse";
import {
  allowedChecklistResults,
  responseTypeLabels,
  severityLabels,
} from "@/lib/modules/hse/hse.status";
import type { ChecklistItemDTO } from "@/lib/modules/hse/hse.types";

/**
 * Answering a safety checklist (PRD #22 §311, §312, §313).
 *
 * The snapshot on the inspection, not the template — so editing the template
 * later never changes what somebody was asked (§47).
 *
 * A failed check that needs a note says so the moment it is marked FAIL rather
 * than waiting for the inspector to try to submit, and a check whose failure
 * carries a risk rating says what that rating is. The server enforces the same
 * rules either way (§49, §51).
 *
 * Built for a phone held in one hand on a site (§334): each item is its own
 * card, the controls are full width, and answers save in one go so a lost
 * signal halfway round does not lose the first half.
 */
export function ChecklistExecutor({
  inspectionId,
  items,
  readOnly,
  versionUpdatedAt,
}: {
  inspectionId: string;
  items: ChecklistItemDTO[];
  readOnly: boolean;
  versionUpdatedAt?: string;
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
      const result = await executeInspectionAction(inspectionId, formData);
      if (result.ok) {
        toast({ title: result.message ?? "Checklist saved.", tone: "success" });
        router.refresh();
      } else {
        toast({ title: result.error, tone: "danger" });
      }
    });
  }

  if (items.length === 0) {
    return (
      <p className="nesto-card p-5 text-table text-fg-subtle">
        This inspection has no checklist. It was raised without one, so the verdict is recorded
        from the summary alone.
      </p>
    );
  }

  const failed = items.filter((item) => answers[item.id]?.result === "FAIL");

  const body = (
    <ul className="space-y-3">
      {items.map((item, index) => {
        const answer = answers[item.id]!;
        const allowed = allowedChecklistResults(item.responseType);
        const verdict = item.responseType !== "TEXT" && item.responseType !== "NUMBER";
        const needsNote = answer.result === "FAIL" && item.requiresNoteOnFail;

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
              <span className="flex shrink-0 items-center gap-2 text-meta text-fg-subtle">
                {/* What failing this one actually means, said up front (§48). */}
                {item.riskIfFailed ? (
                  <Badge
                    tone={
                      item.riskIfFailed === "CRITICAL"
                        ? "danger"
                        : item.riskIfFailed === "HIGH"
                          ? "warning"
                          : "neutral"
                    }
                  >
                    {severityLabels[item.riskIfFailed]} if failed
                  </Badge>
                ) : null}
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
                  {allowed.map((value) => (
                    <option key={value} value={value}>
                      {value === "PASS" ? "Pass" : value === "FAIL" ? "Fail" : "Not applicable"}
                    </option>
                  ))}
                </select>
              </div>
            ) : (
              <>
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
                    maxLength={500}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor={`verdict-${index}`}>Verdict</Label>
                  <select
                    id={`verdict-${index}`}
                    name={`answers[${index}][result]`}
                    className={selectClass}
                    value={answer.result}
                    onChange={(event) => update(item.id, { result: event.target.value })}
                    disabled={readOnly}
                  >
                    <option value="">Not answered</option>
                    {allowed.map((value) => (
                      <option key={value} value={value}>
                        {value === "PASS" ? "Pass" : value === "FAIL" ? "Fail" : "Not applicable"}
                      </option>
                    ))}
                  </select>
                </div>
              </>
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
          </li>
        );
      })}
    </ul>
  );

  if (readOnly) return body;

  return (
    <form action={submit} className="space-y-4">
      {versionUpdatedAt ? (
        <input type="hidden" name="versionUpdatedAt" value={versionUpdatedAt} />
      ) : null}

      {body}

      {failed.length > 0 ? (
        <p className="rounded-lg border border-warning-border bg-warning-subtle p-4 text-meta text-warning-strong">
          {failed.length} {failed.length === 1 ? "check has" : "checks have"} failed. This
          inspection cannot be submitted as a pass — raise a hazard or an action for what you
          found.
        </p>
      ) : null}

      <Button type="submit" disabled={pending}>
        {pending ? "Saving…" : "Save checklist"}
      </Button>
    </form>
  );
}
