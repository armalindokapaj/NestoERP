"use client";

import * as React from "react";
import { ArrowRight, CircleAlert, CircleCheck, Download, LoaderCircle, RefreshCw } from "@/components/icons";

import { PutOnSaleTick } from "@/components/sales/unit-sales/put-on-sale";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Radio } from "@/components/ui/radio";
import { useToast } from "@/components/ui/toast";
import { isApiFailure } from "@/lib/client/api-request";
import { floorName, unitTypeName } from "@/lib/i18n/stock-names";
import type { SheetApplyResultDTO, SheetField, SheetPreviewDTO, SheetSkipDTO } from "@/lib/modules/unit-sheet/unit-sheet.types";
import { cn } from "@/lib/utils/cn";
import { allChangeIds, applyBody, chosenCount, type ClashPick, hasDecisions, initialChoices, pickClash, putOnSaleCandidates, setTicked, type SyncChoices, tickState, unpickedCount } from "./sheet-choices";
import { downloadFile, sheetApi } from "./sheet-client";
import { type SheetWords, useSheetWords } from "./sheet-words";

/**
 * Sync now (2026-11-10): reads the linked sheet, shows every change it would
 * make, and changes nothing until the person confirms.
 *
 * Counts first, then the sections: Changes from the sheet (each unit and
 * each field untickable), Clashes (the sheet's value and NESTO's side by
 * side, one picked per field, or none — it then waits), New units (each
 * untickable), Newer in NESTO (with the download that brings the sheet up to
 * date), Skipped (with the reason), Not in the sheet (folded) and the columns
 * NESTO does not know (one line). "Also put newly priced units on sale" is
 * ticked, as the Price dialog's is. Confirm sends the choices with the
 * versions the preview saw; the result lists what changed and what was
 * skipped, and why. With nothing to decide, Confirm still marks the two as
 * synced, so later changes on either side are told apart.
 *
 * A phone gets the whole screen and nothing scrolls sideways: long values
 * wrap, the two sides of a clash stack.
 */

/** How many units a section shows before "Show N more": a first sync of thousands of rows stays quick to draw. */
const PAGE = 40;
const NO_TYPES: ReadonlyArray<{ id: string; name: string }> = [];

type Stage =
  | { kind: "reading" }
  | { kind: "failed"; message: string; code: string | undefined }
  | { kind: "preview"; preview: SheetPreviewDTO }
  | { kind: "applying"; preview: SheetPreviewDTO }
  | { kind: "done"; result: SheetApplyResultDTO; preview: SheetPreviewDTO };

export function SheetSyncDialog({
  open,
  onOpenChange,
  projectId,
  onSynced,
  onNotLinked,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  /** After a confirm: the link with its new version and last sync. */
  onSynced: (result: SheetApplyResultDTO) => void;
  /** The link went away meanwhile (somebody unlinked it). */
  onNotLinked: () => void;
}) {
  const [stage, setStage] = React.useState<Stage>({ kind: "reading" });
  const [choices, setChoices] = React.useState<SyncChoices>({ accept: new Set(), clashes: new Map(), putOnSale: true });
  const [applyError, setApplyError] = React.useState<{ message: string; again: boolean } | null>(null);
  const preview = stage.kind === "preview" || stage.kind === "applying" || stage.kind === "done" ? stage.preview : null;
  const words = useSheetWords(preview?.unitTypes ?? NO_TYPES);
  const { t } = words;
  const toast = useToast();

  const read = React.useCallback(
    async (signal?: AbortSignal) => {
      setStage({ kind: "reading" });
      setApplyError(null);
      try {
        const next = await sheetApi.preview(projectId, signal);
        setChoices(initialChoices(next));
        setStage({ kind: "preview", preview: next });
      } catch (failure) {
        if (signal?.aborted) return;
        const code = isApiFailure(failure) ? failure.detailCode : undefined;
        if (code === "SHEET_NOT_LINKED") onNotLinked();
        setStage({ kind: "failed", message: isApiFailure(failure) ? failure.message : t("unitSheet.downloadFailed"), code });
      }
    },
    [projectId, onNotLinked, t],
  );

  React.useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    void read(controller.signal);
    return () => controller.abort();
    // Read once each time the dialog opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  async function confirm() {
    if (stage.kind !== "preview") return;
    const current = stage.preview;
    setApplyError(null);
    setStage({ kind: "applying", preview: current });
    try {
      const result = await sheetApi.apply(projectId, applyBody(current, choices));
      onSynced(result);
      setStage({ kind: "done", result, preview: current });
    } catch (failure) {
      const code = isApiFailure(failure) ? failure.detailCode : undefined;
      setApplyError({ message: isApiFailure(failure) ? failure.message : t("unitSheet.downloadFailed"), again: code === "SHEET_CHANGED" || code === "SHEET_SYNC_STALE" });
      setStage({ kind: "preview", preview: current });
    }
  }

  async function download() {
    const outcome = await downloadFile(sheetApi.downloadUrl(projectId), "units.xlsx");
    if (!outcome.ok) toast({ title: outcome.message ?? t("unitSheet.downloadFailed"), tone: "danger" });
    else toast({ title: t("unitSheet.exportReady", { count: outcome.count }), tone: "success" });
  }

  const applying = stage.kind === "applying";

  return (
    <Dialog open={open} onOpenChange={onOpenChange} locked={applying}>
      <DialogContent className="max-w-4xl pb-0 max-sm:pb-0" presentation="fullscreen-phone" data-testid="sheet-sync-dialog" data-stage={stage.kind}>
        <div className="flex min-h-full flex-col">
          <DialogTitle className="pr-8">{stage.kind === "done" ? t("unitSheet.result.title") : t("unitSheet.sync.title")}</DialogTitle>
          {stage.kind === "reading" ? (
            <DialogDescription className="sr-only">{t("unitSheet.sync.reading")}</DialogDescription>
          ) : stage.kind === "failed" ? (
            <DialogDescription className="sr-only">{t("unitSheet.sync.failedTitle")}</DialogDescription>
          ) : stage.kind === "done" ? (
            <DialogDescription className="mt-1 text-body text-fg-muted" data-testid="sheet-result-summary">
              {resultSummary(stage.result, words)}
            </DialogDescription>
          ) : preview ? (
            <DialogDescription className="text-table">{t("unitSheet.sync.readFrom", { title: preview.sheet.title ?? preview.link.title ?? t("unitSheet.link.untitled"), time: words.when(preview.readAt) })}</DialogDescription>
          ) : null}

          {stage.kind === "reading" ? (
            <div className="flex flex-1 items-center justify-center gap-2 py-16 text-table text-fg-muted" role="status" data-testid="sheet-sync-reading">
              <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />
              {t("unitSheet.sync.reading")}
            </div>
          ) : stage.kind === "failed" ? (
            <ReadFailure message={stage.message} code={stage.code} onRetry={() => void read()} onDownload={download} words={words} />
          ) : stage.kind === "done" ? (
            <Result result={stage.result} words={words} onClose={() => onOpenChange(false)} />
          ) : preview ? (
            <PreviewBody preview={preview} choices={choices} setChoices={setChoices} words={words} applying={applying} error={applyError} onConfirm={confirm} onAgain={() => void read()} onDownload={download} />
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}

/* Reading failed ------------------------------------------------------------------- */

function ReadFailure({ message, code, onRetry, onDownload, words }: { message: string; code: string | undefined; onRetry: () => void; onDownload: () => void; words: SheetWords }) {
  const { t } = words;
  return (
    <div className="flex flex-1 flex-col gap-4 pb-6 pt-4" data-testid="sheet-sync-failed" data-code={code}>
      <div role="alert" className="flex items-start gap-2.5 rounded-lg border border-danger/30 bg-danger-soft px-4 py-3 text-table text-danger-strong">
        <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
        <div className="min-w-0">
          <p className="font-semibold">{t("unitSheet.sync.failedTitle")}</p>
          <p className="mt-0.5 [overflow-wrap:anywhere]">{message}</p>
        </div>
      </div>
      {code === "SHEET_NOT_SHARED" ? (
        <ol className="space-y-1.5 text-table text-fg-muted">
          {[t("unitSheet.link.how1"), t("unitSheet.link.how2"), t("unitSheet.link.how3")].map((step, index) => (
            <li key={index} className="flex gap-2.5">
              <span aria-hidden="true" className="grid size-5 shrink-0 place-items-center text-micro font-semibold text-fg ring-1 ring-line-strong">
                {index + 1}
              </span>
              <span className="min-w-0">{step}</span>
            </li>
          ))}
        </ol>
      ) : null}
      <div className="mt-auto flex flex-wrap justify-end gap-2 max-sm:flex-col-reverse max-sm:items-stretch">
        <DialogClose asChild>
          <Button variant="secondary">{t("unitSheet.sync.cancel")}</Button>
        </DialogClose>
        {code === "SHEET_NO_CODE_COLUMN" ? (
          <Button variant="secondary" onClick={onDownload}>
            <Download aria-hidden="true" />
            {t("unitSheet.download")}
          </Button>
        ) : null}
        {code !== "SHEET_NOT_LINKED" ? (
          <Button onClick={onRetry} data-testid="sheet-sync-retry">
            <RefreshCw aria-hidden="true" />
            {t("unitSheet.sync.retry")}
          </Button>
        ) : null}
      </div>
    </div>
  );
}

/* The preview ------------------------------------------------------------------------ */

function PreviewBody({
  preview,
  choices,
  setChoices,
  words,
  applying,
  error,
  onConfirm,
  onAgain,
  onDownload,
}: {
  preview: SheetPreviewDTO;
  choices: SyncChoices;
  setChoices: React.Dispatch<React.SetStateAction<SyncChoices>>;
  words: SheetWords;
  applying: boolean;
  error: { message: string; again: boolean } | null;
  onConfirm: () => void;
  onAgain: () => void;
  onDownload: () => void;
}) {
  const { t } = words;
  const sections = React.useRef<Record<string, HTMLElement | null>>({});
  const chosen = chosenCount(preview, choices);
  const unpicked = unpickedCount(preview, choices);
  const candidates = preview.putOnSale.allowed ? putOnSaleCandidates(preview, choices) : 0;
  const decisions = hasDecisions(preview);
  // A currency for new units' prices: the project's units are priced in one.
  const currency = [...preview.changes, ...preview.clashes, ...preview.newerInNesto].find((unit) => unit.currency)?.currency ?? null;
  const counts = preview.counts;
  const chips: Array<{ key: string; count: number; label: string; tone: string }> = [
    { key: "changes", count: counts.changes, label: t("unitSheet.sync.count.changes", { count: counts.changes }), tone: "accent" },
    { key: "clashes", count: counts.clashes, label: t("unitSheet.sync.count.clashes", { count: counts.clashes }), tone: "warning" },
    { key: "newUnits", count: counts.newUnits, label: t("unitSheet.sync.count.newUnits", { count: counts.newUnits }), tone: "accent" },
    { key: "newer", count: counts.newerInNesto, label: t("unitSheet.sync.count.newer", { count: counts.newerInNesto }), tone: "info" },
    { key: "skipped", count: counts.skipped, label: t("unitSheet.sync.count.skipped", { count: counts.skipped }), tone: "danger" },
    { key: "notInSheet", count: counts.notInSheet, label: t("unitSheet.sync.count.notInSheet", { count: counts.notInSheet }), tone: "muted" },
    { key: "unchanged", count: counts.unchangedUnits, label: t("unitSheet.sync.count.unchanged", { count: counts.unchangedUnits }), tone: "muted" },
  ];

  return (
    <>
      <div className="mt-4 flex-1 space-y-6 pb-6">
        {/* Counts first; each one with something behind it goes to its section. */}
        <nav aria-label={t("unitSheet.sync.summary")}>
          <ul className="flex flex-wrap gap-1.5" data-testid="sheet-sync-counts">
            {chips.map((chip) => (
              <li key={chip.key}>
                <button
                  type="button"
                  disabled={chip.count === 0 || chip.key === "unchanged"}
                  onClick={() => sections.current[chip.key]?.scrollIntoView({ behavior: "smooth", block: "start" })}
                  data-testid={`sheet-count-${chip.key}`}
                  data-count={chip.count}
                  className={cn(
                    "inline-flex h-7 items-center border px-2.5 text-meta font-medium tabular-nums transition-colors touch:h-9 disabled:cursor-default",
                    chip.count === 0 || chip.tone === "muted"
                      ? "border-line bg-surface text-fg-muted"
                      : chip.tone === "warning"
                        ? "border-transparent bg-warning-soft text-warning-strong hover:brightness-95"
                        : chip.tone === "danger"
                          ? "border-transparent bg-danger-soft text-danger-strong hover:brightness-95"
                          : chip.tone === "info"
                            ? "border-transparent bg-info-soft text-info-strong hover:brightness-95"
                            : "border-transparent bg-accent-soft text-fg hover:brightness-95",
                  )}
                >
                  {chip.label}
                </button>
              </li>
            ))}
          </ul>
        </nav>

        {preview.firstSync && decisions ? <Callout tone="info">{t("unitSheet.sync.firstSync")}</Callout> : null}
        {!decisions ? (
          <Callout tone="success" testId="sheet-sync-nothing">
            {preview.firstSync ? t("unitSheet.sync.nothingFirst") : t("unitSheet.sync.nothing")}
          </Callout>
        ) : null}

        {preview.changes.length ? (
          <Section
            id="changes"
            refs={sections}
            title={t("unitSheet.sync.changes")}
            hint={t("unitSheet.sync.changesHint")}
            count={counts.changes}
            action={<TickAll ids={allChangeIds(preview)} choices={choices} setChoices={setChoices} words={words} disabled={applying} />}
          >
            <Paged items={preview.changes} words={words}>
              {(unit) => <ChangeUnit key={unit.unitId} unit={unit} choices={choices} setChoices={setChoices} words={words} disabled={applying} />}
            </Paged>
          </Section>
        ) : null}

        {preview.clashes.length ? (
          <Section id="clashes" refs={sections} title={t("unitSheet.sync.clashes")} hint={t("unitSheet.sync.clashesHint")} count={counts.clashes} tone="warning">
            <Paged items={preview.clashes} words={words}>
              {(unit) => (
                <li key={unit.unitId} className="rounded-lg border border-warning/40" data-testid="sheet-clash-unit" data-unit={unit.label}>
                  <UnitHead label={unit.label} row={unit.row} words={words} />
                  <ul className="divide-y divide-line">
                    {unit.fields.map((field) => (
                      <ClashField key={field.id} unitLabel={unit.label} field={field} currency={unit.currency} pick={choices.clashes.get(field.id) ?? null} onPick={(pick) => setChoices((current) => pickClash(current, field.id, pick))} words={words} disabled={applying} />
                    ))}
                  </ul>
                </li>
              )}
            </Paged>
          </Section>
        ) : null}

        {preview.newUnits.length ? (
          <Section
            id="newUnits"
            refs={sections}
            title={t("unitSheet.sync.newUnits")}
            hint={t("unitSheet.sync.newUnitsHint")}
            count={counts.newUnits}
            action={<TickAll ids={preview.newUnits.map((unit) => unit.id)} choices={choices} setChoices={setChoices} words={words} disabled={applying} />}
          >
            <Paged items={preview.newUnits} words={words}>
              {(unit) => (
                <li key={unit.id} className="rounded-lg border border-line" data-testid="sheet-new-unit" data-unit={unit.label}>
                  <label className="flex cursor-pointer items-start gap-3 px-3 py-2.5 touch:min-h-11">
                    <Checkbox
                      className="mt-0.5"
                      checked={choices.accept.has(unit.id)}
                      onCheckedChange={(value) => setChoices((current) => setTicked(current, [unit.id], value === true))}
                      disabled={applying}
                      aria-label={t("unitSheet.sync.tickNew", { code: unit.label })}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-baseline gap-x-2">
                        <span className="font-semibold text-fg">{unit.label}</span>
                        <span className="text-meta text-fg-subtle">{t("unitSheet.sync.row", { row: unit.row })}</span>
                      </span>
                      <span className="block text-table text-fg-muted">{t("unitSheet.sync.newAt", { building: unit.building.name, floor: floorName(unit.floor.name, words.locale), type: unitTypeName(unit.type.name, words.locale) })}</span>
                      {unit.fields.length || unit.price ? (
                        <span className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-meta text-fg-muted">
                          {unit.fields
                            .filter((field) => field.field !== "type" && field.value !== null)
                            .map((field) => (
                              <span key={field.field}>
                                {words.fieldLabel(field.field)} <span className="font-medium text-fg">{words.value(field.field, field.value)}</span>
                              </span>
                            ))}
                          {unit.price ? (
                            <span>
                              {words.fieldLabel("price")} <span className="font-medium text-fg">{words.value("price", unit.price.total, { price: unit.price, currency })}</span>
                            </span>
                          ) : null}
                        </span>
                      ) : null}
                    </span>
                  </label>
                </li>
              )}
            </Paged>
          </Section>
        ) : null}

        {preview.newerInNesto.length ? (
          <Section
            id="newer"
            refs={sections}
            title={t("unitSheet.sync.newer")}
            hint={t("unitSheet.sync.newerHint")}
            count={counts.newerInNesto}
            tone="info"
            action={
              <Button variant="secondary" size="sm" onClick={onDownload} data-testid="sheet-newer-download">
                <Download aria-hidden="true" />
                {t("unitSheet.download")}
              </Button>
            }
          >
            <Paged items={preview.newerInNesto} words={words}>
              {(unit) => (
                <li key={unit.unitId} className="rounded-lg border border-line" data-testid="sheet-newer-unit" data-unit={unit.label}>
                  <UnitHead label={unit.label} row={unit.row} words={words} />
                  <ul className="divide-y divide-line">
                    {unit.fields.map((field) => (
                      <li key={field.field} className="grid gap-x-4 gap-y-0.5 px-3 py-2 text-table sm:grid-cols-[minmax(0,12rem)_minmax(0,1fr)]">
                        <span className="text-fg-muted">{words.fieldLabel(field.field)}</span>
                        <span className="flex min-w-0 flex-wrap gap-x-3">
                          <span>
                            <span className="text-fg-subtle">{t("unitSheet.sync.sheet")}: </span>
                            <span className="[overflow-wrap:anywhere]">{words.value(field.field, field.sheet, { currency: unit.currency })}</span>
                          </span>
                          <span>
                            <span className="text-fg-subtle">{t("unitSheet.sync.nesto")}: </span>
                            <span className="font-medium text-fg [overflow-wrap:anywhere]">{words.value(field.field, field.nesto, { currency: unit.currency })}</span>
                          </span>
                        </span>
                      </li>
                    ))}
                  </ul>
                </li>
              )}
            </Paged>
          </Section>
        ) : null}

        {preview.skipped.length ? (
          <Section id="skipped" refs={sections} title={t("unitSheet.sync.skipped")} hint={t("unitSheet.sync.skippedHint")} count={counts.skipped} tone="danger">
            <SkippedList items={preview.skipped} words={words} />
          </Section>
        ) : null}

        {preview.notInSheet.length ? (
          <section ref={(node) => void (sections.current.notInSheet = node)} className="scroll-mt-4" data-testid="sheet-section-notInSheet">
            <details className="group rounded-lg border border-line">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-3 py-2.5 text-table font-semibold text-fg touch:min-h-11 [&::-webkit-details-marker]:hidden">
                <span>
                  {t("unitSheet.sync.notInSheet")} <span className="font-normal tabular-nums text-fg-muted">({counts.notInSheet})</span>
                </span>
                <ArrowRight className="size-4 shrink-0 text-fg-subtle transition-transform group-open:rotate-90" aria-hidden="true" />
              </summary>
              <div className="border-t border-line px-3 py-2.5">
                <p className="text-meta text-fg-muted">{t("unitSheet.sync.notInSheetHint")}</p>
                <p className="mt-1.5 text-table text-fg [overflow-wrap:anywhere]" data-testid="sheet-not-in-sheet">
                  {preview.notInSheet.map((unit) => unit.label).join(", ")}
                </p>
              </div>
            </details>
          </section>
        ) : null}

        {preview.unknownColumns.length ? (
          <p className="text-meta text-fg-muted [overflow-wrap:anywhere]" data-testid="sheet-unknown-columns">
            {t("unitSheet.sync.unknownColumns", { list: preview.unknownColumns.map((column) => (column.header ? `${column.column} “${column.header}”` : column.column)).join(", ") })}
          </p>
        ) : null}
      </div>

      {/* The footer stays in reach while the sections scroll. */}
      <div className="sticky bottom-0 -mx-6 mt-auto space-y-3 border-t border-line bg-surface/[0.97] px-6 pb-[max(1rem,var(--nesto-safe-bottom))] pt-3 backdrop-blur-[24px]">
        {preview.putOnSale.allowed && candidates > 0 ? (
          <PutOnSaleTick
            checked={choices.putOnSale}
            onChange={(checked) => setChoices((current) => ({ ...current, putOnSale: checked }))}
            label={t("unitSheet.sync.putOnSale")}
            hint={t("unitSheet.sync.putOnSaleHint", { count: candidates })}
            disabled={applying}
            testId="sheet-put-on-sale"
          />
        ) : null}
        {error ? (
          <div role="alert" className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-danger/30 bg-danger-soft px-3 py-2 text-table text-danger-strong" data-testid="sheet-apply-error">
            <span className="min-w-0 [overflow-wrap:anywhere]">{error.message}</span>
            {error.again ? (
              <Button variant="secondary" size="sm" onClick={onAgain}>
                <RefreshCw aria-hidden="true" />
                {t("unitSheet.sync.syncAgain")}
              </Button>
            ) : null}
          </div>
        ) : null}
        <div className="flex flex-wrap items-center justify-end gap-x-3 gap-y-2 max-sm:flex-col-reverse max-sm:items-stretch">
          {unpicked > 0 ? <p className="mr-auto text-meta text-fg-muted max-sm:mr-0">{t("unitSheet.sync.unpicked", { count: unpicked })}</p> : null}
          <DialogClose asChild>
            <Button variant="secondary" disabled={applying}>
              {t("unitSheet.sync.cancel")}
            </Button>
          </DialogClose>
          <Button onClick={onConfirm} loading={applying} data-testid="sheet-sync-confirm">
            {applying ? t("unitSheet.sync.applying") : chosen > 0 ? t("unitSheet.sync.apply", { count: chosen }) : t("unitSheet.sync.markSynced")}
          </Button>
        </div>
      </div>
    </>
  );
}

function Callout({ tone, children, testId }: { tone: "info" | "success"; children: React.ReactNode; testId?: string }) {
  return (
    <p className={cn("flex items-start gap-2 rounded-lg border px-3 py-2.5 text-table", tone === "info" ? "border-info/30 bg-info-soft text-info-strong" : "border-success/30 bg-success-soft text-success-strong")} data-testid={testId}>
      {tone === "success" ? <CircleCheck className="mt-0.5 size-4 shrink-0" aria-hidden="true" /> : <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />}
      <span className="min-w-0">{children}</span>
    </p>
  );
}

function Section({
  id,
  refs,
  title,
  hint,
  count,
  tone,
  action,
  children,
}: {
  id: string;
  refs: React.MutableRefObject<Record<string, HTMLElement | null>>;
  title: string;
  hint: string;
  count: number;
  tone?: "warning" | "info" | "danger";
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  const headingId = React.useId();
  return (
    <section ref={(node) => void (refs.current[id] = node)} aria-labelledby={headingId} className="scroll-mt-4 space-y-2" data-testid={`sheet-section-${id}`}>
      <div className="flex flex-wrap items-end justify-between gap-x-3 gap-y-2">
        <div className="min-w-0 flex-1 basis-64">
          <h3 id={headingId} className="flex items-center gap-2 text-table font-semibold text-fg">
            <span aria-hidden="true" className={cn("size-2 shrink-0 rounded-full", tone === "warning" ? "bg-warning" : tone === "info" ? "bg-info" : tone === "danger" ? "bg-danger" : "bg-accent")} />
            {title}
            <span className="font-normal tabular-nums text-fg-muted">({count})</span>
          </h3>
          <p className="mt-0.5 text-meta text-fg-muted">{hint}</p>
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

/** A section's units, the first `PAGE` and then "Show N more". */
function Paged<T>({ items, words, children }: { items: readonly T[]; words: SheetWords; children: (item: T) => React.ReactNode }) {
  const [shown, setShown] = React.useState(PAGE);
  const rest = items.length - shown;
  return (
    <>
      <ul className="space-y-2">{items.slice(0, shown).map(children)}</ul>
      {rest > 0 ? (
        <Button variant="ghost" size="sm" onClick={() => setShown((current) => current + PAGE * 5)}>
          {words.t("unitSheet.sync.showMore", { count: rest })}
        </Button>
      ) : null}
    </>
  );
}

function TickAll({ ids, choices, setChoices, words, disabled }: { ids: string[]; choices: SyncChoices; setChoices: React.Dispatch<React.SetStateAction<SyncChoices>>; words: SheetWords; disabled: boolean }) {
  const all = tickState(choices, ids) === true;
  return (
    <Button variant="ghost" size="sm" disabled={disabled} onClick={() => setChoices((current) => setTicked(current, ids, !all))}>
      {all ? words.t("unitSheet.sync.untickAll") : words.t("unitSheet.sync.tickAll")}
    </Button>
  );
}

function UnitHead({ label, row, words, children }: { label: string; row: number; words: SheetWords; children?: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3 rounded-t-lg border-b border-line bg-surface-muted px-3 py-2">
      {children}
      <span className="font-semibold text-fg">{label}</span>
      <span className="text-meta text-fg-subtle">{words.t("unitSheet.sync.row", { row })}</span>
    </div>
  );
}

function ChangeUnit({ unit, choices, setChoices, words, disabled }: { unit: SheetPreviewDTO["changes"][number]; choices: SyncChoices; setChoices: React.Dispatch<React.SetStateAction<SyncChoices>>; words: SheetWords; disabled: boolean }) {
  const ids = unit.fields.map((field) => field.id);
  const state = tickState(choices, ids);
  return (
    <li className="rounded-lg border border-line" data-testid="sheet-change-unit" data-unit={unit.label}>
      <UnitHead label={unit.label} row={unit.row} words={words}>
        <Checkbox checked={state} onCheckedChange={() => setChoices((current) => setTicked(current, ids, state !== true))} disabled={disabled} aria-label={words.t("unitSheet.sync.tickUnit", { code: unit.label })} />
      </UnitHead>
      <ul className="divide-y divide-line">
        {unit.fields.map((field) => {
          const label = words.fieldLabel(field.field);
          return (
            <li key={field.id}>
              <label className="grid cursor-pointer grid-cols-[auto_minmax(0,1fr)] items-start gap-x-3 gap-y-0.5 px-3 py-2 text-table touch:min-h-11 sm:grid-cols-[auto_minmax(0,12rem)_minmax(0,1fr)]" data-testid="sheet-change-field" data-field={field.field}>
                <Checkbox
                  className="mt-0.5"
                  checked={choices.accept.has(field.id)}
                  onCheckedChange={(value) => setChoices((current) => setTicked(current, [field.id], value === true))}
                  disabled={disabled}
                  aria-label={words.t("unitSheet.sync.tickField", { field: label, code: unit.label })}
                />
                <span className="text-fg-muted">{label}</span>
                <span className="col-start-2 flex min-w-0 flex-wrap items-baseline gap-x-2 sm:col-start-3">
                  <FieldValue field={field.field} value={field.from} currency={unit.currency} words={words} muted />
                  <ArrowRight className="size-3.5 shrink-0 self-center text-fg-subtle" aria-hidden="true" />
                  <FieldValue field={field.field} value={field.to} price={field.price} currency={unit.currency} words={words} />
                </span>
              </label>
            </li>
          );
        })}
      </ul>
    </li>
  );
}

function FieldValue({ field, value, price, currency, words, muted = false }: { field: SheetField; value: string | null; price?: SheetPreviewDTO["changes"][number]["fields"][number]["price"]; currency: string | null; words: SheetWords; muted?: boolean }) {
  const text = words.value(field, value, { price, currency });
  return <span className={cn("[overflow-wrap:anywhere]", value === null && "italic", muted ? "text-fg-muted" : "font-medium text-fg")}>{text}</span>;
}

function ClashField({
  unitLabel,
  field,
  currency,
  pick,
  onPick,
  words,
  disabled,
}: {
  unitLabel: string;
  field: SheetPreviewDTO["clashes"][number]["fields"][number];
  currency: string | null;
  pick: ClashPick | null;
  onPick: (pick: ClashPick | null) => void;
  words: SheetWords;
  disabled: boolean;
}) {
  const { t } = words;
  const label = words.fieldLabel(field.field);
  const name = `clash-${field.id}`;
  const statusId = React.useId();
  const option = (side: ClashPick, value: string | null) => (
    <label
      className={cn(
        "flex min-w-0 cursor-pointer items-start gap-2.5 rounded-md border px-3 py-2 touch:min-h-11",
        pick === side ? "border-accent bg-accent-soft" : "border-line hover:border-line-strong",
        disabled && "cursor-not-allowed opacity-60",
      )}
      data-testid={`sheet-clash-${side.toLowerCase()}`}
    >
      <Radio name={name} value={side} checked={pick === side} onChange={() => onPick(side)} disabled={disabled} className="mt-0.5" aria-describedby={statusId} />
      <span className="min-w-0">
        <span className="block text-meta font-medium text-fg-muted">{side === "SHEET" ? t("unitSheet.sync.sheet") : t("unitSheet.sync.nesto")}</span>
        <FieldValue field={field.field} value={value} price={side === "SHEET" ? field.price : null} currency={currency} words={words} />
      </span>
    </label>
  );
  return (
    <li className="px-3 py-2.5" data-testid="sheet-clash-field" data-field={field.field} data-pick={pick ?? ""}>
      <fieldset className="min-w-0">
        <legend className="mb-1.5 text-table text-fg-muted">
          <span aria-hidden="true">{label}</span>
          <span className="sr-only">{t("unitSheet.sync.pickFor", { field: label, code: unitLabel })}</span>
        </legend>
        <div className="grid gap-2 sm:grid-cols-2">
          {option("SHEET", field.sheet)}
          {option("NESTO", field.nesto)}
        </div>
        <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1">
          <p id={statusId} className={cn("text-meta", pick ? "text-fg" : "text-fg-muted")} aria-live="polite" data-testid="sheet-clash-status">
            {pick === "SHEET" ? t("unitSheet.sync.keptSheet") : pick === "NESTO" ? t("unitSheet.sync.keptNesto") : t("unitSheet.sync.notPicked")}
          </p>
          {/* A pick can be taken back: the clash then waits for the next sync. */}
          {pick && !disabled ? (
            <button type="button" className="text-meta font-medium text-accent-strong underline-offset-4 hover:underline touch:min-h-11" onClick={() => onPick(null)} data-testid="sheet-clash-later">
              {t("unitSheet.sync.decideLater")}
            </button>
          ) : null}
        </div>
      </fieldset>
    </li>
  );
}

/** Rows and values left out, and why: "Row 7 · T-509 · Bedrooms “7” — not a value NESTO accepts here". */
function SkippedList({ items, words }: { items: readonly SheetSkipDTO[]; words: SheetWords }) {
  const [shown, setShown] = React.useState(PAGE);
  const rest = items.length - shown;
  return (
    <>
      <ul className="divide-y divide-line rounded-lg border border-line text-table" data-testid="sheet-skipped">
        {items.slice(0, shown).map((item, index) => (
          <li key={`${item.row ?? "x"}:${item.field ?? ""}:${item.unitId ?? item.code ?? index}:${index}`} className="px-3 py-2" data-reason={item.reason} data-testid="sheet-skipped-item">
            <span className="flex flex-wrap items-baseline gap-x-2">
              {item.row !== null ? <span className="text-meta text-fg-subtle">{words.t("unitSheet.sync.row", { row: item.row })}</span> : null}
              {item.label ?? item.code ? <span className="font-medium text-fg [overflow-wrap:anywhere]">{item.label ?? item.code}</span> : null}
              {item.field ? (
                <span className="text-fg-muted">
                  {words.fieldLabel(item.field)}
                  {item.value !== null && item.value !== "" ? <span className="[overflow-wrap:anywhere]"> “{item.value}”</span> : null}
                </span>
              ) : item.value ? (
                <span className="text-fg-muted [overflow-wrap:anywhere]">“{item.value}”</span>
              ) : null}
            </span>
            <span className="block text-fg-muted">{words.reason(item)}</span>
          </li>
        ))}
      </ul>
      {rest > 0 ? (
        <Button variant="ghost" size="sm" onClick={() => setShown((current) => current + PAGE * 5)}>
          {words.t("unitSheet.sync.showMore", { count: rest })}
        </Button>
      ) : null}
    </>
  );
}

/* The result ----------------------------------------------------------------------- */

function resultSummary(result: SheetApplyResultDTO, words: SheetWords): string {
  const { t } = words;
  const changed = result.applied.units.length;
  const created = result.applied.newUnits.length;
  const moved = result.putOnSale.moved.length;
  const lines = [changed ? t("unitSheet.result.changed", { count: changed }) : null, created ? t("unitSheet.result.created", { count: created }) : null, moved ? t("unitSheet.result.onSale", { count: moved }) : null].filter(Boolean);
  return lines.length ? lines.join(" ") : t("unitSheet.result.nothing");
}

function Result({ result, words, onClose }: { result: SheetApplyResultDTO; words: SheetWords; onClose: () => void }) {
  const { t } = words;
  const changed = result.applied.units.length;
  const created = result.applied.newUnits.length;
  return (
    <div className="flex flex-1 flex-col" data-testid="sheet-sync-result">
      <p className="sr-only" role="status">
        {resultSummary(result, words)}
      </p>
      <div className="mt-4 flex-1 space-y-5 pb-6">
        {changed ? (
          <section className="space-y-1.5">
            <h3 className="text-table font-semibold text-fg">{t("unitSheet.result.changedTitle")}</h3>
            <ul className="divide-y divide-line rounded-lg border border-line text-table" data-testid="sheet-result-changed">
              {result.applied.units.map((unit) => (
                <li key={unit.unitId} className="flex flex-wrap items-baseline gap-x-2 px-3 py-2">
                  <span className="font-medium text-fg">{unit.label}</span>
                  <span className="text-fg-muted">{unit.fields.map(words.fieldLabel).join(", ")}</span>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
        {created ? (
          <section className="space-y-1.5">
            <h3 className="text-table font-semibold text-fg">{t("unitSheet.result.createdTitle")}</h3>
            <p className="text-table text-fg [overflow-wrap:anywhere]" data-testid="sheet-result-created">
              {result.applied.newUnits.map((unit) => unit.label).join(", ")}
            </p>
          </section>
        ) : null}
        {result.skipped.length ? (
          <section className="space-y-1.5">
            <h3 className="text-table font-semibold text-fg">{t("unitSheet.result.skippedTitle", { count: result.skipped.length })}</h3>
            <SkippedList items={result.skipped} words={words} />
          </section>
        ) : null}
        {result.putOnSale.skipped.length ? (
          <section className="space-y-1.5">
            <h3 className="text-table font-semibold text-fg">{t("unitSheet.result.stayedOffTitle", { count: result.putOnSale.skipped.length })}</h3>
            <SkippedList items={result.putOnSale.skipped} words={words} />
          </section>
        ) : null}
      </div>
      <div className="sticky bottom-0 -mx-6 mt-auto flex justify-end border-t border-line bg-surface/[0.97] px-6 pb-[max(1rem,var(--nesto-safe-bottom))] pt-3 backdrop-blur-[24px] max-sm:flex-col">
        <Button onClick={onClose} data-testid="sheet-result-close">
          {t("unitSheet.result.close")}
        </Button>
      </div>
    </div>
  );
}
