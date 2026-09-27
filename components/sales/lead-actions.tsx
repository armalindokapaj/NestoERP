"use client";

import * as React from "react";
import Link from "@/components/navigation/nav-link";
import { useRouter } from "@/components/navigation/guarded-router";
import { Archive, ArrowRightLeft, CheckCircle2, PenLine, PhoneCall, RotateCcw, XCircle } from "lucide-react";

import { RejectDialog } from "@/components/finance/reject-dialog";
import { AssignMemberControl } from "@/components/modules/assign-member-control";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { useToast } from "@/components/ui/toast";
import {
  assignLeadAction,
  disqualifyLeadAction,
  leadLifecycleAction,
  type LeadLifecycleAction,
} from "@/lib/actions/sales";
import type { LeadDetailDTO } from "@/lib/modules/sales/sales.types";
import { useSalesServerText, useSalesTranslations } from "@/components/sales/sales-text";

/**
 * Actions on a lead (PRD #17 §48–§57, §294).
 *
 * Capabilities are hints: the server re-checks every one of them, so a stale
 * page cannot qualify a lead somebody else has already converted (PRD #17 §56).
 */
export function LeadActions({ lead }: { lead: LeadDetailDTO }) {
  const t = useSalesTranslations();
  const serverText = useSalesServerText();
  const router = useRouter();
  const toast = useToast();
  const [pending, startTransition] = React.useTransition();
  const [archiving, setArchiving] = React.useState(false);
  const [disqualifying, setDisqualifying] = React.useState(false);

  const may = lead.capabilities;

  function run(action: LeadLifecycleAction, success: string) {
    startTransition(async () => {
      const result = await leadLifecycleAction(lead.id, action);
      setArchiving(false);
      if (result.ok) {
        toast({ title: success, tone: "success" });
        router.refresh();
      } else {
        toast({ title: serverText(result.error) ?? result.error, tone: "danger" });
      }
    });
  }

  return (
    <>
      {may.canEdit ? (
        <Button asChild variant="secondary" size="sm">
          <Link href={`/sales/leads/${lead.id}/edit`}>
            <PenLine aria-hidden="true" />
            {t("common.edit")}
          </Link>
        </Button>
      ) : null}

      {may.canAssign ? (
        <AssignMemberControl
          endpoint="/api/sales/assignable"
          currentMemberId={lead.owner?.memberId ?? null}
          triggerLabel={t("common.reassign")}
          title={t("leadActions.assignTitle")}
          description={t("leadActions.assignDescription")}
          onAssign={async (memberId) => {
            const result = await assignLeadAction(lead.id, memberId);
            return { ok: result.ok, message: result.ok ? t("leadActions.reassigned") : serverText(result.error) ?? result.error };
          }}
        />
      ) : null}

      {may.canMarkContacted ? (
        <Button
          variant="secondary"
          size="sm"
          onClick={() => run("contacted", t("leadActions.contactRecorded"))}
          disabled={pending}
        >
          <PhoneCall aria-hidden="true" />
          {t("leadActions.markContacted")}
        </Button>
      ) : null}

      {may.canQualify ? (
        <Button size="sm" onClick={() => run("qualify", t("leadActions.qualified"))} disabled={pending}>
          <CheckCircle2 aria-hidden="true" />
          {pending ? t("common.working") : t("leadActions.qualify")}
        </Button>
      ) : null}

      {may.canConvert ? (
        <Button asChild size="sm">
          <Link href={`/sales/leads/${lead.id}/convert`}>
            <ArrowRightLeft aria-hidden="true" />
            {t("leadActions.convert")}
          </Link>
        </Button>
      ) : null}

      {may.canDisqualify ? (
        <Button
          variant="secondary"
          size="sm"
          onClick={() => setDisqualifying(true)}
          disabled={pending}
        >
          <XCircle aria-hidden="true" />
          {t("leadActions.disqualify")}
        </Button>
      ) : null}

      {may.canArchive ? (
        <Button variant="ghost" size="sm" onClick={() => setArchiving(true)} disabled={pending}>
          <Archive aria-hidden="true" />
          {t("common.archive")}
        </Button>
      ) : null}

      {may.canRestore ? (
        <Button
          variant="secondary"
          size="sm"
          onClick={() => run("restore", t("leadActions.restored"))}
          disabled={pending}
        >
          <RotateCcw aria-hidden="true" />
          {t("common.restore")}
        </Button>
      ) : null}

      <ConfirmDialog
        open={archiving}
        onOpenChange={setArchiving}
        title={t("leadActions.archiveTitle")}
        description={t("leadActions.archiveDescription")}
        confirmLabel={t("leadActions.archiveConfirm")}
        destructive={false}
        pending={pending}
        onConfirm={() => run("archive", t("leadActions.archived"))}
      />

      <RejectDialog
        open={disqualifying}
        onOpenChange={setDisqualifying}
        title={t("leadActions.disqualifyTitle")}
        description={t("leadActions.disqualifyDescription")}
        label={t("leadActions.disqualifyLabel")}
        placeholder={t("leadActions.disqualifyPlaceholder")}
        confirmLabel={t("leadActions.disqualify")}
        pendingLabel={t("leadActions.disqualifying")}
        emptyMessage={t("leadActions.disqualifyEmpty")}
        onReject={async (reason) => {
          const result = await disqualifyLeadAction(lead.id, reason);
          if (result.ok) {
            toast({ title: t("leadActions.disqualified") });
            setDisqualifying(false);
            router.refresh();
          } else {
            toast({ title: serverText(result.error) ?? result.error, tone: "danger" });
          }
          return result.ok;
        }}
      />
    </>
  );
}
