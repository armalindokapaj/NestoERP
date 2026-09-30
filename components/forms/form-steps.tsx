"use client";

import * as React from "react";

import { useTranslations } from "@/components/i18n/i18n-provider";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils/cn";

/**
 * A multi-step form (MOB-04 §44-§46), for a workflow whose length justifies it
 * — not every form. Put it inside a `RecordForm`: every step's fields stay in
 * the one form (hidden, not unmounted), so one submit sends all of them, the
 * unsaved-changes guard counts all of them, and validation is the form's own —
 * a step is never stricter on a phone than on desktop.
 *
 * The phone header is one compact line, "Step 2 of 4 · Financial", with a thin
 * progress bar, not a stepper that eats the top of the screen. Next checks the
 * step's own native constraints (required, pattern, min/max) and stays put with
 * the message when one fails; Back never validates. The last step is where the
 * form's own submit button belongs (a "Review" step).
 */
export type FormStep = { id: string; title: string; content: React.ReactNode };

export function FormSteps({ steps, initial = 0, className }: { steps: FormStep[]; initial?: number; className?: string }) {
  const t = useTranslations("ui");
  const [index, setIndex] = React.useState(Math.min(Math.max(initial, 0), steps.length - 1));
  const [blocked, setBlocked] = React.useState(false);
  const panels = React.useRef<Record<string, HTMLDivElement | null>>({});
  const heading = React.useRef<HTMLParagraphElement>(null);
  const last = index === steps.length - 1;
  const step = steps[index];

  function next() {
    const panel = panels.current[step.id];
    const invalid = panel ? Array.from(panel.querySelectorAll<HTMLInputElement>("input, select, textarea")).find((el) => !el.disabled && el.willValidate && !el.checkValidity()) : undefined;
    if (invalid) {
      setBlocked(true);
      invalid.focus({ preventScroll: false });
      invalid.reportValidity?.();
      return;
    }
    setBlocked(false);
    setIndex((current) => Math.min(current + 1, steps.length - 1));
  }

  function back() {
    setBlocked(false);
    setIndex((current) => Math.max(current - 1, 0));
  }

  React.useEffect(() => {
    heading.current?.focus({ preventScroll: true });
  }, [index]);

  return (
    <div className={cn("space-y-4", className)} data-form-steps>
      <div>
        <p ref={heading} tabIndex={-1} aria-live="polite" className="text-body font-semibold text-fg outline-none" data-step-heading>
          {t("mob04StepOf", { current: index + 1, total: steps.length })} · {step.title}
        </p>
        <div className="mt-2 h-1 overflow-hidden rounded-full bg-hover" role="presentation">
          <div className="h-full rounded-full bg-accent transition-[width]" style={{ width: `${((index + 1) / steps.length) * 100}%` }} />
        </div>
      </div>

      {steps.map((entry, position) => (
        <div key={entry.id} ref={(node) => { panels.current[entry.id] = node; }} hidden={position !== index} data-step={entry.id} className="space-y-5">
          {entry.content}
        </div>
      ))}

      {blocked ? (
        <p role="alert" className="text-table text-danger-strong">
          {t("mob04StepInvalid")}
        </p>
      ) : null}

      <div className="flex items-center justify-between gap-2">
        <Button type="button" variant="secondary" onClick={back} disabled={index === 0}>
          {t("back")}
        </Button>
        {last ? null : (
          <Button type="button" onClick={next}>
            {t("next")}
          </Button>
        )}
      </div>
    </div>
  );
}
