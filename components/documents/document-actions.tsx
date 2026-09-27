"use client";

import * as React from "react";
import Link from "@/components/navigation/nav-link";
import { useRouter } from "@/components/navigation/guarded-router";
import { Archive, ArchiveRestore, Download, MoreHorizontal, PenLine } from "lucide-react";

import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useToast } from "@/components/ui/toast";
import { archiveDocumentAction, restoreDocumentAction } from "@/lib/actions/documents";
import type { DocumentDetailDTO } from "@/lib/modules/documents/document.types";
import { uploadErrorText, useDocumentsTranslations } from "./documents-text";

/**
 * Document header actions (PRD #13 §102).
 *
 * Download is an ordinary link to the authenticated route, which re-checks
 * everything before it sends a byte — there is no URL here that skips
 * authorisation (PRD #13 §18, §104).
 */
export function DocumentActions({ document }: { document: DocumentDetailDTO }) {
  const router = useRouter();
  const toast = useToast();
  const t = useDocumentsTranslations();
  const [confirming, setConfirming] = React.useState(false);
  const [pending, startTransition] = React.useTransition();

  const may = document.capabilities;
  const archived = document.archivedAt !== null || document.status === "ARCHIVED";

  function archive() {
    startTransition(async () => {
      const result = await archiveDocumentAction(document.id);
      setConfirming(false);
      if (result.ok) {
        toast({ title: t("actions.archived") });
        router.refresh();
      } else {
        toast({ title: uploadErrorText(t, result.error), tone: "danger" });
      }
    });
  }

  function restore() {
    startTransition(async () => {
      const result = await restoreDocumentAction(document.id);
      if (result.ok) {
        toast({ title: t("actions.restored") });
        router.refresh();
      } else {
        toast({ title: uploadErrorText(t, result.error), tone: "danger" });
      }
    });
  }

  return (
    <>
      {may.canDownload ? (
        <Button asChild size="sm">
          <a href={`/api/documents/${document.id}/download`} download>
            <Download aria-hidden="true" />
            {t("actions.download")}
          </a>
        </Button>
      ) : null}

      {archived && may.canRestore ? (
        <Button size="sm" onClick={restore} disabled={pending}>
          <ArchiveRestore aria-hidden="true" />
          {pending ? t("actions.restoring") : t("actions.restore")}
        </Button>
      ) : null}

      {!archived && may.canEdit ? (
        <Button asChild variant="secondary" size="sm">
          <Link href={`/documents/${document.id}/edit`}>
            <PenLine aria-hidden="true" />
            {t("actions.edit")}
          </Link>
        </Button>
      ) : null}

      {!archived && may.canArchive ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon-sm" aria-label={t("actions.more")}>
              <MoreHorizontal />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem
              onSelect={(event) => {
                event.preventDefault();
                setConfirming(true);
              }}
            >
              <Archive />
              {t("actions.archive")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}

      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title={t("actions.archiveTitle", { name: document.name })}
        description={t("actions.archiveText")}
        confirmLabel={t("actions.archive")}
        pending={pending}
        onConfirm={archive}
      />
    </>
  );
}
