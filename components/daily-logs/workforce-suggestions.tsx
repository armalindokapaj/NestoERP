"use client";

import * as React from "react";
import { UsersRound } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogTitle } from "@/components/ui/dialog";
import { useUnsavedEditor } from "@/components/unsaved/use-unsaved";
import type { SaveOutcome } from "@/lib/unsaved/coordinator";
import { OUTCOME_COPY } from "@/lib/unsaved/outcome";
import type { WorkforceSuggestion } from "@/lib/modules/daily-logs/daily-log.workforce";
import { dailyLogApi, dailyLogFailureOutcome, failureMessage } from "./daily-log-api";

/**
 * "From crews" in a log's workforce section (E-04 §182): the project's crews
 * and assigned people that day, with the headcount the site sheet or the crew
 * list gives — picked, then added as ordinary entries the writer can still
 * correct. Nothing is added without being picked.
 */

const BASIS: Record<WorkforceSuggestion["basis"], string> = { ATTENDANCE: "marked present on the site sheet", CREW: "in the crew that day", ASSIGNED: "assigned, in no crew" };

export function WorkforceSuggestions({ base, onApplied }: { base: string; onApplied: (added: number) => Promise<void> }) {
  const [open, setOpen] = React.useState(false);
  const [suggestions, setSuggestions] = React.useState<WorkforceSuggestion[] | null>(null);
  const [chosen, setChosen] = React.useState<Set<string>>(new Set());
  const [error, setError] = React.useState<string | null>(null);
  const [pending, setPending] = React.useState(false);
  const [applied, setApplied] = React.useState(false);

  async function load() {
    setOpen(true);
    setApplied(false);
    setSuggestions(null);
    setError(null);
    try {
      const rows = await dailyLogApi<WorkforceSuggestion[]>(`${base}/workforce-suggestions`);
      setSuggestions(rows);
      setChosen(new Set(rows.map((row) => row.key)));
    } catch (failure) {
      setError(failureMessage(failure, "The suggestions could not be loaded."));
    }
  }

  async function apply(): Promise<SaveOutcome> {
    if (pending) return { kind: "unknown" };
    if (chosen.size === 0) return { kind: "invalid" };
    setPending(true);
    setError(null);
    try {
      const result = await dailyLogApi<{ added: number }>(`${base}/workforce-suggestions`, { body: { keys: [...chosen] } });
      setApplied(true);
      setOpen(false);
      await onApplied(result.added).catch(() => undefined);
      return { kind: "committed" };
    } catch (failure) {
      const outcome = dailyLogFailureOutcome(failure);
      setError(outcome.kind === "unknown" ? `${failureMessage(failure, "The entries could not be added.")} ${OUTCOME_COPY.unknown}` : failureMessage(failure, "The entries could not be added."));
      return outcome;
    } finally {
      setPending(false);
    }
  }

  // Unpicking a suggested entry is the only input here (AUD-03 §3).
  const changed = suggestions !== null && !applied && (chosen.size !== suggestions.length || suggestions.some((row) => !chosen.has(row.key)));

  return (
    <>
      <Button type="button" variant="ghost" size="sm" onClick={() => void load()} data-testid="workforce-suggest">
        <UsersRound aria-hidden="true" /> <span className="hidden sm:inline">From crews</span>
        <span className="sr-only sm:hidden">Add the project&apos;s crews</span>
      </Button>
      <Dialog open={open} onOpenChange={(next) => !pending && setOpen(next)}>
        <DialogContent className="max-w-xl" data-testid="workforce-suggestions">
          <DialogTitle>The project&apos;s workforce that day</DialogTitle>
          <DialogDescription>Crews on this project and the people assigned to it. Pick what to add; you can change any entry afterwards.</DialogDescription>
          {/* Inside the dialog, so the picks belong to its guarded close (AUD-03 §5). */}
          <PicksEditor dirty={changed} saving={pending} save={apply} />
          {suggestions === null && !error ? <p className="mt-4 text-table text-fg-muted">Loading…</p> : null}
          {suggestions && suggestions.length === 0 ? <p className="mt-4 text-table text-fg-muted">Nothing to add: no crews or assigned people that day, or they are already on the log.</p> : null}
          {suggestions && suggestions.length > 0 ? (
            <ul className="mt-4 divide-y divide-line">
              {suggestions.map((row) => (
                <li key={row.key} className="flex items-start gap-3 py-2.5" data-testid="workforce-suggestion">
                  <Checkbox
                    id={`suggestion-${row.key}`}
                    checked={chosen.has(row.key)}
                    onCheckedChange={(checked) =>
                      setChosen((current) => {
                        const next = new Set(current);
                        if (checked === true) next.add(row.key);
                        else next.delete(row.key);
                        return next;
                      })
                    }
                  />
                  <label htmlFor={`suggestion-${row.key}`} className="min-w-0 flex-1 text-table text-fg">
                    <span className="font-medium">{row.crewName ?? (row.trade ? `${row.trade}` : "Other assigned people")}</span>
                    {row.crewName && row.trade ? <span className="text-fg-muted"> · {row.trade}</span> : null}
                    <span className="block text-meta text-fg-subtle">
                      {row.headcount} {row.headcount === 1 ? "person" : "people"} {BASIS[row.basis]}
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          ) : null}
          {error ? (
            <p role="alert" className="mt-3 rounded-md border border-danger/30 bg-danger-soft px-3 py-2 text-table text-danger-strong">
              {error}
            </p>
          ) : null}
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="ghost" disabled={pending}>
                Cancel
              </Button>
            </DialogClose>
            <Button type="button" onClick={() => void apply()} disabled={pending || !suggestions || chosen.size === 0}>
              {pending ? "Adding…" : `Add ${chosen.size || ""}`.trim()}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

/** The picks' registration with the unsaved-work coordinator; the dialog keeps them. */
function PicksEditor({ dirty, saving, save }: { dirty: boolean; saving: boolean; save: () => Promise<SaveOutcome> }) {
  const editor = useUnsavedEditor({ module: "daily_logs", saveKind: "create", label: "Workforce from crews", save });
  const { setDirty, setSaving } = editor;
  React.useEffect(() => {
    setDirty(dirty);
    setSaving(saving);
  }, [dirty, saving, setDirty, setSaving]);
  return null;
}
