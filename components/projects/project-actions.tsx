"use client";

import * as React from "react";
import Link from "@/components/navigation/nav-link";
import { useRouter } from "@/components/navigation/guarded-router";
import { Archive, ArchiveRestore, CloudDownload, CloudOff, Images, Loader2, MoreHorizontal, PenLine, RefreshCw, Star, Users } from "lucide-react";

import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useToast } from "@/components/ui/toast";
import { useTranslations } from "@/components/i18n/i18n-provider";
import { useCommonTranslations } from "@/components/i18n/common-text";
import { useAvailableOffline } from "@/components/offline/available-offline";
import { useFavorite } from "@/components/productivity/favorite-button";
import { cn } from "@/lib/utils/cn";
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
 *
 * On the project's Overview the menu also carries the star (`favorite`, when
 * favourites are on) and "Available offline" (`offline`, on a live project):
 * the record's own toggles first, then what changes the project.
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
  favorite,
  offline = false,
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
  /** The star's state as the page read it; absent when favourites are off for the company. */
  favorite?: { initial: boolean };
  /** Offer "Available offline" (a live project only). */
  offline?: boolean;
}) {
  const router = useRouter();
  const toast = useToast();
  const t = useTranslations("projects");
  const [confirming, setConfirming] = React.useState(false);
  const [changingStatus, setChangingStatus] = React.useState(false);
  const [pending, startTransition] = React.useTransition();
  const common = useCommonTranslations();
  const offlineText = useTranslations("offline");
  const star = useFavorite("project", projectId, favorite?.initial ?? false);
  const download = useAvailableOffline(projectId, projectName);
  const { error: offlineError, blocked: offlineBlocked, clearMessages } = download;

  // The menu closes as its item is chosen, so what the download has to say comes as a toast.
  React.useEffect(() => {
    if (!offlineError && offlineBlocked === null) return;
    toast({ title: offlineError ?? offlineText("available.turnOffBlocked", { count: offlineBlocked ?? 0 }), tone: offlineError ? "danger" : "warning" });
    clearMessages();
  }, [offlineError, offlineBlocked, clearMessages, toast, offlineText]);

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
  const showOffline = offline && !archived && download.shown;
  const toggles = Boolean(favorite) || showOffline;
  const changes = !archived && (canArchive || canUpdate || canChangeStatus || canManageMedia || canManageTeam);
  const showMenu = toggles || changes;

  return (
    <>
      {archived && canRestore ? (
        <Button size="sm" onClick={restore} disabled={pending}>
          <ArchiveRestore aria-hidden="true" />
          {pending ? t("actions.restoring") : t("actions.restore")}
        </Button>
      ) : null}

      {showMenu ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon-sm" aria-label={t("actions.more")}>
              <MoreHorizontal />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-56">
            {favorite ? (
              <DropdownMenuItem onSelect={() => void star.toggle()} disabled={star.pending} data-testid="favorite-menu-item" aria-label={star.favorite ? common("favorite.remove") : common("favorite.add")}>
                <Star aria-hidden="true" className={cn(star.favorite && "fill-warning text-warning")} />
                {star.favorite ? common("favorite.remove") : common("favorite.add")}
              </DropdownMenuItem>
            ) : null}
            {showOffline ? (
              <DropdownMenuItem
                disabled={download.unsupported || download.working}
                onSelect={() => (download.on ? download.askTurnOff() : download.turnOn())}
                data-testid="available-offline-item"
              >
                {download.working ? <Loader2 aria-hidden="true" className="animate-spin" /> : download.on ? <CloudOff aria-hidden="true" /> : <CloudDownload aria-hidden="true" />}
                <span className="flex min-w-0 flex-col">
                  <span>{download.unsupported ? offlineText("available.unavailableBrowser") : download.on ? offlineText("available.menuOff") : offlineText("available.menuOn")}</span>
                  {download.status ? <span className="text-micro text-fg-muted" data-testid="available-offline-status">{download.status}</span> : null}
                </span>
              </DropdownMenuItem>
            ) : null}
            {toggles && changes ? <DropdownMenuSeparator /> : null}
            {!archived && canUpdate ? <DropdownMenuItem asChild><Link href={`/projects/${projectId}/edit`}><PenLine />{t("actions.edit")}</Link></DropdownMenuItem> : null}
            {!archived && canChangeStatus ? <DropdownMenuItem onSelect={() => setChangingStatus(true)}><RefreshCw />{t("actions.changeStatusMenu")}</DropdownMenuItem> : null}
            {!archived && canManageMedia ? <DropdownMenuItem asChild><Link href={`/projects/${projectId}/media?manage=1`}><Images />{t("actions.manageMedia")}</Link></DropdownMenuItem> : null}
            {!archived && canManageTeam ? <DropdownMenuItem asChild><Link href={`/projects/${projectId}/team`}><Users />{t("actions.manageTeam")}</Link></DropdownMenuItem> : null}
            {!archived && canArchive ? (
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

      {showOffline ? download.dialogs : null}

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
