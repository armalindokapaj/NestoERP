"use client";

import * as React from "react";
import { Check } from "lucide-react";

import { useTranslations } from "@/components/i18n/i18n-provider";
import { useRouter } from "@/components/navigation/guarded-router";
import { useToast } from "@/components/ui/toast";
import { SwipeAction } from "@/components/ui/swipe-actions";
import { taskCommandAction } from "@/lib/actions/tasks";

/**
 * Complete, revealed by swiping a task's card left on a phone (mobile audit
 * 5a). The same command the task's page sends (TaskActions), against the
 * version the list showed (AUD-02 §3): nothing is applied until the server
 * confirms, and a task that moved on is refused, said so, and the list is
 * read again. The page offers Complete too; this is only the shortcut.
 */
export function TaskSwipeComplete({ taskId, version, title }: { taskId: string; version: number; title: string }) {
  const router = useRouter();
  const toast = useToast();
  const t = useTranslations("tasks");
  const inFlight = React.useRef(false);

  async function complete() {
    // A second tap before the first answer is the same request, not another one.
    if (inFlight.current) return;
    inFlight.current = true;
    try {
      const result = await taskCommandAction(taskId, "complete", { expectedVersion: version });
      if (result.ok) {
        toast({ title: t("actions.completedDone"), tone: "success" });
        router.refresh();
        return;
      }
      const moved = result.code === "TASK_VERSION_CONFLICT" || result.code === "TASK_STATE_CONFLICT";
      toast({ title: moved ? t("actions.changed") : result.error, tone: "danger" });
      if (moved) router.refresh();
    } catch {
      // No answer: it may or may not have been done. Say so and show the latest list (AUD-02 §7).
      toast({ title: t("actions.unconfirmed"), tone: "warning" });
      router.refresh();
    } finally {
      inFlight.current = false;
    }
  }

  return (
    <SwipeAction
      tone="success"
      icon={<Check />}
      label={t("actions.complete")}
      aria-label={t("actions.completeNamed", { title })}
      data-testid="task-swipe-complete"
      onAction={complete}
    />
  );
}
