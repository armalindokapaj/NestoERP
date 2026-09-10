"use client";

import * as React from "react";
import Link from "next/link";
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
import { archiveProjectAction, restoreProjectAction } from "@/lib/actions/projects";

/**
 * Project header actions (PRD #10 §43, §63, §64).
 *
 * Only the actions this user may perform are rendered — a permission they lack
 * produces no control at all, disabled or otherwise (PRD #5 §32). Archive is
 * confirmed, and the confirmation says exactly what survives (PRD #10 §64).
 */
export function ProjectActions({
  projectId,
  projectName,
  archived,
  canUpdate,
  canArchive,
  canRestore,
}: {
  projectId: string;
  projectName: string;
  archived: boolean;
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
      const result = await archiveProjectAction(projectId);
      setConfirming(false);
      if (result.ok) {
        toast({ title: "Project archived." });
        router.refresh();
      } else {
        toast({ title: result.error, tone: "danger" });
      }
    });
  }

  function restore() {
    startTransition(async () => {
      const result = await restoreProjectAction(projectId);
      if (result.ok) {
        toast({ title: "Project restored." });
        router.refresh();
      } else {
        toast({ title: result.error, tone: "danger" });
      }
    });
  }

  const showMenu = archived ? canRestore : canArchive;

  return (
    <>
      {!archived && canUpdate ? (
        <Button asChild variant="secondary" size="sm">
          <Link href={`/projects/${projectId}/edit`}>
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

      {showMenu && !archived ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon-sm" aria-label="More project actions">
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
              Archive project
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}

      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title={`Archive ${projectName}?`}
        description="The project will be removed from active project lists. Its tasks, documents, team and history remain available as archived project data."
        confirmLabel="Archive project"
        pending={pending}
        onConfirm={archive}
      />
    </>
  );
}
