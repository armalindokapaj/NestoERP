"use client";

import * as React from "react";
import Link from "@/components/navigation/nav-link";
import { useRouter } from "@/components/navigation/guarded-router";
import { PenLine } from "lucide-react";

import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { useToast } from "@/components/ui/toast";
import { documentLifecycleAction } from "@/lib/actions/inventory";
import type { TransactionCapabilities } from "@/lib/modules/inventory/inventory.types";
import { useInventoryTranslations } from "./inventory-text";

type Kind = "receipts" | "issues" | "returns" | "transfers" | "adjustments";


/**
 * Post, cancel, reverse (PRD #20 §311, §314, §316, §318).
 *
 * Posting is confirmed because it is the irreversible half: the confirmation
 * says what will actually change to stock rather than asking whether the reader
 * is sure. Reversal is confirmed for the same reason, and says plainly that it
 * writes a new ledger row rather than erasing the old one (PRD #20 §70).
 */
export function DocumentActions({
  kind,
  documentId,
  documentNumber,
  capabilities,
}: {
  kind: Kind;
  documentId: string;
  documentNumber: string;
  capabilities: TransactionCapabilities;
}) {
  const router = useRouter();
  const toast = useToast();
  const t = useInventoryTranslations();
  const [pending, startTransition] = React.useTransition();
  const [confirming, setConfirming] = React.useState<"post" | "cancel" | "reverse" | null>(null);

  function run(action: "post" | "cancel" | "reverse", success: string) {
    startTransition(async () => {
      const result = await documentLifecycleAction(kind, documentId, action);
      if (result.ok) {
        setConfirming(null);
        toast({ title: success, tone: "success" });
        router.refresh();
      } else {
        toast({ title: result.error, tone: "danger" });
      }
    });
  }

  return (
    <>
      {capabilities.canEdit ? (
        <Button asChild variant="secondary" size="sm">
          <Link href={`/inventory/${kind}/${documentId}/edit`}>
            <PenLine aria-hidden="true" />
            {t("actions.edit")}
          </Link>
        </Button>
      ) : null}

      {capabilities.canPost ? (
        <Button size="sm" disabled={pending} onClick={() => setConfirming("post")}>
          {t("documentActions.post")}
        </Button>
      ) : null}

      {capabilities.canCancel ? (
        <Button
          variant="ghost"
          size="sm"
          disabled={pending}
          onClick={() => setConfirming("cancel")}
        >
          {t("documentActions.cancelDraft")}
        </Button>
      ) : null}

      {capabilities.canReverse ? (
        <Button
          variant="secondary"
          size="sm"
          disabled={pending}
          onClick={() => setConfirming("reverse")}
        >
          {t("documentActions.reverse")}
        </Button>
      ) : null}

      <ConfirmDialog
        open={confirming === "post"}
        onOpenChange={(open) => setConfirming(open ? "post" : null)}
        title={t("documentActions.postTitle", { number: documentNumber })}
        description={`${t(`documentActions.postWarning.${kind}`)} ${t(`documentActions.postedLocked.${kind}`)}`}
        confirmLabel={t("documentActions.postConfirm")}
        cancelLabel={t("documentActions.notYet")}
        destructive={false}
        pending={pending}
        onConfirm={() => run("post", t("documentActions.posted"))}
      />

      <ConfirmDialog
        open={confirming === "cancel"}
        onOpenChange={(open) => setConfirming(open ? "cancel" : null)}
        title={t("documentActions.cancelTitle", { number: documentNumber })}
        description={t("documentActions.cancelDescription")}
        confirmLabel={t(`documentActions.cancelConfirm.${kind}`)}
        cancelLabel={t("documentActions.keepDraft")}
        pending={pending}
        onConfirm={() => run("cancel", t("documentActions.cancelled"))}
      />

      <ConfirmDialog
        open={confirming === "reverse"}
        onOpenChange={(open) => setConfirming(open ? "reverse" : null)}
        title={t("documentActions.reverseTitle", { number: documentNumber })}
        description={t("documentActions.reverseDescription")}
        confirmLabel={t(`documentActions.reverseConfirm.${kind}`)}
        pending={pending}
        onConfirm={() => run("reverse", t("documentActions.reversed"))}
      />
    </>
  );
}
