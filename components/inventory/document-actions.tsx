"use client";

import * as React from "react";
import Link from "@/components/navigation/nav-link";
import { useRouter } from "next/navigation";
import { PenLine } from "lucide-react";

import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { useToast } from "@/components/ui/toast";
import { documentLifecycleAction } from "@/lib/actions/inventory";
import type { TransactionCapabilities } from "@/lib/modules/inventory/inventory.types";
import { postWarnings } from "./inventory-format";

type Kind = "receipts" | "issues" | "returns" | "transfers" | "adjustments";

const NOUN: Record<Kind, string> = {
  receipts: "receipt",
  issues: "issue",
  returns: "return",
  transfers: "transfer",
  adjustments: "adjustment",
};

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
  const [pending, startTransition] = React.useTransition();
  const [confirming, setConfirming] = React.useState<"post" | "cancel" | "reverse" | null>(null);

  const noun = NOUN[kind];

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
            Edit
          </Link>
        </Button>
      ) : null}

      {capabilities.canPost ? (
        <Button size="sm" disabled={pending} onClick={() => setConfirming("post")}>
          Post
        </Button>
      ) : null}

      {capabilities.canCancel ? (
        <Button
          variant="ghost"
          size="sm"
          disabled={pending}
          onClick={() => setConfirming("cancel")}
        >
          Cancel draft
        </Button>
      ) : null}

      {capabilities.canReverse ? (
        <Button
          variant="secondary"
          size="sm"
          disabled={pending}
          onClick={() => setConfirming("reverse")}
        >
          Reverse
        </Button>
      ) : null}

      <ConfirmDialog
        open={confirming === "post"}
        onOpenChange={(open) => setConfirming(open ? "post" : null)}
        title={`Post ${documentNumber}?`}
        description={`${postWarnings[kind]} A posted ${noun} cannot be edited — only reversed.`}
        confirmLabel="Post to stock"
        cancelLabel="Not yet"
        destructive={false}
        pending={pending}
        onConfirm={() => run("post", "Posted to the stock ledger.")}
      />

      <ConfirmDialog
        open={confirming === "cancel"}
        onOpenChange={(open) => setConfirming(open ? "cancel" : null)}
        title={`Cancel ${documentNumber}?`}
        description={`The draft stays on record as cancelled. Nothing has reached the stock ledger, so no stock changes.`}
        confirmLabel={`Cancel ${noun}`}
        cancelLabel="Keep draft"
        pending={pending}
        onConfirm={() => run("cancel", "Draft cancelled.")}
      />

      <ConfirmDialog
        open={confirming === "reverse"}
        onOpenChange={(open) => setConfirming(open ? "reverse" : null)}
        title={`Reverse ${documentNumber}?`}
        description="This writes opposite movements into the ledger. The original rows stay exactly where they are — the history is not rewritten."
        confirmLabel={`Reverse ${noun}`}
        pending={pending}
        onConfirm={() => run("reverse", "Reversed. The opposite movements are on the ledger.")}
      />
    </>
  );
}
