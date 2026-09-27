"use client";

import * as React from "react";
import Link from "@/components/navigation/nav-link";
import { useRouter } from "@/components/navigation/guarded-router";
import { PenLine } from "lucide-react";

import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { useToast } from "@/components/ui/toast";
import { itemLifecycleAction } from "@/lib/actions/inventory";
import type { ItemDetailDTO } from "@/lib/modules/inventory/inventory.types";
import { useInventoryTranslations } from "./inventory-text";

/** What a reader may do to an item (PRD #20 §45, §47, §48). */
export function ItemActions({ item }: { item: ItemDetailDTO }) {
  const router = useRouter();
  const toast = useToast();
  const t = useInventoryTranslations();
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
            {t("actions.edit")}
          </Link>
        </Button>
      ) : null}

      {may.canArchive ? (
        <Button variant="ghost" size="sm" disabled={pending} onClick={() => setArchiving(true)}>
          {t("actions.archive")}
        </Button>
      ) : null}

      {may.canRestore ? (
        <Button
          variant="secondary"
          size="sm"
          disabled={pending}
          onClick={() => run("restore", t("itemActions.restored"))}
        >
          {t("actions.restore")}
        </Button>
      ) : null}

      <ConfirmDialog
        open={archiving}
        onOpenChange={setArchiving}
        title={t("actions.archiveTitle", { name: item.name })}
        description={t("itemActions.archiveDescription")}
        confirmLabel={t("itemActions.archiveConfirm")}
        pending={pending}
        onConfirm={() => run("archive", t("itemActions.archived"))}
      />
    </>
  );
}
