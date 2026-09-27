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
import { useDailyLogsTranslations } from "./daily-logs-text";
import { dailyLogsLabel } from "@/lib/i18n/modules/dailyLogs/labels";

/**
 * "From crews" in a log's workforce section (E-04 §182): the project's crews
 * and assigned people that day, with the headcount the site sheet or the crew
 * list gives — picked, then added as ordinary entries the writer can still
 * correct. Nothing is added without being picked.
 */

const BASIS: Record<WorkforceSuggestion["basis"], string> = { ATTENDANCE: "marked present on the site sheet", CREW: "in the crew that day", ASSIGNED: "assigned, in no crew" };

export function WorkforceSuggestions({ base, onApplied }: { base: string; onApplied: (added: number) => Promise<void> }) {
  const t = useDailyLogsTranslations();
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
      setError(failureMessage(failure, t("suggestions.loadFailed")));
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
      setError(outcome.kind === "unknown" ? `${failureMessage(failure, t("suggestions.addFailed"))} ${OUTCOME_COPY.unknown}` : failureMessage(failure, t("suggestions.addFailed")));
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
        <UsersRound aria-hidden="true" /> <span className="hidden sm:inline">{t("suggestions.fromCrews")}</span>
        <span className="sr-only sm:hidden">{t("suggestions.addCrews")}</span>
      </Button>
      <Dialog open={open} onOpenChange={(next) => !pending && setOpen(next)}>
        <DialogContent className="max-w-xl" data-testid="workforce-suggestions">
          <DialogTitle>{t("suggestions.title")}</DialogTitle>
          <DialogDescription>{t("suggestions.description")}</DialogDescription>
          {/* Inside the dialog, so the picks belong to its guarded close (AUD-03 §5). */}
          <PicksEditor dirty={changed} saving={pending} save={apply} />
          {suggestions === null && !error ? <p className="mt-4 text-table text-fg-muted">{t("common.loading")}</p> : null}
          {suggestions && suggestions.length === 0 ? <p className="mt-4 text-table text-fg-muted">{t("suggestions.nothing")}</p> : null}
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
                    <span className="font-medium">{row.crewName ?? (row.trade ? `${row.trade}` : t("suggestions.otherPeople"))}</span>
                    {row.crewName && row.trade ? <span className="text-fg-muted"> · {row.trade}</span> : null}
                    <span className="block text-meta text-fg-subtle">
                      {t("suggestions.people", { count: row.headcount, basis: dailyLogsLabel(t, "basis", row.basis, BASIS[row.basis]) })}
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
                {t("common.cancel")}
              </Button>
            </DialogClose>
            <Button type="button" onClick={() => void apply()} disabled={pending || !suggestions || chosen.size === 0}>
              {pending ? t("common.adding") : chosen.size ? t("suggestions.addCount", { count: chosen.size }) : t("common.add")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

/** The picks' registration with the unsaved-work coordinator; the dialog keeps them. */
function PicksEditor({ dirty, saving, save }: { dirty: boolean; saving: boolean; save: () => Promise<SaveOutcome> }) {
  const t = useDailyLogsTranslations();
  const editor = useUnsavedEditor({ module: "daily_logs", saveKind: "create", label: t("suggestions.editor"), save });
  const { setDirty, setSaving } = editor;
  React.useEffect(() => {
    setDirty(dirty);
    setSaving(saving);
  }, [dirty, saving, setDirty, setSaving]);
  return null;
}
