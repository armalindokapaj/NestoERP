"use client";

import * as React from "react";

import { FieldErrorProvider, type FormActionResult } from "@/components/forms/record-form";
import { useRouter } from "@/components/navigation/guarded-router";
import { Button } from "@/components/ui/button";
import { SaveMessages, UnsavedIndicator } from "@/components/unsaved/editor-status";
import { useEditorSave } from "@/components/unsaved/use-editor-save";
import { useUnsavedFrozen } from "@/components/unsaved/use-unsaved";
import { useSalesTranslations } from "@/components/sales/sales-text";

/**
 * A full-page form whose submit is a workflow step — converting a lead,
 * marking a deal won or lost (PRD #17 §52, §86, §93).
 *
 * RecordForm's machine with one difference: there is no ordinary save. The
 * form registers as `saveKind: "none"` with the step's verb, so leaving it with
 * input in it offers Stay or Discard and never runs the step as a "Save and
 * continue" (AUD-03 §3, §4). The step itself answers `committed(href)` and the
 * form goes there.
 */
export function WorkflowForm({
  action,
  cancelHref,
  submitLabel,
  pendingLabel,
  workflow,
  children,
}: {
  action: (formData: FormData) => Promise<FormActionResult>;
  cancelHref: string;
  submitLabel: string;
  pendingLabel: string;
  /** The step's verb, for the unsaved-changes prompt ("Mark won"). */
  workflow: string;
  children: React.ReactNode;
}) {
  const t = useSalesTranslations();
  const router = useRouter();
  const formRef = React.useRef<HTMLFormElement>(null);
  const frozen = useUnsavedFrozen();
  const save = useEditorSave({ formRef, action, module: "sales", saveKind: "none", workflow });
  const { pending, saved, fieldErrors } = save;

  return (
    <FieldErrorProvider value={fieldErrors}>
      <form ref={formRef} onSubmit={save.onSubmit} className="space-y-5">
        <SaveMessages save={save} />

        {/* The submitted snapshot goes as it was (AUD-03 §6). */}
        <fieldset disabled={pending || Boolean(saved)} aria-busy={pending || undefined} className="m-0 min-w-0 space-y-5 border-0 p-0">
          {children}
        </fieldset>

        <div className="flex flex-wrap items-center gap-2">
          <Button type="submit" disabled={pending || frozen || Boolean(saved)}>
            {pending ? pendingLabel : submitLabel}
          </Button>
          <Button type="button" variant="secondary" onClick={() => router.push(cancelHref)} disabled={pending}>
            {t("common.cancel")}
          </Button>
          <UnsavedIndicator save={save} />
        </div>
      </form>
    </FieldErrorProvider>
  );
}
