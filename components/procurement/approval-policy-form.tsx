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
import { ROLE_KEYS, roles } from "@/config/roles";
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
    label: "Approval limits",
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
        error: json?.error?.message ?? "The limits could not be saved.",
        fieldErrors: (json?.error?.details ?? {}) as Record<string, string[]>,
      };
    },
    onCommitted: () => {
      toast({ title: "Approval limits saved", description: "They apply to orders submitted from now on.", tone: "success" });
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
          <FormSection title="When an order needs more than Procurement" description={`Order totals in ${policy.currency}, the company's base currency. Orders in another currency take every step you set.`}>
            <Field label="Finance decides above" name="financeStepAbove" hint="Leave empty for no Finance step.">
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
            <Field label="An executive decides above" name="executiveStepAbove" hint="Leave empty for no executive step.">
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
            <Field label="The executive decision is taken by" name="executiveRoleKey" hint="Whoever holds this role and can open the order.">
              <select id="executiveRoleKey" name="executiveRoleKey" className={selectClass} value={form.executiveRoleKey} disabled={!canManage} onChange={(event) => setForm({ ...form, executiveRoleKey: event.target.value as typeof form.executiveRoleKey })}>
                {ROLE_KEYS.filter((key) => key !== "VIEWER").map((key) => (
                  <option key={key} value={key}>
                    {roles[key].label}
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
              Save limits
            </Button>
          </div>
        ) : (
          <p className="text-meta text-fg-subtle">Only a procurement manager can change these limits.</p>
        )}
      </form>
    </FieldErrorProvider>
  );
}
