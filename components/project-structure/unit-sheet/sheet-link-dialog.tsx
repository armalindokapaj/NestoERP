"use client";

import * as React from "react";
import { CircleAlert, Download, Link2 } from "@/components/icons";

import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { isApiFailure } from "@/lib/client/api-request";
import type { SheetCheckDTO, SheetLinkDTO } from "@/lib/modules/unit-sheet/unit-sheet.types";
import { cn } from "@/lib/utils/cn";
import { downloadFile, sheetApi } from "./sheet-client";
import { useSheetWords } from "./sheet-words";

/**
 * Link a Google Sheet, or change the link (2026-11-10).
 *
 * The person pastes the sheet's share link; a three-step how-to says how to
 * share it ("Anyone with the link", Viewer), and "Start from NESTO's units"
 * downloads the file a new sheet can be made from. "Check the sheet" reads it
 * without saving anything (`dryRun`) and says what was found — its rows, the
 * columns NESTO reads, the ones it shows but never reads, the ones it does
 * not know — and only then "Link this sheet" saves the link. Editing the link
 * after a check asks for a new check. A sheet Google will not hand over says
 * how to share it, in the reader's language (the server's sentence).
 */

type Checked = { url: string; check: SheetCheckDTO };

export function SheetLinkDialog({
  open,
  onOpenChange,
  projectId,
  current,
  onLinked,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  /** The link being changed; absent when linking for the first time. */
  current: SheetLinkDTO | null;
  onLinked: (link: SheetLinkDTO) => void;
}) {
  const words = useSheetWords();
  const { t } = words;
  const toast = useToast();
  const [url, setUrl] = React.useState(current?.url ?? "");
  const [checked, setChecked] = React.useState<Checked | null>(null);
  const [pending, setPending] = React.useState<"check" | "link" | "download" | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const inputId = React.useId();
  const errorId = `${inputId}-error`;

  React.useEffect(() => {
    if (!open) return;
    setUrl(current?.url ?? "");
    setChecked(null);
    setError(null);
  }, [open, current?.url]);

  const fresh = checked !== null && checked.url === url.trim();

  async function check(event?: React.FormEvent) {
    event?.preventDefault();
    const pasted = url.trim();
    if (!pasted) {
      setError(t("unitSheet.link.urlRequired"));
      return;
    }
    setPending("check");
    setError(null);
    try {
      const result = await sheetApi.link(projectId, pasted, true);
      setChecked({ url: pasted, check: result.check });
    } catch (failure) {
      setChecked(null);
      setError(isApiFailure(failure) ? failure.message : t("unitSheet.downloadFailed"));
    } finally {
      setPending(null);
    }
  }

  async function link() {
    if (!fresh || !checked) return;
    setPending("link");
    setError(null);
    try {
      const result = await sheetApi.link(projectId, checked.url, false);
      if (result.link) {
        onLinked(result.link);
        toast({ title: current ? t("unitSheet.link.changed") : t("unitSheet.link.linked"), tone: "success" });
        onOpenChange(false);
      }
    } catch (failure) {
      setError(isApiFailure(failure) ? failure.message : t("unitSheet.downloadFailed"));
    } finally {
      setPending(null);
    }
  }

  async function startFromNesto() {
    setPending("download");
    const outcome = await downloadFile(sheetApi.downloadUrl(projectId), "units.xlsx");
    setPending(null);
    if (!outcome.ok) toast({ title: outcome.message ?? t("unitSheet.downloadFailed"), tone: "danger" });
    else toast({ title: t("unitSheet.exportReady", { count: outcome.count }), tone: "success" });
  }

  const busy = pending === "check" || pending === "link";

  return (
    <Dialog open={open} onOpenChange={onOpenChange} locked={busy}>
      <DialogContent className="max-w-xl" presentation="fullscreen-phone" data-testid="sheet-link-dialog">
        <DialogTitle className="pr-8">{current ? t("unitSheet.link.changeTitle") : t("unitSheet.link.title")}</DialogTitle>
        <DialogDescription>{t("unitSheet.link.body")}</DialogDescription>

        <form className="mt-5 space-y-4" onSubmit={check} noValidate>
          <section aria-labelledby={`${inputId}-how`} className="rounded-lg border border-line bg-surface-muted px-4 py-3">
            <h3 id={`${inputId}-how`} className="text-table font-semibold text-fg">
              {t("unitSheet.link.howTitle")}
            </h3>
            <ol className="mt-2 space-y-1.5 text-table text-fg-muted" data-testid="sheet-how-to">
              {[t("unitSheet.link.how1"), t("unitSheet.link.how2"), t("unitSheet.link.how3")].map((step, index) => (
                <li key={index} className="flex gap-2.5">
                  <span aria-hidden="true" className="grid size-5 shrink-0 place-items-center rounded-full bg-surface text-micro font-semibold text-fg ring-1 ring-line-strong">
                    {index + 1}
                  </span>
                  <span className="min-w-0">{step}</span>
                </li>
              ))}
            </ol>
          </section>

          <div className="flex min-w-0 flex-col gap-1">
            <label htmlFor={inputId} className="text-meta font-medium text-fg-muted">
              {t("unitSheet.link.urlLabel")}
            </label>
            <Input
              id={inputId}
              type="url"
              inputMode="url"
              autoComplete="off"
              spellCheck={false}
              placeholder={t("unitSheet.link.urlPlaceholder")}
              value={url}
              onChange={(event) => {
                setUrl(event.target.value);
                setError(null);
              }}
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? errorId : undefined}
              data-testid="sheet-url"
            />
            {error ? (
              <p id={errorId} role="alert" className="flex items-start gap-1.5 text-meta text-danger-strong" data-testid="sheet-link-error">
                <CircleAlert className="mt-px size-3.5 shrink-0" aria-hidden="true" />
                <span className="min-w-0 [overflow-wrap:anywhere]">{error}</span>
              </p>
            ) : null}
          </div>

          {fresh && checked ? <CheckReport check={checked.check} changing={Boolean(current)} sameSheet={current !== null && sameSheet(current, checked.url)} /> : null}

          <section className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-dashed border-line-strong px-4 py-3">
            <div className="min-w-0 flex-1 basis-60">
              <h3 className="text-table font-semibold text-fg">{t("unitSheet.link.startTitle")}</h3>
              <p className="mt-0.5 text-meta text-fg-muted">{t("unitSheet.link.startBody")}</p>
            </div>
            <Button type="button" variant="secondary" size="sm" onClick={startFromNesto} loading={pending === "download"} data-testid="sheet-start-download">
              <Download aria-hidden="true" />
              {t("unitSheet.link.startDownload")}
            </Button>
          </section>

          <DialogFooter stackOnPhone className="mt-2">
            <DialogClose asChild>
              <Button type="button" variant="secondary" disabled={busy}>
                {t("unitSheet.link.cancel")}
              </Button>
            </DialogClose>
            {fresh ? (
              <Button type="button" onClick={link} loading={pending === "link"} data-testid="sheet-link-confirm">
                <Link2 aria-hidden="true" />
                {pending === "link" ? t("unitSheet.link.linking") : current ? t("unitSheet.link.confirmChange") : t("unitSheet.link.confirm")}
              </Button>
            ) : (
              <Button type="submit" loading={pending === "check"} data-testid="sheet-link-check">
                {pending === "check" ? t("unitSheet.link.checking") : t("unitSheet.link.check")}
              </Button>
            )}
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Whether a pasted link names the sheet and tab already linked: only a rough look, the server decides. */
function sameSheet(current: SheetLinkDTO, url: string): boolean {
  if (!url.includes(current.spreadsheetId)) return false;
  const gid = /[#&?]gid=(\d+)/.exec(url)?.[1] ?? null;
  return (gid ?? null) === (current.gid ?? null) || (gid === null && current.gid === "0") || (gid === "0" && current.gid === null);
}

/** What a check found: rows, the columns read, the ones only shown, the unknown ones, and what is missing. */
function CheckReport({ check, changing, sameSheet: same }: { check: SheetCheckDTO; changing: boolean; sameSheet: boolean }) {
  const { t } = useSheetWords();
  const read = check.columns.filter((column) => column.key !== null && !column.readOnly);
  const shown = check.columns.filter((column) => column.key !== null && column.readOnly);
  const name = (column: { column: string; header: string }) => (column.header ? `${column.column} · ${column.header}` : column.column);
  return (
    <section className="space-y-3 rounded-lg border border-line px-4 py-3" aria-live="polite" data-testid="sheet-check">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h3 className="text-table font-semibold text-fg">{t("unitSheet.link.found")}</h3>
        <p className="text-table text-fg-muted">
          <span className="font-medium text-fg [overflow-wrap:anywhere]" data-testid="sheet-check-title">
            {check.title ?? t("unitSheet.link.untitled")}
          </span>
          <span aria-hidden="true"> · </span>
          <span data-testid="sheet-check-rows">{t("unitSheet.link.rows", { count: check.rows })}</span>
        </p>
      </div>
      {read.length ? <ColumnList label={t("unitSheet.link.read")} items={read.map(name)} testId="sheet-check-read" /> : null}
      {shown.length ? <ColumnList label={t("unitSheet.link.workedOut")} items={shown.map(name)} muted testId="sheet-check-shown" /> : null}
      {check.unknownColumns.length ? <ColumnList label={t("unitSheet.link.unknown")} items={check.unknownColumns.map(name)} muted testId="sheet-check-unknown" /> : null}
      {!check.hasCodeColumn ? <Note>{t("unitSheet.link.noCode")}</Note> : check.rows === 0 ? <Note>{t("unitSheet.link.empty")}</Note> : null}
      {changing && !same ? <Note>{t("unitSheet.link.otherSheet")}</Note> : null}
    </section>
  );
}

function ColumnList({ label, items, muted = false, testId }: { label: string; items: string[]; muted?: boolean; testId: string }) {
  return (
    <div className="space-y-1">
      <p className="text-meta font-medium text-fg-muted">{label}</p>
      <ul className="flex flex-wrap gap-1.5" data-testid={testId}>
        {items.map((item) => (
          <li key={item} className={cn("max-w-full truncate rounded-md border px-2 py-0.5 text-meta", muted ? "border-dashed border-line-strong text-fg-muted" : "border-line bg-surface-muted text-fg")} title={item}>
            {item}
          </li>
        ))}
      </ul>
    </div>
  );
}

function Note({ children }: { children: React.ReactNode }) {
  return (
    <p className="flex items-start gap-2 rounded-md border border-warning/30 bg-warning-soft px-3 py-2 text-table text-warning-strong" data-testid="sheet-check-note">
      <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
      <span className="min-w-0">{children}</span>
    </p>
  );
}
