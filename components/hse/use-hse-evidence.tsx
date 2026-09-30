"use client";

import * as React from "react";

import { useDocumentsTranslations } from "@/components/documents/documents-text";
import { DeferredEvidence, type DeferredEvidenceHandle } from "@/components/field/deferred-evidence";
import type { FormActionResult } from "@/components/forms/record-form";
import { FormSection } from "@/components/forms/record-form";
import { useRouter } from "@/components/navigation/guarded-router";

/**
 * Photos on an HSE report (MOB-07 §53-§56). The report is created through its
 * own canonical action first; the photos then upload to the new record, so
 * every HSE rule, permission and escalation path is the one the desktop form
 * uses. Only forms created with `enabled` offer it; editing a record leaves
 * evidence to the record's own documents section.
 */
export function useHseEvidence(entityType: "hazard" | "incident", enabled: boolean) {
  const t = useDocumentsTranslations();
  const router = useRouter();
  const handle = React.useRef<DeferredEvidenceHandle>(null);
  const [host, setHost] = React.useState<HTMLElement | null>(null);

  const onSuccess = React.useCallback(
    (result: Extract<FormActionResult, { ok: true }>) => {
      const href = result.redirectTo;
      const entityId = href?.split("/").filter(Boolean).pop();
      if (!enabled || !href || !entityId || !handle.current?.hasFiles()) return false;
      void handle.current.commit({ entityType, entityId, continueHref: href, onDone: () => router.push(href) });
      return true;
    },
    [enabled, entityType, router],
  );

  return {
    onSuccess: enabled ? onSuccess : undefined,
    section: enabled ? (
      <FormSection title={t("capture.evidence")} description={t("capture.evidenceHint")}>
        <DeferredEvidence ref={handle} persistKey={`hse-${entityType}-new`} queueHost={host} groups={["image", "pdf"]} />
      </FormSection>
    ) : null,
    host: enabled ? <div ref={setHost} /> : null,
  };
}
