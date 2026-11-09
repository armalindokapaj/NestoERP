"use client";

import * as React from "react";
import { useTranslations } from "@/components/i18n/i18n-provider";
import { useRouter } from "@/components/navigation/guarded-router";
import { Archive, ArchiveRestore } from "lucide-react";

import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { EntityActionSheet } from "@/components/detail/entity-action-sheet";
import { useToast } from "@/components/ui/toast";
import type { UnitPublishingDTO } from "@/lib/modules/project-structure/unit-publishing.types";
import { failureMessage, structureApi } from "../structure-ui";

/**
 * What the reader may do to a unit's publication (E-05D §7, §32). A unit is
 * published when it is created and every change goes out at once (units publish
 * on create, 2026-11), so there is nothing to submit, publish or send back:
 * archiving is the one way out of use, and restoring brings the unit back
 * Published. Only permitted actions are offered; the server decides each again.
 */

type Dialogs = "archive" | "restore" | null;

export function PublishingActions({ unitId, unitCode, version, publishing }: { unitId: string; unitCode: string; version: number; publishing: UnitPublishingDTO }) {
  const t = useTranslations("projects");
  const router = useRouter();
  const toast = useToast();
  const [open, setOpen] = React.useState<Dialogs>(null);
  const [pending, setPending] = React.useState(false);
  const { status, capabilities: can } = publishing;

  const offerArchive = can.canArchive && status !== "ARCHIVED";
  const offerRestore = can.canRestore && status === "ARCHIVED";

  async function run(label: string, url: string, success: string) {
    setPending(true);
    try {
      await structureApi(url, { body: { expectedVersion: version } });
      toast({ title: success });
      setOpen(null);
      router.refresh();
    } catch (error) {
      setOpen(null);
      toast({ title: failureMessage(error, t("publishing.failed", { label })), tone: "danger" });
    } finally {
      setPending(false);
    }
  }

  if (!offerArchive && !offerRestore) return null;

  return (
    <>
      {/* One action list on every width: a sheet on a phone, the dropdown from md (MOB-04 §79). */}
      <EntityActionSheet
        name={unitCode}
        actions={[
          ...(offerRestore ? [{ key: "restore", label: t("publishing.restore"), icon: <ArchiveRestore aria-hidden="true" />, onSelect: () => setOpen("restore") }] : []),
          ...(offerArchive ? [{ key: "archive", label: t("publishing.archive"), icon: <Archive aria-hidden="true" />, destructive: true, onSelect: () => setOpen("archive") }] : []),
        ]}
      />

      <ConfirmDialog
        open={open === "archive"}
        onOpenChange={(value) => !value && setOpen(null)}
        title={t("publishing.archiveTitle", { code: unitCode })}
        description={t("publishing.archiveBody")}
        confirmLabel={t("publishing.archive")}
        pending={pending}
        onConfirm={() => void run(t("publishing.archiving"), `/api/project-units/${unitId}/archive`, t("publishing.archived", { code: unitCode }))}
      />
      <ConfirmDialog
        open={open === "restore"}
        onOpenChange={(value) => !value && setOpen(null)}
        title={t("publishing.restoreTitle", { code: unitCode })}
        description={t("publishing.restoreBody")}
        confirmLabel={t("publishing.restore")}
        destructive={false}
        pending={pending}
        onConfirm={() => void run(t("publishing.restoring"), `/api/project-units/${unitId}/restore`, t("publishing.restored", { code: unitCode }))}
      />
    </>
  );
}
