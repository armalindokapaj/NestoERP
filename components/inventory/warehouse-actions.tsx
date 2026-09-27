"use client";

import * as React from "react";
import Link from "@/components/navigation/nav-link";
import { useRouter } from "@/components/navigation/guarded-router";
import { PenLine } from "lucide-react";

import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { useToast } from "@/components/ui/toast";
import { warehouseLifecycleAction } from "@/lib/actions/inventory";
import type { WarehouseDetailDTO } from "@/lib/modules/inventory/inventory.types";
import { useInventoryTranslations } from "./inventory-text";

/** What a reader may do to a warehouse (PRD #20 §59, §60). */
export function WarehouseActions({ warehouse }: { warehouse: WarehouseDetailDTO }) {
  const router = useRouter();
  const toast = useToast();
  const t = useInventoryTranslations();
  const [pending, startTransition] = React.useTransition();
  const [archiving, setArchiving] = React.useState(false);

  const may = warehouse.capabilities;

  function run(action: "archive" | "restore", success: string) {
    startTransition(async () => {
      const result = await warehouseLifecycleAction(warehouse.id, action);
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
          <Link href={`/inventory/warehouses/${warehouse.id}/edit`}>
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
          onClick={() => run("restore", t("warehouseActions.restored"))}
        >
          {t("actions.restore")}
        </Button>
      ) : null}

      <ConfirmDialog
        open={archiving}
        onOpenChange={setArchiving}
        title={t("actions.archiveTitle", { name: warehouse.name })}
        description={t("warehouseActions.archiveDescription")}
        confirmLabel={t("warehouseActions.archiveConfirm")}
        pending={pending}
        onConfirm={() => run("archive", t("warehouseActions.archived"))}
      />
    </>
  );
}
