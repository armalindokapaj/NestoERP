"use client";

import * as React from "react";

import { isFailure } from "@/components/project-planning/planning-api";
import { parseOptionalDecimal, type DecimalRule } from "@/lib/forms/decimal";
import { cn } from "@/lib/utils/cn";

export { failureMessage, isFailure, planningApi as structureApi } from "@/components/project-planning/planning-api";

/**
 * Presentation pieces shared by the structure screens (E-05B §31-§33, §94).
 * The server has already decided every change; these relay its answer, with
 * field messages beside the field they belong to.
 */

export function Field({ label, htmlFor, error, hint, required, children, className }: { label: string; htmlFor: string; error?: string; hint?: string; required?: boolean; children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("flex min-w-0 flex-col gap-1", className)}>
      <label htmlFor={htmlFor} className="text-meta font-medium text-fg-muted">
        {label}
        {required ? <span aria-hidden="true"> *</span> : null}
      </label>
      {children}
      {error ? (
        <p id={`${htmlFor}-error`} className="text-meta text-danger-strong">
          {error}
        </p>
      ) : hint ? (
        <p className="text-meta text-fg-subtle">{hint}</p>
      ) : null}
    </div>
  );
}

/** Field messages from a failure: `{ field: [message] }`, or `details.field` naming the one the message is about. */
export function fieldErrors(error: unknown): Record<string, string> {
  if (!isFailure(error)) return {};
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(error.details)) if (Array.isArray(value) && typeof value[0] === "string") result[key] = value[0];
  if (typeof error.details.field === "string") result[error.details.field] = error.message;
  return result;
}

export function FormError({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <p role="alert" className="rounded-md border border-danger/30 bg-danger-soft px-3 py-2 text-table text-danger-strong">
      {message}
    </p>
  );
}

export function Warnings({ items }: { items: string[] }) {
  if (!items.length) return null;
  return (
    <ul className="space-y-1 rounded-md border border-warning/30 bg-warning-soft px-3 py-2 text-table text-warning-strong" data-testid="unit-warnings">
      {items.map((item) => (
        <li key={item}>{item}</li>
      ))}
    </ul>
  );
}

export function Steps({ steps, current }: { steps: string[]; current: number }) {
  return (
    <ol className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-meta" aria-label="Steps">
      {steps.map((step, index) => (
        <li key={step} className="flex items-center gap-2" aria-current={index === current ? "step" : undefined}>
          <span className={cn("inline-flex size-5 items-center justify-center rounded-full border text-micro tabular-nums", index === current ? "border-accent bg-accent text-accent-fg" : index < current ? "border-line-strong bg-hover text-fg" : "border-line text-fg-subtle")}>{index + 1}</span>
          <span className={index === current ? "font-medium text-fg" : "text-fg-muted"}>{step}</span>
          {index < steps.length - 1 ? <span aria-hidden="true" className="text-fg-subtle">·</span> : null}
        </li>
      ))}
    </ol>
  );
}

export function areaText(value: string | null): string {
  return value === null ? "—" : `${Number(value).toLocaleString("en", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} m²`;
}

export function countText(value: number | null): string {
  return value === null ? "—" : String(value);
}

export const plural = (count: number, one: string, many = `${one}s`) => `${count} ${count === 1 ? one : many}`;

/**
 * A number field that keeps what was typed as text, so "12." is not lost
 * mid-typing. It no longer turns a comma into a point: `1,234` is a thousand
 * to one reader and 1.234 to another, and the shared locale rule
 * (`lib/forms/decimal`, the same as finance) refuses it rather than guess
 * (AUD-09 §4, FV-06). Letters are dropped; separators and spaces are kept for
 * the rule to judge.
 */
export function numberText(value: string) {
  return value.replace(/[^\d.,\s\u00a0\u202f-]/g, "");
}

/** An area in m²: two decimals, within DECIMAL(12,2), never negative (E-05B §23). */
export const areaRule = (label: string): DecimalRule => ({ label, scale: 2, maxIntegerDigits: 10 });
/** Metres (frontage, ceiling height): two decimals, within DECIMAL(10,2); may be below the datum. */
export const metresRule = (label: string): DecimalRule => ({ label, scale: 2, maxIntegerDigits: 8, allowNegative: true });

/**
 * What a typed number sends: the canonical decimal string when the shared
 * rule reads it, `null` when empty, and the text as typed otherwise — so the
 * server refuses it on its field instead of the form guessing (FV-06).
 */
export function decimalPayload(text: string, rule: DecimalRule): string | null {
  const parsed = parseOptionalDecimal(text, rule);
  return parsed.ok ? parsed.value : text.trim();
}

/** The shared rule's sentence for a typed number, or null when it reads (or is empty). */
export function decimalProblem(text: string, rule: DecimalRule): string | null {
  const parsed = parseOptionalDecimal(text, rule);
  return parsed.ok ? null : parsed.message;
}
