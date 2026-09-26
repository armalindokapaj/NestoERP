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
import { progressStatusLabels } from "@/lib/modules/hr/hr.status";
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
  const router = useRouter();
  const toast = useToast();
  const [pending, startTransition] = React.useTransition();

  function set(status: HrProgressStatus) {
    startTransition(async () => {
      const result = await progressAction(employeeId, kind, status);
      if (result.ok) {
        toast({
          title: `${kind === "onboarding" ? "Onboarding" : "Offboarding"} ${progressStatusLabels[
            status
          ].toLowerCase()}.`,
          tone: "success",
        });
        router.refresh();
      } else {
        toast({ title: result.error, tone: "danger" });
      }
    });
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="secondary" size="sm" disabled={pending} aria-label={`${kind} status for ${name}`}>
          {progressStatusLabels[current]}
          <ChevronDown aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {CHOICES.filter((status) => status !== current).map((status) => (
          <DropdownMenuItem key={status} onSelect={() => set(status)}>
            {progressStatusLabels[status]}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
