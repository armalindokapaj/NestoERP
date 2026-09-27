"use client";

import * as React from "react";
import { useRouter } from "@/components/navigation/guarded-router";
import { Loader2 } from "lucide-react";

import { Field, FieldErrorProvider, FormSection, selectClass } from "@/components/forms/record-form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { SaveMessages, UnsavedIndicator } from "@/components/unsaved/editor-status";
import { useEditorSave } from "@/components/unsaved/use-editor-save";
import { useProcurementServerText, useProcurementTranslations } from "@/components/procurement/procurement-text";
import { ROLE_KEYS } from "@/config/roles";
import { useTranslations } from "@/components/i18n/i18n-provider";
import type { ProcurementApprovalPolicyDTO } from "@/lib/modules/procurement/approvals/approval.policy";

/**
 * Purchase order approval limits (PRD #41 §27, §28, §158, §159).
 *
 * Procurement's own settings, edited here and nowhere else: the Approvals
 * Center only shows the chain these limits produce. A change applies to
 * orders submitted from now on — an order already in a chain keeps the steps
 * it was submitted with.
 */
export function ApprovalPolicyForm({ policy, canManage }: { policy: ProcurementApprovalPolicyDTO; canManage: boolean }) {
  const router = useRouter();
  const toast = useToast();
  const t = useProcurementTranslations();
  const serverText = useProcurementServerText();
  const tRoles = useTranslations("roles");
  const [form, setForm] = React.useState({
    financeStepAbove: policy.financeStepAbove ?? "",
    executiveStepAbove: policy.executiveStepAbove ?? "",
    executiveRoleKey: policy.executiveRoleKey,
  });
  const formRef = React.useRef<HTMLFormElement>(null);
  // AUD-03 §3, §6: an API-route save under the contract. A thrown request stays
  // thrown, so the hook says the outcome is unknown instead of guessing.
  const save = useEditorSave({
    formRef,
    module: "procurement",
    saveKind: "save",
    label: t("limits.editorLabel"),
    action: async (formData: FormData) => {
      const response = await fetch("/api/procurement/approval-policy", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          financeStepAbove: String(formData.get("financeStepAbove") ?? "") || null,
          executiveStepAbove: String(formData.get("executiveStepAbove") ?? "") || null,
          executiveRoleKey: formData.get("executiveRoleKey"),
        }),
      });
      if (response.ok) return { ok: true as const };
      const json = await response.json().catch(() => null);
      return {
        ok: false as const,
        code: json?.error?.details?.code ?? json?.error?.code,
        error: serverText(json?.error?.message) ?? t("limits.saveFailed"),
        fieldErrors: (json?.error?.details ?? {}) as Record<string, string[]>,
      };
    },
    onCommitted: () => {
      toast({ title: t("limits.saved"), description: t("limits.savedDescription"), tone: "success" });
      router.refresh();
      return true;
    },
  });
  const { pending, fieldErrors } = save;

  return (
    <FieldErrorProvider value={fieldErrors}>
      <form ref={formRef} onSubmit={save.onSubmit} className="space-y-5" data-testid="approval-policy-form">
        <SaveMessages save={save} />
        <fieldset disabled={pending || Boolean(save.saved)} className="m-0 min-w-0 space-y-5 border-0 p-0">
          <FormSection title={t("limits.sectionTitle")} description={t("limits.sectionDescription", { currency: policy.currency })}>
            <Field label={t("limits.financeAbove")} name="financeStepAbove" hint={t("limits.financeHint")}>
              <Input
                id="financeStepAbove"
                name="financeStepAbove"
                inputMode="decimal"
                value={form.financeStepAbove}
                disabled={!canManage}
                onChange={(event) => setForm({ ...form, financeStepAbove: event.target.value })}
                placeholder="25000.00"
              />
            </Field>
            <Field label={t("limits.executiveAbove")} name="executiveStepAbove" hint={t("limits.executiveHint")}>
              <Input
                id="executiveStepAbove"
                name="executiveStepAbove"
                inputMode="decimal"
                value={form.executiveStepAbove}
                disabled={!canManage}
                onChange={(event) => setForm({ ...form, executiveStepAbove: event.target.value })}
                placeholder="75000.00"
              />
            </Field>
            <Field label={t("limits.executiveRole")} name="executiveRoleKey" hint={t("limits.executiveRoleHint")}>
              <select id="executiveRoleKey" name="executiveRoleKey" className={selectClass} value={form.executiveRoleKey} disabled={!canManage} onChange={(event) => setForm({ ...form, executiveRoleKey: event.target.value as typeof form.executiveRoleKey })}>
                {ROLE_KEYS.filter((key) => key !== "VIEWER").map((key) => (
                  <option key={key} value={key}>
                    {tRoles(`${key}.label`)}
                  </option>
                ))}
              </select>
            </Field>
          </FormSection>
        </fieldset>
        {canManage ? (
          <div className="flex items-center justify-end gap-2">
            <UnsavedIndicator save={save} />
            <Button type="submit" disabled={pending}>
              {pending ? <Loader2 aria-hidden="true" className="animate-spin" /> : null}
              {t("limits.save")}
            </Button>
          </div>
        ) : (
          <p className="text-meta text-fg-subtle">{t("limits.onlyManager")}</p>
        )}
      </form>
    </FieldErrorProvider>
  );
}
