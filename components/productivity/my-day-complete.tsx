"use client";

import * as React from "react";
import { Check } from "lucide-react";

import { useMiscTranslations } from "@/components/activity/misc-text";
import { useRouter } from "@/components/navigation/guarded-router";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { taskCommandAction } from "@/lib/actions/tasks";

/**
 * Quick completion from a My Day row (MOB-06 §27). The canonical complete
 * command against the version the row showed, confirmed by the server before
 * anything changes; the page then refreshes so the counters and lists follow.
 */
export function MyDayComplete({ taskId, version, title }: { taskId: string; version: number; title: string }) {
  const t = useMiscTranslations();
  const router = useRouter();
  const toast = useToast();
  const [pending, startTransition] = React.useTransition();
  const inFlight = React.useRef(false);

  function complete() {
    if (inFlight.current) return;
    inFlight.current = true;
    startTransition(async () => {
      try {
        const result = await taskCommandAction(taskId, "complete", { expectedVersion: version });
        if (result.ok) toast({ title: t("myDay.completed"), tone: "success" });
        else toast({ title: t("myDay.completeFailed"), tone: "danger" });
      } catch {
        toast({ title: t("myDay.completeFailed"), tone: "warning" });
      } finally {
        inFlight.current = false;
        router.refresh();
      }
    });
  }

  return (
    <Button type="button" size="icon-sm" variant="secondary" disabled={pending} aria-busy={pending || undefined} aria-label={`${t("myDay.complete")}: ${title}`} onClick={complete}>
      <Check aria-hidden="true" />
    </Button>
  );
}
