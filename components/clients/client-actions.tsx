"use client";

import * as React from "react";
import Link from "@/components/navigation/nav-link";
import { useRouter } from "@/components/navigation/guarded-router";
import { Archive, ArchiveRestore, MoreHorizontal, PenLine } from "lucide-react";

import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useToast } from "@/components/ui/toast";
import { archiveClientAction, restoreClientAction } from "@/lib/actions/clients";
import { useClientsServerText, useClientsTranslations } from "./clients-text";

/**
 * Client header actions (PRD #12 §57, §71, §72).
 *
 * Archive is confirmed, and the confirmation says exactly what survives —
 * because archiving a client changes nothing about its projects, contacts or
 * documents, and a person about to press it should know that (PRD #12 §72,
 * §73).
 */
export function ClientActions({
  clientId,
  clientName,
  archived,
  activeProjects,
  canUpdate,
  canArchive,
  canRestore,
}: {
  clientId: string;
  clientName: string;
  archived: boolean;
  activeProjects: number;
  canUpdate: boolean;
  canArchive: boolean;
  canRestore: boolean;
}) {
  const router = useRouter();
  const toast = useToast();
  const t = useClientsTranslations();
  const serverText = useClientsServerText();
  const [confirming, setConfirming] = React.useState(false);
  const [pending, startTransition] = React.useTransition();

  function archive() {
    startTransition(async () => {
      const result = await archiveClientAction(clientId);
      setConfirming(false);
      if (result.ok) {
        toast({ title: t("actions.archived") });
        router.refresh();
      } else {
        toast({ title: serverText(result.error) ?? result.error, tone: "danger" });
      }
    });
  }

  function restore() {
    startTransition(async () => {
      const result = await restoreClientAction(clientId);
      if (result.ok) {
        toast({ title: t("actions.restored") });
        router.refresh();
      } else {
        toast({ title: serverText(result.error) ?? result.error, tone: "danger" });
      }
    });
  }

  return (
    <>
      {!archived && canUpdate ? (
        <Button asChild variant="secondary" size="sm">
          <Link href={`/clients/${clientId}/edit`}>
            <PenLine aria-hidden="true" />
            {t("common.edit")}
          </Link>
        </Button>
      ) : null}

      {archived && canRestore ? (
        <Button size="sm" onClick={restore} disabled={pending}>
          <ArchiveRestore aria-hidden="true" />
          {pending ? t("actions.restoring") : t("actions.restore")}
        </Button>
      ) : null}

      {!archived && canArchive ? (
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
              {t("actions.archiveClient")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}

      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title={t("actions.archiveTitle", { name: clientName })}
        description={
          activeProjects > 0
            ? t("actions.archiveLinked", { count: activeProjects })
            : t("actions.archiveUnlinked")
        }
        confirmLabel={t("actions.archiveClient")}
        pending={pending}
        onConfirm={archive}
      />
    </>
  );
}
