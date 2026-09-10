"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils/cn";
import type { ActionResult } from "@/lib/actions/projects";

/**
 * Create / edit project form (PRD #10 §31, §32, §41).
 *
 * Grouped into sections rather than one long list of inputs. Validation runs
 * again on the server, which is the authority — this copy exists so the person
 * filling the form finds out sooner (PRD #7 §43).
 *
 * Navigating away with unsaved changes is intercepted (PRD #10 §151).
 */
export type ProjectFormValues = {
  code: string;
  name: string;
  description: string;
  clientId: string;
  projectManagerMemberId: string;
  status: string;
  priority: string;
  startDate: string;
  endDate: string;
  address: string;
  city: string;
  country: string;
};

export type SelectOption = { value: string; label: string };

function Field({
  label,
  name,
  error,
  hint,
  required,
  children,
}: {
  label: string;
  name: string;
  error?: string[];
  hint?: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={name}>
        {label}
        {required ? <span className="ml-0.5 text-danger-strong">*</span> : null}
      </Label>
      {children}
      {hint && !error ? <p className="text-meta text-fg-subtle">{hint}</p> : null}
      {error ? (
        <p id={`${name}-error`} className="text-meta text-danger-strong">
          {error[0]}
        </p>
      ) : null}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="nesto-card p-5">
      <h2 className="text-card font-semibold text-fg">{title}</h2>
      <div className="mt-4 grid gap-4 sm:grid-cols-2">{children}</div>
    </section>
  );
}

const selectClass =
  "h-10 w-full rounded-md border border-line bg-surface px-3 text-body text-fg transition-colors hover:border-line-strong focus:border-accent focus:outline-none focus:ring-2 focus:ring-ring/20";

export function ProjectForm({
  mode,
  initial,
  clients,
  managers,
  statuses,
  cancelHref,
  versionUpdatedAt,
  action,
}: {
  mode: "create" | "edit";
  initial: ProjectFormValues;
  clients: SelectOption[];
  managers: SelectOption[];
  statuses: SelectOption[];
  cancelHref: string;
  versionUpdatedAt?: string;
  action: (formData: FormData) => Promise<ActionResult>;
}) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const [error, setError] = React.useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = React.useState<Record<string, string[]>>({});
  const [dirty, setDirty] = React.useState(false);

  // Browser-level protection; the in-app guard is the confirm below.
  React.useEffect(() => {
    if (!dirty) return;
    const handler = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [dirty]);

  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    setError(null);
    setFieldErrors({});

    startTransition(async () => {
      const result = await action(formData);
      // A successful action redirects, so anything returned is a failure.
      if (result && !result.ok) {
        setError(result.error);
        setFieldErrors(result.fieldErrors ?? {});
      } else {
        setDirty(false);
      }
    });
  }

  function onCancel() {
    if (dirty && !window.confirm("Discard unsaved changes?")) return;
    router.push(cancelHref);
  }

  return (
    <form onSubmit={onSubmit} onChange={() => setDirty(true)} className="space-y-5">
      {versionUpdatedAt ? (
        <input type="hidden" name="versionUpdatedAt" value={versionUpdatedAt} />
      ) : null}

      {error ? (
        <p
          role="alert"
          className="rounded-md border border-danger/30 bg-danger-soft px-4 py-3 text-table text-danger-strong"
        >
          {error}
        </p>
      ) : null}

      <Section title="Project details">
        <Field label="Project name" name="name" required error={fieldErrors.name}>
          <Input
            id="name"
            name="name"
            defaultValue={initial.name}
            required
            maxLength={160}
            aria-invalid={Boolean(fieldErrors.name)}
            aria-describedby={fieldErrors.name ? "name-error" : undefined}
          />
        </Field>

        <Field
          label="Project code"
          name="code"
          required
          error={fieldErrors.code}
          hint="Unique inside your company, for example PRJ-001."
        >
          <Input
            id="code"
            name="code"
            defaultValue={initial.code}
            required
            maxLength={50}
            aria-invalid={Boolean(fieldErrors.code)}
            aria-describedby={fieldErrors.code ? "code-error" : undefined}
          />
        </Field>

        <div className="sm:col-span-2">
          <Field label="Description" name="description" error={fieldErrors.description}>
            <Textarea
              id="description"
              name="description"
              rows={4}
              defaultValue={initial.description}
              maxLength={5000}
            />
          </Field>
        </div>

        <Field label="Status" name="status" required error={fieldErrors.status}>
          <select id="status" name="status" defaultValue={initial.status} className={selectClass}>
            {statuses.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Priority" name="priority" error={fieldErrors.priority}>
          <select
            id="priority"
            name="priority"
            defaultValue={initial.priority}
            className={selectClass}
          >
            <option value="">No priority</option>
            <option value="LOW">Low</option>
            <option value="MEDIUM">Medium</option>
            <option value="HIGH">High</option>
            <option value="CRITICAL">Critical</option>
          </select>
        </Field>
      </Section>

      <Section title="Client & responsibility">
        <Field label="Client" name="clientId" error={fieldErrors.clientId}>
          <select
            id="clientId"
            name="clientId"
            defaultValue={initial.clientId}
            className={selectClass}
          >
            <option value="">No client</option>
            {clients.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </Field>

        <Field
          label="Project manager"
          name="projectManagerMemberId"
          error={fieldErrors.projectManagerMemberId}
          hint="The manager is added to the project team automatically."
        >
          <select
            id="projectManagerMemberId"
            name="projectManagerMemberId"
            defaultValue={initial.projectManagerMemberId}
            className={selectClass}
          >
            <option value="">Unassigned</option>
            {managers.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </Field>
      </Section>

      <Section title="Schedule">
        <Field label="Start date" name="startDate" error={fieldErrors.startDate}>
          <Input id="startDate" name="startDate" type="date" defaultValue={initial.startDate} />
        </Field>
        <Field label="End date" name="endDate" error={fieldErrors.endDate}>
          <Input
            id="endDate"
            name="endDate"
            type="date"
            defaultValue={initial.endDate}
            aria-invalid={Boolean(fieldErrors.endDate)}
            aria-describedby={fieldErrors.endDate ? "endDate-error" : undefined}
          />
        </Field>
      </Section>

      <Section title="Location">
        <div className="sm:col-span-2">
          <Field label="Address" name="address" error={fieldErrors.address}>
            <Input id="address" name="address" defaultValue={initial.address} maxLength={300} />
          </Field>
        </div>
        <Field label="City" name="city" error={fieldErrors.city}>
          <Input id="city" name="city" defaultValue={initial.city} maxLength={120} />
        </Field>
        <Field label="Country" name="country" error={fieldErrors.country}>
          <Input id="country" name="country" defaultValue={initial.country} maxLength={120} />
        </Field>
      </Section>

      <div
        className={cn(
          "flex flex-wrap items-center justify-end gap-2",
          "sticky bottom-0 -mx-4 border-t border-line bg-surface/95 px-4 py-3 backdrop-blur md:static md:mx-0 md:border-0 md:bg-transparent md:px-0 md:backdrop-blur-none",
        )}
      >
        <Button type="button" variant="secondary" onClick={onCancel} disabled={pending}>
          Cancel
        </Button>
        <Button type="submit" disabled={pending}>
          {pending
            ? mode === "create"
              ? "Creating…"
              : "Saving…"
            : mode === "create"
              ? "Create project"
              : "Save changes"}
        </Button>
      </div>

      <p className="text-meta text-fg-subtle">
        Need to leave?{" "}
        <Link href={cancelHref} className="underline underline-offset-2">
          Return without saving
        </Link>
        .
      </p>
    </form>
  );
}
