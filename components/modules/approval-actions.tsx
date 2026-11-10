"use client";

import * as React from "react";
import { useRouter } from "@/components/navigation/guarded-router";
import { BadgeCheck, Ban } from "@/components/icons";

import { Button } from "@/components/ui/button";
import { MainAction } from "@/components/ui/mobile-action-bar";
import { useToast } from "@/components/ui/toast";
import { decideRecordAction } from "@/lib/actions/records";
import { useCommonTranslations } from "@/components/i18n/common-text";

/**
 * The approval shell's controls (PRD #7 §50, §51).
 *
 * Rendered only when the person holds the granular approve permission *and*
 * the record is genuinely awaiting a decision. A button disabled because a
 * record is already approved is legitimate workflow state; a button disabled
 * because of missing permission is not, and is simply absent (PRD #5 §32).
 */
export function ApprovalActions({
  moduleKey,
  section,
  recordId,
  closing = false,
}: {
  moduleKey: string;
  section: string;
  recordId: string;
  /** QA/QC and HSE records are closed and reopened rather than approved and rejected. */
  closing?: boolean;
}) {
  const t = useCommonTranslations();
  const labels = closing ? { approve: t("close"), reject: t("reopen") } : { approve: t("approve"), reject: t("reject") };
  const router = useRouter();
  const toast = useToast();
  const [pending, startTransition] = React.useTransition();

  function decide(decision: "APPROVE" | "REJECT") {
    startTransition(async () => {
      const result = await decideRecordAction(moduleKey, section, recordId, decision);
      if (result.ok) {
        toast({
          title: decision === "APPROVE" ? t(closing ? "closed" : "approved") : t(closing ? "reopened" : "rejected"),
        });
        router.refresh();
      } else {
        toast({ title: result.error, tone: "danger" });
      }
    });
  }

  // The page's main action: below md both sit in the bottom action bar, above the bottom navigation.
  return (
    <MainAction>
      <Button size="sm" onClick={() => decide("APPROVE")} disabled={pending}>
        <BadgeCheck aria-hidden="true" />
        {labels.approve}
      </Button>
      <Button variant="secondary" size="sm" onClick={() => decide("REJECT")} disabled={pending}>
        <Ban aria-hidden="true" />
        {labels.reject}
      </Button>
    </MainAction>
  );
}
