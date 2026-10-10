"use client";

import * as React from "react";
import { useRouter } from "@/components/navigation/guarded-router";

import { selectClass } from "@/components/forms/record-form";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/components/ui/toast";
import { UnsavedIndicator } from "@/components/unsaved/editor-status";
import { useUnsavedEditor } from "@/components/unsaved/use-unsaved";
import { unsaved, type SaveOutcome } from "@/lib/unsaved/coordinator";
import { OUTCOME_COPY } from "@/lib/unsaved/outcome";
import type { DailyLogSettingsDTO } from "@/lib/modules/daily-logs/daily-log.types";
import { cn } from "@/lib/utils/cn";
import { dailyLogApi, dailyLogFailureOutcome, failureMessage } from "./daily-log-api";
import { useDailyLogsTranslations } from "./daily-logs-text";
import { FormSelect } from "@/components/ui/form-select";

/** The company's daily log rules (PRD #43 §18, §248-§250). A project can require logs, name a reviewer and keep its own days. */
export function DailyLogSettingsForm({ initial }: { initial: DailyLogSettingsDTO }) {
  const toast = useToast();
  const router = useRouter();
  const t = useDailyLogsTranslations();
  const [state, setState] = React.useState({ logsRequired: initial.logsRequired, backdateDays: initial.backdateDays, reviewerRequired: initial.reviewerRequired });
  const [baseline, setBaseline] = React.useState(state);
  const [pending, setPending] = React.useState(false);

  // AUD-03 §3: the settings as saved are the baseline; Save and continue runs this same PUT.
  const run = React.useRef<() => Promise<SaveOutcome>>(async () => ({ kind: "unknown" }));
  const editor = useUnsavedEditor({ module: "daily_logs", saveKind: "save", label: t("settings.form"), save: () => run.current() });
  const { setDirty, setSaving, setUnresolved } = editor;
  const dirty = state.logsRequired !== baseline.logsRequired || state.backdateDays !== baseline.backdateDays || state.reviewerRequired !== baseline.reviewerRequired;
  React.useEffect(() => setDirty(dirty), [dirty, setDirty]);

  run.current = async () => {
    if (pending) return { kind: "unknown" };
    if (unsaved.frozen) return { kind: "refused" };
    setPending(true);
    setSaving(true);
    try {
      await dailyLogApi("/api/daily-logs/settings", { method: "PUT", body: state });
      setBaseline(state);
      setDirty(false);
      setUnresolved(false);
      toast({ title: t("settings.saved"), tone: "success" });
      router.refresh();
      return { kind: "committed" };
    } catch (error) {
      const outcome = dailyLogFailureOutcome(error);
      setUnresolved(outcome.kind === "unknown");
      toast({ title: failureMessage(error, t("common.somethingWrong")), description: outcome.kind === "unknown" ? OUTCOME_COPY.unknown : OUTCOME_COPY.notSaved, tone: "danger" });
      return outcome;
    } finally {
      setPending(false);
      setSaving(false);
    }
  };

  function save(event: React.FormEvent) {
    event.preventDefault();
    void run.current();
  }

  return (
    <form onSubmit={save} className="nesto-card max-w-2xl divide-y divide-line px-5" aria-label={t("settings.form")}>
      <div className="flex items-start justify-between gap-4 py-3">
        <label htmlFor="logs-required">
          <span className="block text-table font-medium text-fg">{t("settings.logsRequired")}</span>
          <span className="block text-meta text-fg-muted">{t("settings.logsRequiredHint")}</span>
        </label>
        <Switch id="logs-required" checked={state.logsRequired} onCheckedChange={(value) => setState({ ...state, logsRequired: value })} />
      </div>
      <div className="flex items-start justify-between gap-4 py-3">
        <label htmlFor="reviewer-required">
          <span className="block text-table font-medium text-fg">{t("settings.reviewerRequired")}</span>
          <span className="block text-meta text-fg-muted">{t("settings.reviewerRequiredHint")}</span>
        </label>
        <Switch id="reviewer-required" checked={state.reviewerRequired} onCheckedChange={(value) => setState({ ...state, reviewerRequired: value })} />
      </div>
      <label className="flex flex-col py-3">
        <span className="text-table font-medium text-fg">{t("settings.backdate")}</span>
        <FormSelect className={cn(selectClass, "mt-1.5 w-56")} value={state.backdateDays} onChange={(event) => setState({ ...state, backdateDays: Number(event.target.value) })}>
          {[0, 1, 3, 7, 14, 31].map((days) => (
            <option key={days} value={days}>
              {days === 0 ? t("settings.todayOnly") : t("settings.daysBack", { count: days })}
            </option>
          ))}
        </FormSelect>
      </label>
      <div className="flex items-center justify-between py-3">
        <p className="text-meta text-fg-muted">{t("settings.zone", { zone: initial.timezone, days: initial.workingDays.join(", ") })}</p>
        <span className="flex items-center gap-3">
          <UnsavedIndicator save={{ editor, pending, saved: null }} />
          <Button type="submit" size="sm" disabled={pending}>
            {pending ? t("common.saving") : t("settings.save")}
          </Button>
        </span>
      </div>
    </form>
  );
}
