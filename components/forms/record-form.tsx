"use client";

import * as React from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils/cn";

/**
 * The shared create/edit form shell (PRD #7 §43, PRD #10 §151).
 *
 * Every module's record form is the same machine: grouped sections, field-level
 * errors returned by the server, a dirty guard on navigation and a single
 * pending state. Only the fields differ.
 *
 * Client-side validation exists so the person filling the form finds out
 * sooner. The server is still the authority and validates again.
 */

export type SelectOption = { value: string; label: string };

export type FormActionResult =
  | { ok: true }
  | { ok: false; error: string; fieldErrors?: Record<string, string[]> };

const FieldErrorContext = React.createContext<Record<string, string[]>>({});

export function useFieldErrors() {
  return React.useContext(FieldErrorContext);
}

/**
 * Exported so a form that owns its own submit path — Clients needs one for
 * "Create anyway" past a duplicate warning — still feeds the same `Field`
 * components the same errors.
 */
export function FieldErrorProvider({
  value,
  children,
}: {
  value: Record<string, string[]>;
  children: React.ReactNode;
}) {
  return <FieldErrorContext.Provider value={value}>{children}</FieldErrorContext.Provider>;
}

export const selectClass =
  "h-10 w-full rounded-md border border-line bg-surface px-3 text-body text-fg transition-colors hover:border-line-strong focus:border-accent focus:outline-none focus:ring-2 focus:ring-ring/20";

export function Field({
  label,
  name,
  hint,
  required,
  className,
  children,
}: {
  label: string;
  name: string;
  hint?: string;
  required?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  const errors = useFieldErrors();
  const error = errors[name];

  return (
    <div className={cn("space-y-1.5", className)}>
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

export function FormSection({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="nesto-card p-5">
      <h2 className="text-card font-semibold text-fg">{title}</h2>
      {description ? <p className="mt-1 text-meta text-fg-subtle">{description}</p> : null}
      <div className="mt-4 grid gap-4 sm:grid-cols-2">{children}</div>
    </section>
  );
}

export function RecordForm({
  action,
  cancelHref,
  submitLabel,
  pendingLabel,
  versionUpdatedAt,
  children,
}: {
  action: (formData: FormData) => Promise<FormActionResult>;
  cancelHref: string;
  submitLabel: string;
  pendingLabel: string;
  /** Optimistic-concurrency stamp the form was loaded with. */
  versionUpdatedAt?: string;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const [error, setError] = React.useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = React.useState<Record<string, string[]>>({});
  const [dirty, setDirty] = React.useState(false);

  // Browser-level protection; the in-app guard is the cancel confirm below.
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
    <FieldErrorContext.Provider value={fieldErrors}>
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

        {children}

        <div className="flex flex-wrap items-center gap-2">
          <Button type="submit" disabled={pending}>
            {pending ? pendingLabel : submitLabel}
          </Button>
          <Button type="button" variant="secondary" onClick={onCancel} disabled={pending}>
            Cancel
          </Button>
        </div>
      </form>
    </FieldErrorContext.Provider>
  );
}
