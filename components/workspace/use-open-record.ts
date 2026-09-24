"use client";

import * as React from "react";

import { useTranslations } from "@/components/i18n/i18n-provider";
import { useFeedbackRouter, useNavigationFeedback } from "@/components/navigation/navigation-feedback";
import { useToast } from "@/components/ui/toast";
import { openInSwitchedWorkspace, requestWorkspaceSwitch } from "@/lib/workspace/client";

export type OpenWorkspace = { scopeType: "GROUP" | "COMPANY"; companyId: string | null };
export type OpenTarget = { href: string; company?: { id: string; name: string } | null };

/**
 * Opens a record from a user-global list — search home, My Work, the Activity
 * Center (Fast Re-entry §39, §125-§127; Activity Center §49).
 *
 * Already in the record's company: plain navigation. Otherwise the server checks
 * the person may enter that company, commits the workspace and re-validates the
 * record there through the workspace route resolver; its answer is where to go —
 * the record, or its list when the record is no longer theirs. Nothing is
 * decided from a label the list carried.
 */
export function useOpenRecord(workspace: OpenWorkspace | null | undefined) {
  const router = useFeedbackRouter();
  const feedback = useNavigationFeedback();
  const toast = useToast();
  const t = useTranslations("workspace");
  const [pending, setPending] = React.useState(false);

  const open = React.useCallback(
    async (target: OpenTarget): Promise<boolean> => {
      if (pending) return false;
      const company = target.company;
      if (!company || (workspace?.scopeType === "COMPANY" && workspace.companyId === company.id)) {
        router.push(target.href, { source: "record" });
        return true;
      }
      setPending(true);
      const ticket = feedback?.begin(target.href, "workspace", { ownsWorkspaceSwitch: true }) ?? null;
      const [currentPathname, search = ""] = target.href.split("?");
      const entered = await requestWorkspaceSwitch(
        { scopeType: "COMPANY", companyId: company.id, currentPathname, currentSearch: search ? `?${search}` : "" },
        { echoToThisTab: false },
      );
      if (!entered.ok) {
        setPending(false);
        feedback?.store.settle(ticket);
        if (!entered.stale) toast({ title: t("switchFailed", { name: company.name }), tone: "danger" });
        return false;
      }
      openInSwitchedWorkspace(entered.data.navigation.destination, { replace: true });
      return true;
    },
    [pending, workspace, router, feedback, toast, t],
  );

  return { open, pending };
}
