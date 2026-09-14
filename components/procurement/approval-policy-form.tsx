"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";

import { Field, FieldErrorProvider, FormSection, selectClass } from "@/components/forms/record-form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
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
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = React.useState<Record<string, string[]>>({});

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    setError(null);
    setFieldErrors({});
    const response = await fetch("/api/procurement/approval-policy", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ financeStepAbove: form.financeStepAbove || null, executiveStepAbove: form.executiveStepAbove || null, executiveRoleKey: form.executiveRoleKey }),
    }).catch(() => null);
    setPending(false);
    if (!response?.ok) {
      const json = await response?.json().catch(() => null);
      const details = (json?.error?.details ?? {}) as Record<string, string[]>;
      setFieldErrors(details);
      setError(json?.error?.message ?? "The limits could not be saved.");
      return;
    }
    toast({ title: "Approval limits saved", description: "They apply to orders submitted from now on.", tone: "success" });
    router.refresh();
  }

  return (
    <FieldErrorProvider value={fieldErrors}>
      <form onSubmit={onSubmit} className="space-y-5" data-testid="approval-policy-form">
        {error ? (
          <p role="alert" className="rounded-md border border-danger/30 bg-danger-soft px-4 py-3 text-table text-danger-strong">
            {error}
          </p>
        ) : null}
        <FormSection title="When an order needs more than Procurement" description={`Order totals in ${policy.currency}, the company's base currency. Orders in another currency take every step you set.`}>
          <Field label="Finance decides above" name="financeStepAbove" hint="Leave empty for no Finance step.">
            <Input
              id="financeStepAbove"
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
              inputMode="decimal"
              value={form.executiveStepAbove}
              disabled={!canManage}
              onChange={(event) => setForm({ ...form, executiveStepAbove: event.target.value })}
              placeholder="75000.00"
            />
          </Field>
          <Field label="The executive decision is taken by" name="executiveRoleKey" hint="Whoever holds this role and can open the order.">
            <select id="executiveRoleKey" className={selectClass} value={form.executiveRoleKey} disabled={!canManage} onChange={(event) => setForm({ ...form, executiveRoleKey: event.target.value as typeof form.executiveRoleKey })}>
              {ROLE_KEYS.filter((key) => key !== "VIEWER").map((key) => (
                <option key={key} value={key}>
                  {roles[key].label}
                </option>
              ))}
            </select>
          </Field>
        </FormSection>
        {canManage ? (
          <div className="flex justify-end">
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
