"use client";

import * as React from "react";
import Link from "@/components/navigation/nav-link";
import { useRouter } from "@/components/navigation/guarded-router";
import { PenLine } from "lucide-react";

import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { useToast } from "@/components/ui/toast";
import { supplierLifecycleAction } from "@/lib/actions/procurement";
import type { SupplierDetailDTO } from "@/lib/modules/procurement/procurement.types";
import { useProcurementServerText, useProcurementTranslations } from "./procurement-text";

/** What a reader may do to a supplier (PRD #19 §36–§38). */
export function SupplierActions({ supplier }: { supplier: SupplierDetailDTO }) {
  const router = useRouter();
  const toast = useToast();
  const t = useProcurementTranslations();
  const serverText = useProcurementServerText();
  const [pending, startTransition] = React.useTransition();
  const [archiving, setArchiving] = React.useState(false);

  const may = supplier.capabilities;

  function run(action: "archive" | "restore", success: string) {
    startTransition(async () => {
      const result = await supplierLifecycleAction(supplier.id, action);
      if (result.ok) {
        setArchiving(false);
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
          <Link href={`/procurement/suppliers/${supplier.id}/edit`}>
            <PenLine aria-hidden="true" />
            {t("common.edit")}
          </Link>
        </Button>
      ) : null}

      {may.canArchive ? (
        <Button variant="ghost" size="sm" disabled={pending} onClick={() => setArchiving(true)}>
          {t("common.archive")}
        </Button>
      ) : null}

      {may.canRestore ? (
        <Button
          variant="secondary"
          size="sm"
          disabled={pending}
          onClick={() => run("restore", t("suppliers.restored"))}
        >
          {t("common.restore")}
        </Button>
      ) : null}

      <ConfirmDialog
        open={archiving}
        onOpenChange={setArchiving}
        title={t("suppliers.archiveTitle", { name: supplier.name })}
        description={t("suppliers.archiveDescription")}
        confirmLabel={t("suppliers.archiveConfirm")}
        pending={pending}
        onConfirm={() => run("archive", t("suppliers.archivedToast"))}
      />
    </>
  );
}
