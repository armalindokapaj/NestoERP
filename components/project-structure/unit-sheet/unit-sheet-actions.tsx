"use client";

import * as React from "react";
import { ChevronDown, Download, ExternalLink, LayoutGrid, Link2, Pencil, RefreshCw, Trash2 } from "@/components/icons";

import { SheetActionButton } from "@/components/data/record-action-sheet";
import { FoldIntoPageMenu } from "@/components/navigation/page-menu";
import { BottomSheet } from "@/components/ui/bottom-sheet";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { useToast } from "@/components/ui/toast";
import { isApiFailure } from "@/lib/client/api-request";
import type { SheetApplyResultDTO, SheetLinkDTO, SheetStatusDTO } from "@/lib/modules/unit-sheet/unit-sheet.types";
import { cn } from "@/lib/utils/cn";
import { exportQuery } from "./sheet-choices";
import { announceUnitsChanged, downloadFile, sheetApi, sheetHref } from "./sheet-client";
import { SheetLinkDialog } from "./sheet-link-dialog";
import { SheetSyncDialog } from "./sheet-sync-dialog";
import { type SheetWords, useSheetWords } from "./sheet-words";

/**
 * Export and the Google Sheet control (2026-11-10), the same on the Units tab
 * and the Sales tab — the two tabs that share one table — beside the tab's
 * other header actions: [Prices] [Export] [Google Sheet ▾] [+ Add units].
 *
 * - Export: every unit the tab's search and filters match (not one page), as
 *   the .xlsx "Download for Google Sheets" writes — the same columns, so an
 *   exported file can be imported into a sheet and linked — plus the sale
 *   status for a reader who may see sales. Anyone who can see the units.
 * - Google Sheet ▾: not linked, "Link a Google Sheet" (and the download a new
 *   sheet starts from); linked, who linked it and when, the last sync and by
 *   whom, then Sync now, Download for Google Sheets, Open in Google Sheets,
 *   Change link and Unlink. One link per project, shared by both tabs: each
 *   reads it again when it opens.
 *
 * What a reader may do follows the server's capabilities: link, change,
 * unlink and sync need the unit-edit permission; a reader who may not edit
 * sees a linked sheet (not its address) and may download, and sees nothing
 * when there is no link. The server checks every request again.
 *
 * Below lg both are secondary page actions (components/navigation/page-menu.tsx):
 * items of the page's ⋯, and "Google Sheet" there opens a bottom sheet with
 * the same status and actions.
 */

type Dialog = "link" | "change" | "sync" | "unlink" | "sheet" | null;

export function UnitSheetActions({
  projectId,
  view,
  initialStatus,
  exportOffered,
  sheetOffered,
}: {
  projectId: string;
  /** Which tab the controls sit on: Export takes that tab's search and filters. */
  view: "units" | "sales";
  /** The link and capabilities as the page read them; read again once drawn, as the other tab may have changed the link. */
  initialStatus: SheetStatusDTO | null;
  /** Export is offered: the project has units. */
  exportOffered: boolean;
  /** The Google Sheet control is offered: the project has buildings for the sheet's rows to land in. */
  sheetOffered: boolean;
}) {
  const words = useSheetWords();
  const { t } = words;
  const toast = useToast();
  const [status, setStatus] = React.useState<SheetStatusDTO | null>(initialStatus);
  const [dialog, setDialog] = React.useState<Dialog>(null);
  const [busy, setBusy] = React.useState<"export" | "download" | "unlink" | null>(null);
  const busyRef = React.useRef(false);
  // What opens next, so the bottom sheet does not pull focus back to the page as a dialog it led to opens.
  const dialogRef = React.useRef<Dialog>(null);
  React.useEffect(() => {
    dialogRef.current = dialog;
  }, [dialog]);

  // The link is one per project and either tab may change it: read it again once drawn.
  React.useEffect(() => {
    if (!sheetOffered) return;
    const controller = new AbortController();
    sheetApi
      .status(projectId, controller.signal)
      .then((next) => setStatus(next))
      .catch(() => undefined);
    return () => controller.abort();
  }, [projectId, sheetOffered]);

  const link = status?.link ?? null;
  const caps = status?.capabilities ?? null;
  const showSheet = sheetOffered && caps !== null && (link !== null || caps.canLink);

  async function save(kind: "export" | "download", url: string) {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(kind);
    try {
      const outcome = await downloadFile(url, "units.xlsx");
      if (outcome.ok) toast({ title: t("unitSheet.exportReady", { count: outcome.count }), tone: "success" });
      else toast({ title: outcome.message ?? t("unitSheet.downloadFailed"), tone: "danger" });
    } finally {
      busyRef.current = false;
      setBusy(null);
    }
  }

  const runExport = () => void save("export", sheetApi.downloadUrl(projectId, exportQuery(window.location.search, view)));
  const runDownload = () => void save("download", sheetApi.downloadUrl(projectId));

  async function unlink() {
    setBusy("unlink");
    try {
      await sheetApi.unlink(projectId);
      setStatus((current) => (current ? { ...current, link: null } : current));
      setDialog(null);
      toast({ title: t("unitSheet.unlinkDialog.done"), tone: "success" });
    } catch (failure) {
      if (isApiFailure(failure) && failure.detailCode === "SHEET_NOT_LINKED") {
        setStatus((current) => (current ? { ...current, link: null } : current));
        setDialog(null);
      }
      toast({ title: isApiFailure(failure) ? failure.message : t("unitSheet.downloadFailed"), tone: "danger" });
    } finally {
      setBusy(null);
    }
  }

  function synced(result: SheetApplyResultDTO) {
    setStatus((current) => (current ? { ...current, link: result.link } : current));
    if (result.applied.units.length || result.applied.newUnits.length || result.putOnSale.moved.length) announceUnitsChanged(projectId);
  }

  const notLinked = React.useCallback(() => setStatus((current) => (current ? { ...current, link: null } : current)), []);

  if (!exportOffered && !showSheet) return null;

  const exportButton = exportOffered ? (
    <FoldIntoPageMenu item={{ kind: "action", label: t("unitSheet.export"), icon: <Download aria-hidden="true" />, onSelect: runExport }}>
      <Button variant="secondary" onClick={runExport} loading={busy === "export"} title={t("unitSheet.exportHint")} data-testid="units-export" data-view={view}>
        <Download aria-hidden="true" />
        {busy === "export" ? t("unitSheet.exporting") : t("unitSheet.export")}
      </Button>
    </FoldIntoPageMenu>
  ) : null;

  const sheetControl =
    showSheet && caps ? (
      <FoldIntoPageMenu
        item={{
          kind: "action",
          label: link ? t("unitSheet.control") : t("unitSheet.linkSheet"),
          icon: <LayoutGrid aria-hidden="true" />,
          // Linked: the same status and actions as a bottom sheet; not linked: straight to linking.
          onSelect: () => setDialog(link ? "sheet" : "link"),
        }}
      >
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="secondary" aria-label={t("unitSheet.controlFor", { state: link ? t("unitSheet.stateLinked") : t("unitSheet.stateNotLinked") })} data-testid="sheet-control" data-linked={link ? "true" : "false"}>
              <LayoutGrid aria-hidden="true" />
              {t("unitSheet.control")}
              {link ? <span aria-hidden="true" className="size-1.5 shrink-0 rounded-full bg-success" data-testid="sheet-linked-dot" /> : null}
              <ChevronDown aria-hidden="true" className="-mr-1 text-fg-subtle" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-80" data-testid="sheet-menu">
            <StatusLines link={link} canSync={caps.canSync} words={words} className="px-2.5 pb-2 pt-1.5" />
            <DropdownMenuSeparator />
            {link ? (
              <>
                {caps.canSync ? (
                  <DropdownMenuItem onSelect={() => setDialog("sync")} data-testid="sheet-sync-open">
                    <RefreshCw aria-hidden="true" />
                    {t("unitSheet.syncNow")}
                  </DropdownMenuItem>
                ) : null}
                {caps.canDownload ? (
                  <DropdownMenuItem onSelect={runDownload} disabled={busy === "download"} data-testid="sheet-download">
                    <Download aria-hidden="true" />
                    {t("unitSheet.download")}
                  </DropdownMenuItem>
                ) : null}
                {link.url ? (
                  <DropdownMenuItem asChild data-testid="sheet-open-google">
                    <a href={sheetHref(link.spreadsheetId, link.gid)} target="_blank" rel="noopener noreferrer">
                      <ExternalLink aria-hidden="true" />
                      {t("unitSheet.openSheet")}
                    </a>
                  </DropdownMenuItem>
                ) : null}
                {caps.canLink ? (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onSelect={() => setDialog("change")} data-testid="sheet-change-link">
                      <Pencil aria-hidden="true" />
                      {t("unitSheet.changeLink")}
                    </DropdownMenuItem>
                    <DropdownMenuItem variant="destructive" onSelect={() => setDialog("unlink")} data-testid="sheet-unlink">
                      <Trash2 aria-hidden="true" />
                      {t("unitSheet.unlink")}
                    </DropdownMenuItem>
                  </>
                ) : null}
              </>
            ) : (
              <>
                <DropdownMenuItem onSelect={() => setDialog("link")} data-testid="sheet-link-open">
                  <Link2 aria-hidden="true" />
                  {t("unitSheet.linkSheet")}
                </DropdownMenuItem>
                {caps.canDownload ? (
                  <DropdownMenuItem onSelect={runDownload} disabled={busy === "download"} data-testid="sheet-download">
                    <Download aria-hidden="true" />
                    {t("unitSheet.download")}
                  </DropdownMenuItem>
                ) : null}
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </FoldIntoPageMenu>
    ) : null;

  return (
    <>
      {exportButton}
      {sheetControl}

      {showSheet && caps ? (
        <>
          {/* Below lg: "Google Sheet" from the page's ⋯, the status and the same actions in a bottom sheet. */}
          <BottomSheet
            open={dialog === "sheet" && link !== null}
            onOpenChange={(open) => !open && setDialog((current) => (current === "sheet" ? null : current))}
            title={t("unitSheet.control")}
            onCloseAutoFocus={(event) => {
              if (dialogRef.current !== null) event.preventDefault();
            }}
          >
            {link ? (
              <div data-testid="sheet-phone-sheet">
                <StatusLines link={link} canSync={caps.canSync} words={words} className="pb-3" />
                <div role="group" aria-label={t("unitSheet.control")} className="-mx-1 flex flex-col">
                  {caps.canSync ? (
                    <SheetActionButton icon={<RefreshCw aria-hidden="true" />} onSelect={() => setDialog("sync")}>
                      {t("unitSheet.syncNow")}
                    </SheetActionButton>
                  ) : null}
                  {caps.canDownload ? (
                    <SheetActionButton
                      icon={<Download aria-hidden="true" />}
                      disabled={busy === "download"}
                      onSelect={() => {
                        setDialog(null);
                        runDownload();
                      }}
                    >
                      {t("unitSheet.download")}
                    </SheetActionButton>
                  ) : null}
                  {link.url ? (
                    <a href={sheetHref(link.spreadsheetId, link.gid)} target="_blank" rel="noopener noreferrer" className="flex min-h-12 w-full items-center gap-3 rounded-md px-3 text-left text-body font-medium text-fg hover:bg-hover [&_svg]:size-[18px] [&_svg]:shrink-0 [&_svg]:text-fg-subtle">
                      <ExternalLink aria-hidden="true" />
                      {t("unitSheet.openSheet")}
                    </a>
                  ) : null}
                  {caps.canLink ? (
                    <>
                      <SheetActionButton icon={<Pencil aria-hidden="true" />} onSelect={() => setDialog("change")}>
                        {t("unitSheet.changeLink")}
                      </SheetActionButton>
                      <SheetActionButton destructive icon={<Trash2 aria-hidden="true" />} onSelect={() => setDialog("unlink")}>
                        {t("unitSheet.unlink")}
                      </SheetActionButton>
                    </>
                  ) : null}
                </div>
              </div>
            ) : null}
          </BottomSheet>

          {caps.canLink ? (
            <SheetLinkDialog
              open={dialog === "link" || dialog === "change"}
              onOpenChange={(open) => !open && setDialog(null)}
              projectId={projectId}
              current={dialog === "change" ? link : null}
              onLinked={(next) => setStatus((current) => (current ? { ...current, link: next } : current))}
            />
          ) : null}

          {/* Kept while open, so a link removed meanwhile is said inside it rather than closing it. */}
          {caps.canSync && (link || dialog === "sync") ? <SheetSyncDialog open={dialog === "sync"} onOpenChange={(open) => !open && setDialog(null)} projectId={projectId} onSynced={synced} onNotLinked={notLinked} /> : null}

          <ConfirmDialog
            open={dialog === "unlink"}
            onOpenChange={(open) => !open && busy !== "unlink" && setDialog(null)}
            title={t("unitSheet.unlinkDialog.title")}
            description={t("unitSheet.unlinkDialog.body")}
            confirmLabel={t("unitSheet.unlinkDialog.confirm")}
            pending={busy === "unlink"}
            onConfirm={() => void unlink()}
          />
        </>
      ) : null}
    </>
  );
}

/** "Linked to Riverside units · Linked 10 Nov 2026 by Ana Hoxha · Last synced … by …", or why there is no link. */
function StatusLines({ link, canSync, words, className }: { link: SheetLinkDTO | null; canSync: boolean; words: SheetWords; className?: string }) {
  const { t } = words;
  const who = (name: string | null | undefined) => name || t("unitSheet.someone");
  if (!link) {
    return (
      <div className={cn("space-y-0.5", className)} data-testid="sheet-status">
        <p className="text-table font-medium text-fg">{t("unitSheet.notLinkedTitle")}</p>
        <p className="text-meta text-fg-muted">{t("unitSheet.notLinkedBody")}</p>
      </div>
    );
  }
  return (
    <div className={cn("min-w-0 space-y-0.5", className)} data-testid="sheet-status">
      <p className="text-table font-medium text-fg [overflow-wrap:anywhere]" data-testid="sheet-status-title">
        {link.title ? t("unitSheet.linkedTo", { title: link.title }) : t("unitSheet.linkedUntitled")}
      </p>
      <p className="text-meta text-fg-muted">{t("unitSheet.linkedBy", { date: words.when(link.linkedAt), name: who(link.linkedBy.name) })}</p>
      <p className="text-meta text-fg-muted" data-testid="sheet-status-synced">
        {link.lastSyncedAt ? t("unitSheet.lastSynced", { date: words.when(link.lastSyncedAt), name: who(link.lastSyncedBy?.name) }) : t("unitSheet.neverSynced")}
      </p>
      {!canSync ? <p className="pt-1 text-meta text-fg-muted">{t("unitSheet.readOnly")}</p> : null}
    </div>
  );
}
