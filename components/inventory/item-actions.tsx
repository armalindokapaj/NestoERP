"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { PenLine } from "lucide-react";

import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { useToast } from "@/components/ui/toast";
import { itemLifecycleAction } from "@/lib/actions/inventory";
import type { ItemDetailDTO } from "@/lib/modules/inventory/inventory.types";

/** What a reader may do to an item (PRD #20 §45, §47, §48). */
export function ItemActions({ item }: { item: ItemDetailDTO }) {
  const router = useRouter();
  const toast = useToast();
  const [pending, startTransition] = React.useTransition();
  const [archiving, setArchiving] = React.useState(false);

  const may = item.capabilities;

  function run(action: "archive" | "restore", success: string) {
    startTransition(async () => {
      const result = await itemLifecycleAction(item.id, action);
      if (result.ok) {
        setArchiving(false);
        toast({ title: success, tone: "success" });
        router.refresh();
      } else {
        toast({ title: result.error, tone: "danger" });
      }
    });
  }

  return (
    <>
      {may.canEdit ? (
        <Button asChild variant="secondary" size="sm">
          <Link href={`/inventory/items/${item.id}/edit`}>
            <PenLine aria-hidden="true" />
            Edit
          </Link>
        </Button>
      ) : null}

      {may.canArchive ? (
        <Button variant="ghost" size="sm" disabled={pending} onClick={() => setArchiving(true)}>
          Archive
        </Button>
      ) : null}

      {may.canRestore ? (
        <Button
          variant="secondary"
          size="sm"
          disabled={pending}
          onClick={() => run("restore", "Item restored as inactive.")}
        >
          Restore
        </Button>
      ) : null}

      <ConfirmDialog
        open={archiving}
        onOpenChange={setArchiving}
        title={`Archive ${item.name}?`}
        description="It leaves the item master and cannot be named on new stock documents. Its ledger history stays exactly where it is. An item still holding stock cannot be archived."
        confirmLabel="Archive item"
        pending={pending}
        onConfirm={() => run("archive", "Item archived.")}
      />
    </>
  );
}
