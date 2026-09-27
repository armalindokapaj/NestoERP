"use client";

import * as React from "react";
import Link from "@/components/navigation/nav-link";
import { useRouter } from "@/components/navigation/guarded-router";
import { Archive, ArchiveRestore, Images, MoreHorizontal, PenLine, RefreshCw, Users } from "lucide-react";

import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useToast } from "@/components/ui/toast";
import { useTranslations } from "@/components/i18n/i18n-provider";
import { archiveProjectAction, restoreProjectAction } from "@/lib/actions/projects";
import type { WorkingStatus } from "@/lib/modules/projects/project.machine";
import { ChangeProjectStatusDialog } from "./change-project-status-dialog";

/**
 * Project header actions (PRD #10 §43, §63, §64).
 *
 * Only the actions this user may perform are rendered — a permission they lack
 * produces no control at all, disabled or otherwise (PRD #5 §32). Archive is
 * confirmed, and the confirmation says exactly what survives (PRD #10 §64).
 * Change status offers the moves this project can make from where it is, for
 * somebody who may manage its status (E-05A §12).
 */
export function ProjectActions({
  projectId,
  projectName,
  companyName,
  statusMoves = [],
  archived,
  canUpdate,
  canArchive,
  canRestore,
  canManageMedia = false,
  canManageTeam = false,
}: {
  projectId: string;
  projectName: string;
  companyName: string;
  /** Empty without `project.status.manage`. */
  statusMoves?: readonly WorkingStatus[];
  archived: boolean;
  canUpdate: boolean;
  canArchive: boolean;
  canRestore: boolean;
  canManageMedia?: boolean;
  canManageTeam?: boolean;
}) {
  const router = useRouter();
  const toast = useToast();
  const t = useTranslations("projects");
  const [confirming, setConfirming] = React.useState(false);
  const [changingStatus, setChangingStatus] = React.useState(false);
  const [pending, startTransition] = React.useTransition();

  function archive() {
    startTransition(async () => {
      const result = await archiveProjectAction(projectId);
      setConfirming(false);
      if (result.ok) {
        toast({ title: t("actions.archived") });
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
        toast({ title: t("actions.restored") });
        router.refresh();
      } else {
        toast({ title: result.error, tone: "danger" });
      }
    });
  }

  const canChangeStatus = !archived && statusMoves.length > 0;
  const showMenu = archived ? canRestore : canArchive || canUpdate || canChangeStatus || canManageMedia || canManageTeam;

  return (
    <>
      {archived && canRestore ? (
        <Button size="sm" onClick={restore} disabled={pending}>
          <ArchiveRestore aria-hidden="true" />
          {pending ? t("actions.restoring") : t("actions.restore")}
        </Button>
      ) : null}

      {showMenu && !archived ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon-sm" aria-label={t("actions.more")}>
              <MoreHorizontal />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {canUpdate ? <DropdownMenuItem asChild><Link href={`/projects/${projectId}/edit`}><PenLine />{t("actions.edit")}</Link></DropdownMenuItem> : null}
            {canChangeStatus ? <DropdownMenuItem onSelect={() => setChangingStatus(true)}><RefreshCw />{t("actions.changeStatusMenu")}</DropdownMenuItem> : null}
            {canManageMedia ? <DropdownMenuItem asChild><Link href={`/projects/${projectId}/media?manage=1`}><Images />{t("actions.manageMedia")}</Link></DropdownMenuItem> : null}
            {canManageTeam ? <DropdownMenuItem asChild><Link href={`/projects/${projectId}/team`}><Users />{t("actions.manageTeam")}</Link></DropdownMenuItem> : null}
            {canArchive ? (
              <DropdownMenuItem
                onSelect={(event) => {
                  event.preventDefault();
                  setConfirming(true);
                }}
              >
                <Archive />
                {t("actions.archive")}
              </DropdownMenuItem>
            ) : null}
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}

      <ChangeProjectStatusDialog
        project={canChangeStatus ? { id: projectId, name: projectName, companyName } : null}
        statusMoves={statusMoves}
        open={changingStatus}
        onOpenChange={setChangingStatus}
        onChanged={() => router.refresh()}
      />

      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title={t("actions.archiveTitle", { name: projectName })}
        description={t("actions.archiveBody")}
        confirmLabel={t("actions.archive")}
        pending={pending}
        onConfirm={archive}
      />
    </>
  );
}
