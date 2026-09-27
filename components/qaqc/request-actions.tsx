"use client";

import * as React from "react";
import Link from "@/components/navigation/nav-link";
import { useRouter } from "@/components/navigation/guarded-router";
import { PenLine } from "lucide-react";

import { RejectDialog } from "@/components/finance/reject-dialog";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { cancelRequestAction } from "@/lib/actions/qaqc";
import type { RequestDetailDTO } from "@/lib/modules/qaqc/qaqc.types";
import { AssignControl } from "./assign-control";

import { useQaqcTranslations } from "./qaqc-text";

/** What a reader may do to an inspection request (PRD #21 §44–§48). */
export function RequestActions({ request }: { request: RequestDetailDTO }) {
  const router = useRouter();
  const t = useQaqcTranslations();
  const toast = useToast();
  const [pending, startTransition] = React.useTransition();
  const [cancelling, setCancelling] = React.useState(false);

  const may = request.capabilities;

  return (
    <>
      {may.canEdit ? (
        <Button asChild variant="secondary" size="sm">
          <Link href={`/qaqc/requests/${request.id}/edit`}>
            <PenLine aria-hidden="true" />
            {t("common.edit")}
          </Link>
        </Button>
      ) : null}

      {may.canStartInspection ? (
        <Button asChild size="sm">
          <Link href={`/qaqc/inspections/new?requestId=${request.id}`}>{t("common.startInspection")}</Link>
        </Button>
      ) : null}

      {may.canAssign ? <AssignControl kind="request" recordId={request.id} /> : null}

      {may.canCancel ? (
        <Button variant="ghost" size="sm" disabled={pending} onClick={() => setCancelling(true)}>
          {t("common.cancel")}
        </Button>
      ) : null}

      <RejectDialog
        open={cancelling}
        onOpenChange={setCancelling}
        title={t("requestActions.cancelTitle", { number: request.requestNumber })}
        description={t("requestActions.cancelBody")}
        label={t("common.reason")}
        placeholder={t("common.whyCancelled")}
        confirmLabel={t("requestActions.cancelConfirm")}
        pendingLabel={t("common.cancelling")}
        emptyMessage={t("common.sayCancelled")}
        onReject={async (reason) => {
          let ok = false;
          await new Promise<void>((resolve) => {
            startTransition(async () => {
              const result = await cancelRequestAction(request.id, reason);
              if (result.ok) {
                ok = true;
                setCancelling(false);
                toast({ title: t("requestActions.cancelled"), tone: "success" });
                router.refresh();
              } else {
                toast({ title: result.error, tone: "danger" });
              }
              resolve();
            });
          });
          return ok;
        }}
      />
    </>
  );
}
