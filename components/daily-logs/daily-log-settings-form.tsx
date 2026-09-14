"use client";

import * as React from "react";
import { useRouter } from "next/navigation";

import { selectClass } from "@/components/forms/record-form";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/components/ui/toast";
import type { DailyLogSettingsDTO } from "@/lib/modules/daily-logs/daily-log.types";
import { cn } from "@/lib/utils/cn";
import { dailyLogApi, failureMessage } from "./daily-log-api";

/** The company's daily log rules (PRD #43 §18, §248-§250). A project can require logs, name a reviewer and keep its own days. */
export function DailyLogSettingsForm({ initial }: { initial: DailyLogSettingsDTO }) {
  const toast = useToast();
  const router = useRouter();
  const [state, setState] = React.useState({ logsRequired: initial.logsRequired, backdateDays: initial.backdateDays, reviewerRequired: initial.reviewerRequired });
  const [pending, setPending] = React.useState(false);

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    try {
      await dailyLogApi("/api/daily-logs/settings", { method: "PUT", body: state });
      toast({ title: "Daily log settings saved", tone: "success" });
      router.refresh();
    } catch (error) {
      toast({ title: failureMessage(error), tone: "danger" });
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={save} className="nesto-card max-w-2xl divide-y divide-line px-5" aria-label="Daily log settings">
      <div className="flex items-start justify-between gap-4 py-3">
        <label htmlFor="logs-required">
          <span className="block text-table font-medium text-fg">Logs required on every active project</span>
          <span className="block text-meta text-fg-muted">Missing logs on working days are flagged to the project manager. A project can also require logs on its own.</span>
        </label>
        <Switch id="logs-required" checked={state.logsRequired} onCheckedChange={(value) => setState({ ...state, logsRequired: value })} />
      </div>
      <div className="flex items-start justify-between gap-4 py-3">
        <label htmlFor="reviewer-required">
          <span className="block text-table font-medium text-fg">A reviewer is required</span>
          <span className="block text-meta text-fg-muted">A log cannot be submitted until somebody other than its author can review it.</span>
        </label>
        <Switch id="reviewer-required" checked={state.reviewerRequired} onCheckedChange={(value) => setState({ ...state, reviewerRequired: value })} />
      </div>
      <label className="flex flex-col py-3">
        <span className="text-table font-medium text-fg">How far back a log can be started</span>
        <select className={cn(selectClass, "mt-1.5 w-56")} value={state.backdateDays} onChange={(event) => setState({ ...state, backdateDays: Number(event.target.value) })}>
          {[0, 1, 3, 7, 14, 31].map((days) => (
            <option key={days} value={days}>
              {days === 0 ? "Today only" : `${days} ${days === 1 ? "day" : "days"} back`}
            </option>
          ))}
        </select>
      </label>
      <div className="flex items-center justify-between py-3">
        <p className="text-meta text-fg-muted">Dates are read in {initial.timezone}. Working days follow the company: {initial.workingDays.join(", ")}.</p>
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? "Saving…" : "Save settings"}
        </Button>
      </div>
    </form>
  );
}
