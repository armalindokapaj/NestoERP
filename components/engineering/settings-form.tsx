"use client";

import * as React from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { engineeringApi, failureMessage, fieldErrorsOf } from "./engineering-api";
import { FormFields, payloadFor, valuesFor, type FormField, type FormValues } from "./form-kit";

/** The company's contractor and engineering defaults (PRD #46 §279). */

const FIELDS: FormField[] = [
  { name: "rfiDefaultDueDays", label: "RFI response due after (days)", type: "number", required: true, hint: "Used when an RFI is opened without a due date." },
  { name: "submittalDefaultReviewDays", label: "Review due after submission (days)", type: "number", required: true, hint: "For submittals and engineering documents without a review date." },
  { name: "contractorComplianceReminderDays", label: "Compliance expiring window (days)", type: "number", required: true, hint: "An item inside this window is marked expiring and its owners are told." },
  { name: "dueSoonDays", label: "Due-soon notice (days ahead)", type: "number", required: true },
  { name: "allowSelfReview", label: "Allow a submitter to review their own revision", type: "checkbox", hint: "Off by default: somebody else decides." },
  { name: "requireSubmittalDueDate", label: "Require a review date on every submittal", type: "checkbox" },
];

export function EngineeringSettingsForm({ initial }: { initial: Record<string, unknown> }) {
  const router = useRouter();
  const toast = useToast();
  const [values, setValues] = React.useState<FormValues>(() => valuesFor(FIELDS, initial));
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [pending, setPending] = React.useState(false);

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    setErrors({});
    try {
      await engineeringApi("/api/engineering/settings", { method: "PUT", body: payloadFor(FIELDS, values) });
      toast({ title: "Engineering settings saved.", tone: "success" });
      router.refresh();
    } catch (failure) {
      setErrors(fieldErrorsOf(failure));
      toast({ title: failureMessage(failure), tone: "danger" });
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={save} className="nesto-card max-w-3xl space-y-5 p-5" data-testid="engineering-settings">
      <FormFields fields={FIELDS} values={values} errors={errors} idPrefix="engineering-settings" onChange={(name, value) => setValues((current) => ({ ...current, [name]: value }))} />
      <p className="text-table text-fg-muted">Contractors and Engineering are switched on or off for the company in Settings → Modules.</p>
      <div className="flex justify-end">
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : "Save settings"}
        </Button>
      </div>
    </form>
  );
}
