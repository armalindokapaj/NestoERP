"use client";

import * as React from "react";
import { useTranslations } from "@/components/i18n/i18n-provider";
import { useRouter } from "@/components/navigation/guarded-router";

import { selectClass } from "@/components/forms/record-form";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/components/ui/toast";
import { UnsavedIndicator } from "@/components/unsaved/editor-status";
import type { PlanningSettingsDTO } from "@/lib/modules/project-planning/planning.types";
import { cn } from "@/lib/utils/cn";
import type { SaveOutcome } from "@/lib/unsaved/coordinator";
import { failureMessage, planningApi } from "./planning-api";
import { COMMITTED, failureOutcome, useValuesEditor } from "./use-values-editor";

/**
 * The company's planning rules (PRD #44 §71, §165, §253, §309).
 *
 * A changed rule is unsaved work (AUD-03 §3): leaving — a link, the report's
 * filters, a workspace switch — asks, and Save and continue saves it the way
 * Save settings does.
 */
export function PlanningSettingsForm({ initial }: { initial: PlanningSettingsDTO }) {
  const t = useTranslations("projects");
  const toast = useToast();
  const router = useRouter();
  const [state, setState] = React.useState({ milestoneReminderDays: initial.milestoneReminderDays, baselineChangeReasonRequired: initial.baselineChangeReasonRequired, notifyExecutivesOnCriticalChanges: initial.notifyExecutivesOnCriticalChanges });
  const [pending, setPending] = React.useState(false);
  const editor = useValuesEditor(state, { module: "planning", saveKind: "save", label: t("settings.label"), save: () => save() });

  async function save(): Promise<SaveOutcome> {
    setPending(true);
    try {
      await editor.track(() => planningApi("/api/project-planning/settings", { method: "PUT", body: state }));
      toast({ title: t("settings.saved"), tone: "success" });
      router.refresh();
      return COMMITTED;
    } catch (error) {
      toast({ title: failureMessage(error), tone: "danger" });
      return failureOutcome(error);
    } finally {
      setPending(false);
    }
  }

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }} className="nesto-card divide-y divide-line px-5" aria-label={t("settings.label")}>
      <label className="flex flex-col py-3">
        <span className="text-table font-medium text-fg">{t("settings.dueSoon")}</span>
        <span className="text-meta text-fg-muted">{t("settings.dueSoonBody")}</span>
        <select className={cn(selectClass, "mt-1.5 w-56")} value={state.milestoneReminderDays} onChange={(event) => setState({ ...state, milestoneReminderDays: Number(event.target.value) })}>
          {[1, 3, 5, 7, 10, 14, 21, 30].map((days) => (
            <option key={days} value={days}>
              {t("settingsExtra.daysAhead", { count: days })}
            </option>
          ))}
        </select>
      </label>
      <div className="flex items-start justify-between gap-4 py-3">
        <label htmlFor="baseline-reason">
          <span className="block text-table font-medium text-fg">{t("settings.reason")}</span>
          <span className="block text-meta text-fg-muted">{t("settings.reasonBody")}</span>
        </label>
        <Switch id="baseline-reason" checked={state.baselineChangeReasonRequired} onCheckedChange={(value) => setState({ ...state, baselineChangeReasonRequired: value })} />
      </div>
      <div className="flex items-start justify-between gap-4 py-3">
        <label htmlFor="notify-executives">
          <span className="block text-table font-medium text-fg">{t("settings.executives")}</span>
          <span className="block text-meta text-fg-muted">{t("settings.executivesBody")}</span>
        </label>
        <Switch id="notify-executives" checked={state.notifyExecutivesOnCriticalChanges} onCheckedChange={(value) => setState({ ...state, notifyExecutivesOnCriticalChanges: value })} />
      </div>
      <div className="flex items-center justify-between gap-3 py-3">
        <p className="text-meta text-fg-muted">Milestone dates are read in {initial.timezone}.</p>
        <UnsavedIndicator save={{ editor, pending, saved: null }} className="ml-auto" />
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? t("settings.saving") : t("settings.save")}
        </Button>
      </div>
    </form>
  );
}
