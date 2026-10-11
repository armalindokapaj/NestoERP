"use client";

import * as React from "react";
import { useRouter } from "@/components/navigation/guarded-router";

import { selectClass } from "@/components/forms/record-form";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/toast";
import { SaveMessages, UnsavedIndicator } from "@/components/unsaved/editor-status";
import { useEditorSave } from "@/components/unsaved/use-editor-save";
import { executeInspectionAction } from "@/lib/actions/hse";
import {
  allowedChecklistResults,
  responseTypeLabels,
  severityLabels,
} from "@/lib/modules/hse/hse.status";
import type { ChecklistItemDTO } from "@/lib/modules/hse/hse.types";
import { useHseServerText, useHseTranslations } from "@/components/hse/hse-text";
import { hseLabel } from "@/lib/i18n/modules/hse/labels";
import { FormSelect } from "@/components/ui/form-select";

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
type ChecklistExecutorProps = {
  inspectionId: string;
  items: ChecklistItemDTO[];
  readOnly: boolean;
  versionUpdatedAt?: string;
};

export function ChecklistExecutor(props: ChecklistExecutorProps) {
  // Remounted when it turns editable (or back), so the editor's tracking
  // attaches to the form that is actually rendered (AUD-03 §3).
  return <ChecklistEditor key={`${props.readOnly}-${props.items.length > 0}`} {...props} />;
}

function ChecklistEditor({ inspectionId, items, readOnly, versionUpdatedAt }: ChecklistExecutorProps) {
  const t = useHseTranslations();
  const router = useRouter();
  const toast = useToast();
  const serverText = useHseServerText();
  const formRef = React.useRef<HTMLFormElement>(null);
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

  /**
   * Many answers held before one save, so the checklist is an editor under
   * the unsaved-work contract (AUD-03 §3): leaving with unsaved answers asks
   * first, and "Save and continue" runs this same t("page.saveChecklist"). Saving is
   * ordinary — submitting the inspection is the separate panel below. Read-only,
   * no form is rendered, so the editor never holds anything unsaved.
   */
  const save = useEditorSave({
    formRef,
    action: (formData: FormData) => executeInspectionAction(inspectionId, formData),
    module: "hse",
    saveKind: "save",
    label: t("record.checklist"),
    onCommitted: (result, mode) => {
      if (mode === "normal") {
        toast({ title: serverText(result?.message) ?? t("exec.saved"), tone: "success" });
        router.refresh();
      }
      return true;
    },
  });
  const { pending } = save;

  if (items.length === 0) {
    return (
      <p className="nesto-card p-5 text-table text-fg-subtle">{t("exec.noChecklist")}</p>
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
                    {t("template.detail.ifFailed", { severity: hseLabel(t, "severity", item.riskIfFailed, severityLabels[item.riskIfFailed]) })}
                  </Badge>
                ) : null}
                {hseLabel(t, "responseType", item.responseType, responseTypeLabels[item.responseType])}
              </span>
            </div>

            <input type="hidden" name={`answers[${index}][itemId]`} value={item.id} />

            {verdict ? (
              <div className="space-y-1.5">
                <Label htmlFor={`answer-${index}`}>{t("inspection.detail.result")}</Label>
                <FormSelect
                  id={`answer-${index}`}
                  name={`answers[${index}][result]`}
                  className={selectClass}
                  value={answer.result}
                  onChange={(event) => update(item.id, { result: event.target.value })}
                  disabled={readOnly}
                >
                  <option value="">{t("exec.notAnswered")}</option>
                  {allowed.map((value) => (
                    <option key={value} value={value}>
                      {value === "PASS" ? t("exec.pass") : value === "FAIL" ? t("exec.fail") : t("exec.notApplicable")}
                    </option>
                  ))}
                </FormSelect>
              </div>
            ) : (
              <>
                <div className="space-y-1.5">
                  <Label htmlFor={`answer-${index}`}>
                    {item.responseType === "NUMBER" ? t("exec.measurement") : t("exec.answer")}
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
                  <Label htmlFor={`verdict-${index}`}>{t("exec.verdict")}</Label>
                  <FormSelect
                    id={`verdict-${index}`}
                    name={`answers[${index}][result]`}
                    className={selectClass}
                    value={answer.result}
                    onChange={(event) => update(item.id, { result: event.target.value })}
                    disabled={readOnly}
                  >
                    <option value="">{t("exec.notAnswered")}</option>
                    {allowed.map((value) => (
                      <option key={value} value={value}>
                        {value === "PASS" ? t("exec.pass") : value === "FAIL" ? t("exec.fail") : t("exec.notApplicable")}
                      </option>
                    ))}
                  </FormSelect>
                </div>
              </>
            )}

            <div className="space-y-1.5">
              <Label htmlFor={`note-${index}`}>
                {t("people.note")}{needsNote ? <span className="ml-0.5 text-danger-strong">*</span> : null}
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
                  {t("exec.needsNote")}
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
    <form ref={formRef} onSubmit={save.onSubmit} className="space-y-4">
      {versionUpdatedAt ? (
        <input type="hidden" name="versionUpdatedAt" value={versionUpdatedAt} />
      ) : null}

      <SaveMessages save={save} />

      {/* The submitted answers save as they were: nothing changes meanwhile (§6). */}
      <fieldset disabled={pending || Boolean(save.saved)} aria-busy={pending || undefined} className="m-0 min-w-0 border-0 p-0">
        {body}
      </fieldset>

      {failed.length > 0 ? (
        <p className="rounded-lg border border-warning-border bg-warning-subtle p-4 text-meta text-warning-strong">
          {t("exec.failedCount", { count: failed.length })}
        </p>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" disabled={pending}>
          {pending ? t("page.saving") : t("page.saveChecklist")}
        </Button>
        <UnsavedIndicator save={save} />
      </div>
    </form>
  );
}
