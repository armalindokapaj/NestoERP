"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Archive, ArchiveRestore, Images, MoreHorizontal, PenLine, Users } from "lucide-react";

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
  canManageMedia = false,
  canManageTeam = false,
}: {
  projectId: string;
  projectName: string;
  archived: boolean;
  canUpdate: boolean;
  canArchive: boolean;
  canRestore: boolean;
  canManageMedia?: boolean;
  canManageTeam?: boolean;
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

  const showMenu = archived ? canRestore : canArchive || canUpdate || canManageMedia || canManageTeam;

  return (
    <>
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
            {canUpdate ? <DropdownMenuItem asChild><Link href={`/projects/${projectId}/edit`}><PenLine />Edit project</Link></DropdownMenuItem> : null}
            {canManageMedia ? <DropdownMenuItem asChild><Link href={`/projects/${projectId}/media?manage=1`}><Images />Manage project media</Link></DropdownMenuItem> : null}
            {canManageTeam ? <DropdownMenuItem asChild><Link href={`/projects/${projectId}/team`}><Users />Manage team</Link></DropdownMenuItem> : null}
            {canArchive ? (
              <DropdownMenuItem
                onSelect={(event) => {
                  event.preventDefault();
                  setConfirming(true);
                }}
              >
                <Archive />
                Archive project
              </DropdownMenuItem>
            ) : null}
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
