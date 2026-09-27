"use client";

import * as React from "react";
import { useRouter } from "@/components/navigation/guarded-router";
import { ChevronDown } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useToast } from "@/components/ui/toast";
import { progressAction } from "@/lib/actions/hr";
import { hrLabel, useHrServerText, useHrTranslations } from "./hr-text";
import type { HrProgressStatus } from "@prisma/client";

/**
 * Move somebody through onboarding or offboarding (PRD #16 §121).
 *
 * V0.1 tracks readiness as a status, not a checklist: the tasks themselves are
 * canonical Task records, so HR never grows a second task engine
 * (PRD #16 §118, §125).
 */
const CHOICES: HrProgressStatus[] = ["NOT_STARTED", "IN_PROGRESS", "COMPLETED", "NOT_REQUIRED"];

export function ProgressActions({
  employeeId,
  kind,
  current,
  name,
}: {
  employeeId: string;
  kind: "onboarding" | "offboarding";
  current: HrProgressStatus;
  name: string;
}) {
  const t = useHrTranslations();
  const serverText = useHrServerText();
  const router = useRouter();
  const toast = useToast();
  const [pending, startTransition] = React.useTransition();

  function set(status: HrProgressStatus) {
    startTransition(async () => {
      const result = await progressAction(employeeId, kind, status);
      if (result.ok) {
        toast({
          title: t("progressActions.done", { kind: kind === "onboarding" ? t("meta.onboarding") : t("meta.offboarding"), status: hrLabel(t, "progressStatus", status).toLowerCase() }),
          tone: "success",
        });
        router.refresh();
      } else {
        toast({ title: serverText(result.error) ?? result.error, tone: "danger" });
      }
    });
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="secondary" size="sm" disabled={pending} aria-label={t("progressActions.label", { kind: kind === "onboarding" ? t("meta.onboarding") : t("meta.offboarding"), name })}>
          {hrLabel(t, "progressStatus", current)}
          <ChevronDown aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {CHOICES.filter((status) => status !== current).map((status) => (
          <DropdownMenuItem key={status} onSelect={() => set(status)}>
            {hrLabel(t, "progressStatus", status)}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
