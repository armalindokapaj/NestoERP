"use client";

import * as React from "react";
import { useRouter } from "@/components/navigation/guarded-router";
import { NotebookPen } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { failureMessage, dailyLogApi } from "./daily-log-api";

/** Starts a project's log for a day, or opens the one already started (PRD #43 §10, §17, §18, §163). */
export function StartLogForm({ projectId, today, earliest, compact = false, label = "Start log" }: { projectId: string; today: string; earliest: string; compact?: boolean; label?: string }) {
  const router = useRouter();
  const [date, setDate] = React.useState(today);
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function start(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    setError(null);
    try {
      const result = await dailyLogApi<{ id: string }>(`/api/projects/${projectId}/daily-logs`, { body: { workDate: date } });
      router.push(`/projects/${projectId}/daily-logs/${result.id}`);
    } catch (failure) {
      setError(failureMessage(failure));
      setPending(false);
    }
  }

  return (
    <form onSubmit={start} className="flex flex-wrap items-end gap-2" aria-label="Start a daily log">
      {compact ? null : (
        <label className="flex flex-col">
          <span className="text-meta text-fg-muted">Work date</span>
          <Input type="date" className="mt-1 h-9 w-44" value={date} min={earliest} max={today} onChange={(event) => setDate(event.target.value)} />
        </label>
      )}
      <Button type="submit" size="sm" disabled={pending}>
        <NotebookPen aria-hidden="true" />
        {pending ? "Opening…" : label}
      </Button>
      {error ? <p role="alert" className="w-full text-meta text-danger-strong">{error}</p> : null}
    </form>
  );
}
