"use client";

import * as React from "react";
import Link from "@/components/navigation/nav-link";
import { useRouter } from "next/navigation";
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
  const [confirming, setConfirming] = React.useState(false);
  const [pending, startTransition] = React.useTransition();

  function archive() {
    startTransition(async () => {
      const result = await archiveClientAction(clientId);
      setConfirming(false);
      if (result.ok) {
        toast({ title: "Client archived." });
        router.refresh();
      } else {
        toast({ title: result.error, tone: "danger" });
      }
    });
  }

  function restore() {
    startTransition(async () => {
      const result = await restoreClientAction(clientId);
      if (result.ok) {
        toast({ title: "Client restored." });
        router.refresh();
      } else {
        toast({ title: result.error, tone: "danger" });
      }
    });
  }

  return (
    <>
      {!archived && canUpdate ? (
        <Button asChild variant="secondary" size="sm">
          <Link href={`/clients/${clientId}/edit`}>
            <PenLine aria-hidden="true" />
            Edit
          </Link>
        </Button>
      ) : null}

      {archived && canRestore ? (
        <Button size="sm" onClick={restore} disabled={pending}>
          <ArchiveRestore aria-hidden="true" />
          {pending ? "Restoring…" : "Restore"}
        </Button>
      ) : null}

      {!archived && canArchive ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon-sm" aria-label="More client actions">
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
              Archive client
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}

      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title={`Archive ${clientName}?`}
        description={
          activeProjects > 0
            ? `This client is linked to ${activeProjects} active project${
                activeProjects === 1 ? "" : "s"
              }. Archiving the client will not archive or remove them — the relationship stays visible in project history.`
            : "The client will be removed from active client lists. Its contacts, projects, documents and history remain."
        }
        confirmLabel="Archive client"
        pending={pending}
        onConfirm={archive}
      />
    </>
  );
}
