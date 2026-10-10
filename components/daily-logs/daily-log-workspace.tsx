"use client";

import * as React from "react";
import Link from "@/components/navigation/nav-link";
import { useRouter } from "@/components/navigation/guarded-router";
import {
  AlertTriangle,
  Ban,
  Check,
  ChevronDown,
  CloudSun,
  FileCheck2,
  HardHat,
  Link2,
  ListChecks,
  Lock,
  MessageSquareWarning,
  MoreHorizontal,
  NotebookPen,
  Pencil,
  Plus,
  Printer,
  RotateCcw,
  Send,
  ShieldCheck,
  Truck,
  Users,
  Wrench,
  X,
} from "lucide-react";

import { selectClass } from "@/components/forms/record-form";
import { PersonLink } from "@/components/people/person-link";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/toast";
import { belowQuery } from "@/components/ui/use-breakpoint";
import { useUnsavedEditor } from "@/components/unsaved/use-unsaved";
import type { SaveOutcome } from "@/lib/unsaved/coordinator";
import { OUTCOME_COPY } from "@/lib/unsaved/outcome";
import { dateLabel, formatDuration, longDateLabel } from "@/lib/modules/daily-logs/daily-log.time";
import {
  DELAY_CATEGORY_LABELS,
  DELAY_IMPACT_LABELS,
  EQUIPMENT_STATUS_LABELS,
  SECTION_KEYS,
  SECTION_LABELS,
  SITE_CONDITION_LABELS,
  SITE_CONDITIONS,
  TASK_LINK_TYPE_LABELS,
  WEATHER_CONDITION_LABELS,
  type DailyLogDetailDTO,
  type SectionKey,
} from "@/lib/modules/daily-logs/daily-log.types";
import { cn } from "@/lib/utils/cn";
import { dailyLogApi, dailyLogFailureOutcome, failureMessage, isFailure } from "./daily-log-api";
import { CorrectedBadge, DailyLogStatusBadge, LateEntryBadge, Stat } from "./daily-log-ui";
import { EntryDialog, type EntryOptions } from "./entry-dialog";
import { entriesOf, payloadFromValues, valuesFromEntry } from "./entry-fields";
import { EvidenceGallery } from "./evidence-gallery";
import { WorkforceSuggestions } from "./workforce-suggestions";
import { planFocusAfterRemoval } from "@/components/modules/focus-after-removal";
import { dailyLogsLabel } from "@/lib/i18n/modules/dailyLogs/labels";
import { DailyLogsText, useDailyLogsTranslations } from "./daily-logs-text";
import { FormSelect } from "@/components/ui/form-select";

/**
 * The daily log workspace (PRD #43 §145-§160, §201, §214-§221).
 *
 * A field workspace rather than one long form: a sticky section rail, sections
 * that show what was recorded and open a short form to add or change one
 * entry, the day's numbers beside them, and the evidence gallery. Every change
 * saves on its own. Once submitted the log reads as a record, with the
 * reviewer's actions; once locked it is the official record, and corrections
 * appear beside it rather than inside it.
 */

type Rail = "overview" | SectionKey | "qaqc" | "evidence" | "tasks" | "history";

const SECTION_ICON: Record<SectionKey, typeof Users> = {
  weather: CloudSun,
  workforce: Users,
  activities: HardHat,
  equipment: Wrench,
  deliveries: Truck,
  visitors: Users,
  delays: AlertTriangle,
  instructions: MessageSquareWarning,
};

/**
 * Whether the entry editor opens as a bottom sheet: read once, when it opens
 * (AUD-04 §3, MW-16, SP-15). The choice then holds until it closes, so turning
 * the phone or resizing across 768px while typing never swaps the sheet for a
 * dialog underneath the person. Nothing else here needs a breakpoint in
 * JavaScript: collapsed sections and the sticky bar are CSS.
 */
const opensAsSheet = () => typeof window !== "undefined" && window.matchMedia(belowQuery("md")).matches;

function EntryLine({ primary, secondary, meta, onEdit, testId }: { primary: React.ReactNode; secondary?: React.ReactNode; meta?: React.ReactNode; onEdit?: () => void; testId: string }) {
  // The edit control names its entry, not just "Edit entry" (AUD-04 §5, J-D4).
  const t = useDailyLogsTranslations();
  const name = typeof primary === "string" && primary ? primary : null;
  return (
    <li className="flex items-start gap-3 py-2.5" data-testid={testId}>
      <span className="min-w-0 flex-1">
        <span className="block break-words text-table font-medium text-fg">{primary}</span>
        {secondary ? <span className="block break-words text-meta text-fg-muted">{secondary}</span> : null}
      </span>
      {meta ? <span className="shrink-0 text-table tabular-nums text-fg">{meta}</span> : null}
      {onEdit ? (
        <Button type="button" variant="ghost" size="icon-sm" onClick={onEdit} aria-label={name ? t("workspace.editNamed", { name }) : t("workspace.editEntry")}>
          <Pencil />
        </Button>
      ) : null}
    </li>
  );
}

const joined = (...parts: Array<string | number | null | undefined | false>) => parts.filter((part) => part !== null && part !== undefined && part !== false && part !== "").join(" · ");

/** `joined` for a line that names a person as a link; null when nothing is left. */
const joinedNodes = (...parts: React.ReactNode[]) => {
  const kept = parts.filter((part) => part !== null && part !== undefined && part !== false && part !== "");
  return kept.length ? kept.map((part, index) => <React.Fragment key={index}>{index ? " · " : null}{part}</React.Fragment>) : null;
};

export function DailyLogWorkspace({ initial, discussion, zone, favorite }: { initial: DailyLogDetailDTO; discussion: React.ReactNode; zone: string; favorite?: React.ReactNode }) {
  const router = useRouter();
  const toast = useToast();
  const t = useDailyLogsTranslations();
  const L = (group: Parameters<typeof dailyLogsLabel>[1], value: string, fallback: string) => dailyLogsLabel(t, group, value, fallback);
  const sectionLabel = (key: SectionKey) => L("section", key, SECTION_LABELS[key]);
  const failed = (error: unknown, label?: string) => failureMessage(error, label ? t("common.failed", { label }) : t("common.somethingWrong"));
  const [log, setLog] = React.useState(initial);
  const [options, setOptions] = React.useState<EntryOptions | null>(null);
  const [dialog, setDialog] = React.useState<{ section: SectionKey; entryId?: string } | null>(null);
  // Kept after the editor closes too, so its closing animation is the one it opened with.
  const [sheet, setSheet] = React.useState(false);
  const [saving, setSaving] = React.useState<"idle" | "saving" | "saved" | "error">("idle");
  const [open, setOpen] = React.useState<Record<string, boolean>>({});
  const [action, setAction] = React.useState<"return" | "void" | "correction" | "task" | "link-task" | "link-record" | null>(null);
  const [pending, setPending] = React.useState(false);
  const caps = log.capabilities;
  const editable = caps.canEdit;
  const base = `/api/daily-logs/${log.id}`;

  React.useEffect(() => setLog(initial), [initial]);

  // The overview saves as it goes (on blur, on change): while one is on its
  // way, or never got an answer, leaving would lose it (AUD-03 §3). Each text
  // field reports what is typed but not yet sent itself.
  const overviewEditor = useUnsavedEditor({ module: "daily_logs", saveKind: "none", label: t("workspace.overviewEditor") });
  const overviewSaves = React.useRef(0);

  const refresh = React.useCallback(async () => {
    const next = await dailyLogApi<DailyLogDetailDTO>(base);
    setLog(next);
    return next;
  }, [base]);

  const loadOptions = React.useCallback(async () => {
    if (options) return options;
    const data = await dailyLogApi<EntryOptions>(`${base}/options`);
    setOptions(data);
    return data;
  }, [base, options]);

  // One step at a time: a second tap before the first re-render is not a second request (AUD-04 §6, MW-15).
  const stepping = React.useRef(false);

  /** A step that changes the log, answering what happened to it (AUD-03 §6). */
  async function perform(label: string, work: () => Promise<unknown>, success?: string): Promise<SaveOutcome> {
    if (stepping.current) return { kind: "unknown" };
    stepping.current = true;
    setPending(true);
    try {
      await work();
    } catch (error) {
      const outcome = dailyLogFailureOutcome(error);
      // No answer is not a refusal: the step may have happened. Never "try
      // again" blindly — show the log as it now stands (AUD-03 §6, AUD-04 §6).
      toast({ title: failed(error, label), description: outcome.kind === "unknown" ? OUTCOME_COPY.unknown : undefined, tone: "danger" });
      if (outcome.kind === "unknown" || (isFailure(error) && (error.status === 409 || error.detailCode === "DAILY_LOG_STALE"))) void refresh().catch(() => undefined);
      stepping.current = false;
      setPending(false);
      return outcome;
    }
    // The step went through; reading the log back is not part of it.
    try {
      await refresh();
    } catch {
      // The page refresh below brings it.
    }
    if (success) toast({ title: success, tone: "success" });
    router.refresh();
    stepping.current = false;
    setPending(false);
    return { kind: "committed" };
  }

  async function run(label: string, work: () => Promise<unknown>, success?: string) {
    return (await perform(label, work, success)).kind === "committed";
  }

  async function openEntry(section: SectionKey, entryId?: string) {
    setSheet(opensAsSheet());
    setDialog({ section, entryId });
    void loadOptions().catch(() => undefined);
  }

  const dialogEntry = dialog?.entryId ? entriesOf(log, dialog.section).find((entry) => entry.id === dialog.entryId) : undefined;

  async function saveEntry(values: Record<string, unknown>) {
    if (!dialog) return;
    // A crew's entry keeps its crew when edited: the form does not show it (E-04 §43).
    const crew = dialog.section === "workforce" && dialogEntry ? { crewId: (dialogEntry as { crewId?: string | null }).crewId ?? null } : {};
    const body = { ...payloadFromValues(dialog.section, values), ...crew, ...(dialogEntry ? { updatedAt: dialogEntry.updatedAt } : {}) };
    setSaving("saving");
    try {
      if (dialogEntry) await dailyLogApi(`${base}/${dialog.section}/${dialogEntry.id}`, { method: "PATCH", body });
      else await dailyLogApi(`${base}/${dialog.section}`, { body });
    } catch (error) {
      setSaving("error");
      throw error;
    }
    // Saved. Reading the log back is not part of the save: if it fails, the
    // entry is still saved and only the read is tried again — never the create
    // (AUD-07 §7, PS-16).
    setSaving("saved");
    await refreshAfterCommit();
  }

  async function removeEntry() {
    if (!dialog || !dialogEntry) return;
    await dailyLogApi(`${base}/${dialog.section}/${dialogEntry.id}`, { method: "DELETE" });
    await refreshAfterCommit();
  }

  /** After a committed change: the read, and on its failure the page's own refresh — never the change again. */
  async function refreshAfterCommit() {
    try {
      await refresh();
    } catch {
      toast({ title: t("common.saved"), description: t("workspace.savedRefreshing"), tone: "warning" });
      router.refresh();
    }
  }

  async function saveOverview(field: string, value: string | null): Promise<SaveOutcome> {
    if (!editable) return { kind: "refused" };
    const current = (log as unknown as Record<string, unknown>)[field];
    if ((current ?? null) === (value || null)) return { kind: "committed" };
    setSaving("saving");
    overviewSaves.current += 1;
    overviewEditor.setSaving(true);
    try {
      const body = {
        expectedVersion: log.version,
        summary: log.summary,
        generalNotes: log.generalNotes,
        delaySummary: log.delaySummary,
        instructionSummary: log.instructionSummary,
        weatherSummary: log.weatherSummary,
        siteCondition: log.siteCondition,
        siteConditionNotes: log.siteConditionNotes,
        [field]: value || null,
      };
      await dailyLogApi(base, { method: "PATCH", body });
      overviewEditor.setUnresolved(false);
      await refresh().catch(() => undefined);
      setSaving("saved");
      return { kind: "committed" };
    } catch (error) {
      const outcome = dailyLogFailureOutcome(error);
      overviewEditor.setUnresolved(outcome.kind === "unknown");
      setSaving("error");
      toast({ title: failed(error), tone: "danger" });
      if (isFailure(error) && error.status === 409) void refresh();
      return outcome;
    } finally {
      overviewSaves.current -= 1;
      if (overviewSaves.current === 0) overviewEditor.setSaving(false);
    }
  }

  const transition = (path: string, label: string, success: string) => run(label, () => dailyLogApi(`${base}/${path}`, { body: { expectedVersion: log.version } }), success);

  const issueCount = log.issues.length;
  const rail: Array<{ key: Rail; label: string; count?: number }> = [
    { key: "overview", label: t("workspace.overview") },
    ...SECTION_KEYS.map((key) => ({ key, label: sectionLabel(key), count: entriesOf(log, key).length })),
    { key: "qaqc", label: t("workspace.qaqcHse"), count: log.records.length },
    { key: "evidence", label: t("workspace.evidence"), count: log.counts.photos + (log.counts.documents - log.counts.photos) },
    { key: "tasks", label: t("workspace.tasks"), count: log.tasks.length },
    { key: "history", label: t("workspace.history") },
  ];
  const toggle = (key: string) => setOpen((current) => ({ ...current, [key]: !current[key] }));

  /*
   * Sections fold on a phone and are always open from md (PRD #43 §150). The
   * fold is CSS, not a JavaScript breakpoint (AUD-04 §3, §8, SP-15, D-08-07):
   * the first paint is already right for the width — no expanded-then-collapsed
   * jump after hydration — and crossing 768px keeps every section's contents
   * and whatever is typed in them. The toggle is a phone-only control laid
   * over the header, so a desktop reader never meets a "collapsed" section
   * they can see.
   */
  const sectionShell = (key: Rail, title: string, icon: React.ReactNode, body: React.ReactNode, actions?: React.ReactNode, count?: number) => (
    <section id={`section-${key}`} aria-labelledby={`title-${key}`} className="nesto-card scroll-mt-24 px-4 py-3 sm:px-5 sm:py-4" data-testid={`section-${key}`}>
      <header className="relative flex min-h-11 items-center gap-2 md:min-h-0">
        <span className="text-fg-subtle" aria-hidden="true">
          {icon}
        </span>
        <h2 id={`title-${key}`} className="min-w-0 text-card font-semibold text-fg">
          {title}
        </h2>
        {count !== undefined ? <span className="rounded-full bg-hover px-1.5 text-micro font-medium tabular-nums text-fg-muted">{count}</span> : null}
        <span className="flex-1" />
        <ChevronDown className={cn("size-4 text-fg-subtle transition-transform motion-reduce:transition-none md:hidden", open[key] && "rotate-180")} aria-hidden="true" />
        <button type="button" className="absolute inset-0 rounded-md md:hidden" onClick={() => toggle(key)} aria-expanded={Boolean(open[key])} aria-controls={`body-${key}`} aria-labelledby={`title-${key}`} />
        {actions ? <div className="relative flex items-center gap-1">{actions}</div> : null}
      </header>
      <div id={`body-${key}`} className={cn("mt-2", !open[key] && "hidden md:block")}>
        {body}
      </div>
    </section>
  );

  const addButton = (section: SectionKey) =>
    caps.sections[section] ? (
      <Button type="button" variant="ghost" size="sm" onClick={() => void openEntry(section)} aria-label={t("workspace.addSection", { section: sectionLabel(section).toLowerCase() })}>
        <Plus aria-hidden="true" /> <span className="hidden sm:inline">{t("common.add")}</span>
      </Button>
    ) : null;

  const empty = (text: string) => <p className="py-2 text-table text-fg-subtle">{text}</p>;

  const sections: Record<SectionKey, React.ReactNode> = {
    weather: log.weather.length ? (
      <ul className="divide-y divide-line">
        {log.weather.map((entry) => (
          <EntryLine key={entry.id} testId="weather-entry" primary={joined(entry.observedAt, entry.condition ? L("weather", entry.condition, WEATHER_CONDITION_LABELS[entry.condition]) : null)} secondary={joined(entry.precipitationMm !== null && t("workspace.line.rain", { value: entry.precipitationMm }), entry.windKph !== null && t("workspace.line.wind", { value: entry.windKph }), entry.humidityPct !== null && t("workspace.line.humidity", { value: entry.humidityPct }), entry.notes)} meta={entry.temperatureC !== null ? `${entry.temperatureC} °C` : undefined} onEdit={caps.sections.weather ? () => void openEntry("weather", entry.id) : undefined} />
        ))}
      </ul>
    ) : empty(t("workspace.empty.weather")),
    workforce: log.workforce.length ? (
      <ul className="divide-y divide-line">
        {log.workforce.map((entry) => (
          <EntryLine key={entry.id} testId="workforce-entry" primary={entry.organizationName} secondary={joined(entry.trade, entry.crewName, entry.contractor ? t("workspace.line.contractor", { label: entry.contractor.label }) : null, entry.workPackage?.label, entry.supplier ? t("workspace.line.supplier", { label: entry.supplier.label }) : null, entry.notes)} meta={`${entry.headcount}`} onEdit={caps.sections.workforce ? () => void openEntry("workforce", entry.id) : undefined} />
        ))}
        <li className="flex justify-between pt-2.5 text-table font-medium text-fg">
          <span>{t("workspace.onSite")}</span>
          <span className="tabular-nums" data-testid="workforce-total">{log.counts.workforce}</span>
        </li>
      </ul>
    ) : empty(t("workspace.empty.workforce")),
    activities: log.activities.length ? (
      <ul className="divide-y divide-line">
        {log.activities.map((entry) => (
          <EntryLine key={entry.id} testId="activity-entry" primary={entry.title} secondary={joined(entry.projectArea, entry.floorZone, entry.trade, entry.contractor ? t("workspace.line.contractor", { label: entry.contractor.label }) : null, entry.workPackage?.label, entry.task ? t("workspace.line.task", { label: entry.task.label }) : null, entry.description)} meta={entry.progressPercent !== null ? `${entry.progressPercent}%` : undefined} onEdit={caps.sections.activities ? () => void openEntry("activities", entry.id) : undefined} />
        ))}
      </ul>
    ) : empty(t("workspace.empty.activities")),
    equipment: log.equipment.length ? (
      <ul className="divide-y divide-line">
        {log.equipment.map((entry) => (
          <EntryLine key={entry.id} testId="equipment-entry" primary={joined(entry.equipmentName, entry.equipmentCode)} secondary={joined(entry.status ? L("equipment", entry.status, EQUIPMENT_STATUS_LABELS[entry.status]) : null, entry.hoursUsed !== null && `${entry.hoursUsed} h`, entry.supplier?.label, entry.notes)} meta={`× ${entry.quantity}`} onEdit={caps.sections.equipment ? () => void openEntry("equipment", entry.id) : undefined} />
        ))}
      </ul>
    ) : empty(t("workspace.empty.equipment")),
    deliveries: log.deliveries.length ? (
      <ul className="divide-y divide-line">
        {log.deliveries.map((entry) => (
          <EntryLine
            key={entry.id}
            testId="delivery-entry"
            primary={entry.description}
            secondary={
              <>
                {joined(entry.supplier?.label, entry.deliveredTime && t("workspace.line.arrived", { time: entry.deliveredTime }), entry.outsideWorkDate && entry.deliveredDate ? t("workspace.line.on", { date: dateLabel(entry.deliveredDate) }) : null, entry.conditionNote)}
                {[entry.purchaseOrder, entry.goodsReceipt, entry.inventoryReceipt].filter(Boolean).map((ref) =>
                  ref!.href ? (
                    <Link key={ref!.id} href={ref!.href} className="ml-2 text-accent-strong hover:underline">
                      {ref!.label}
                    </Link>
                  ) : (
                    <span key={ref!.id} className="ml-2">{ref!.label}</span>
                  ),
                )}
              </>
            }
            meta={entry.quantityText ?? undefined}
            onEdit={caps.sections.deliveries ? () => void openEntry("deliveries", entry.id) : undefined}
          />
        ))}
      </ul>
    ) : empty(t("workspace.empty.deliveries")),
    visitors: log.visitors.length ? (
      <ul className="divide-y divide-line">
        {log.visitors.map((entry) => (
          <EntryLine key={entry.id} testId="visitor-entry" primary={joined(entry.name, entry.organization)} secondary={joinedNodes(entry.purpose, entry.escortedBy && <>{t("workspace.line.escortedBy")} <PersonLink memberId={entry.escortedBy.memberId} name={entry.escortedBy.name} /></>, entry.notes)} meta={entry.arrivedAt ? `${entry.arrivedAt}${entry.departedAt ? `–${entry.departedAt}` : ""}` : undefined} onEdit={caps.sections.visitors ? () => void openEntry("visitors", entry.id) : undefined} />
        ))}
      </ul>
    ) : empty(t("workspace.empty.visitors")),
    delays: log.delays.length ? (
      <ul className="divide-y divide-line">
        {log.delays.map((entry) => (
          <EntryLine key={entry.id} testId="delay-entry" primary={entry.title} secondary={joined(L("delayCategory", entry.category, DELAY_CATEGORY_LABELS[entry.category]), entry.impact && t("workspace.line.impact", { impact: L("delayImpact", entry.impact, DELAY_IMPACT_LABELS[entry.impact]) }), entry.startedAt && `${entry.startedAt}–${entry.endedAt ?? "…"}`, entry.responsiblePartyText, entry.task ? t("workspace.line.task", { label: entry.task.label }) : null)} meta={entry.durationMinutes ? formatDuration(entry.durationMinutes) : undefined} onEdit={caps.sections.delays ? () => void openEntry("delays", entry.id) : undefined} />
        ))}
      </ul>
    ) : empty(t("workspace.empty.delays")),
    instructions: log.instructions.length ? (
      <ul className="divide-y divide-line">
        {log.instructions.map((entry) => (
          <EntryLine key={entry.id} testId="instruction-entry" primary={entry.title} secondary={joinedNodes(entry.issuedByText ?? (entry.issuedBy && <PersonLink memberId={entry.issuedBy.memberId} name={entry.issuedBy.name} />), entry.recipientText && t("workspace.line.to", { recipient: entry.recipientText }), entry.issuedAt, entry.requiresAction && t("workspace.line.requiresAction"), entry.task ? t("workspace.line.task", { label: entry.task.label }) : null, entry.description)} onEdit={caps.sections.instructions ? () => void openEntry("instructions", entry.id) : undefined} />
        ))}
      </ul>
    ) : empty(t("workspace.empty.instructions")),
  };

  const statusBanner = () => {
    if (log.status === "CORRECTION_REQUIRED") {
      return (
        <div className="rounded-xl border border-warning/30 bg-warning-soft px-4 py-3 text-table text-fg" role="status" data-testid="daily-log-banner">
          <p className="font-medium">{t("workspace.banner.returned")}</p>
          {log.returnReason ? <p className="mt-1 whitespace-pre-line text-fg-muted">“{log.returnReason}”</p> : null}
        </div>
      );
    }
    if (log.status === "SUBMITTED") {
      return (
        <div className="rounded-xl border border-info/30 bg-info-soft px-4 py-3 text-table text-fg" role="status" data-testid="daily-log-banner">
          {t("workspace.banner.submitted")}{log.submittedBy ? <> {t("workspace.banner.by")} <PersonLink memberId={log.submittedBy.memberId} name={log.submittedBy.name} /></> : null}
          {log.reviewer ? <>{t("workspace.banner.waitingFor")} <PersonLink memberId={log.reviewer.memberId} name={log.reviewer.name} />{t("workspace.banner.review")}</> : null}{t("workspace.banner.cannotChange")}
        </div>
      );
    }
    if (log.status === "LOCKED") {
      return (
        <div className="rounded-xl border border-success/30 bg-success-soft px-4 py-3 text-table text-fg" role="status" data-testid="daily-log-banner">
          <p className="flex items-center gap-2 font-medium">
            <Lock className="size-4 text-success-strong" aria-hidden="true" /> {t("workspace.banner.official")}{log.lockedBy ? <>{t("workspace.banner.lockedBy")} <PersonLink memberId={log.lockedBy.memberId} name={log.lockedBy.name} /></> : null}.
          </p>
          {log.corrections.map((correction) => (
            <div key={correction.id} className="mt-2 border-t border-success/20 pt-2" data-testid="daily-log-correction">
              <p className="font-medium">{t("workspace.banner.correctionAdded", { date: dateLabel(correction.createdAt.slice(0, 10)) })}{correction.createdBy ? <> {t("workspace.banner.by")} <PersonLink memberId={correction.createdBy.memberId} name={correction.createdBy.name} /></> : null}</p>
              <p className="whitespace-pre-line text-fg">{correction.correctionSummary}</p>
              <p className="text-meta text-fg-muted">{t("workspace.banner.reason", { reason: correction.reason })}</p>
            </div>
          ))}
        </div>
      );
    }
    if (log.status === "VOID") {
      return (
        <div className="rounded-xl border border-line bg-surface-muted px-4 py-3 text-table text-fg-muted" role="status" data-testid="daily-log-banner">
          <p className="font-medium text-fg">{t("workspace.banner.voided")}</p>
          {log.voidReason ? <p className="mt-1">“{log.voidReason}”</p> : null}
        </div>
      );
    }
    if (log.status === "REVIEWED") {
      return (
        <div className="rounded-xl border border-success/30 bg-success-soft px-4 py-3 text-table text-fg" role="status" data-testid="daily-log-banner">
          {t("workspace.banner.reviewed")}{log.reviewedBy ? <> {t("workspace.banner.by")} <PersonLink memberId={log.reviewedBy.memberId} name={log.reviewedBy.name} /></> : null}{t("workspace.banner.lockIt")}
        </div>
      );
    }
    return null;
  };

  const primaryActions = (
    <>
      {caps.canSubmit ? (
        <Button type="button" size="sm" disabled={pending} onClick={() => void transition("submit", t("workspace.actions.submitting"), t("workspace.actions.submitted"))}>
          <Send aria-hidden="true" /> {t("workspace.actions.submit")}
        </Button>
      ) : null}
      {caps.canReview ? (
        <Button type="button" size="sm" disabled={pending} onClick={() => void transition("review", t("workspace.actions.reviewing"), t("workspace.actions.reviewed"))}>
          <FileCheck2 aria-hidden="true" /> {t("workspace.actions.markReviewed")}
        </Button>
      ) : null}
      {caps.canReturn ? (
        <Button type="button" size="sm" variant="secondary" disabled={pending} onClick={() => setAction("return")}>
          <RotateCcw aria-hidden="true" /> {t("workspace.actions.return")}
        </Button>
      ) : null}
      {caps.canLock ? (
        <Button type="button" size="sm" disabled={pending} onClick={() => void transition("lock", t("workspace.actions.locking"), t("workspace.actions.locked"))}>
          <Lock aria-hidden="true" /> {t("workspace.actions.lock")}
        </Button>
      ) : null}
      {caps.canCorrect ? (
        <Button type="button" size="sm" variant="secondary" disabled={pending} onClick={() => setAction("correction")}>
          <Pencil aria-hidden="true" /> {t("workspace.actions.addCorrection")}
        </Button>
      ) : null}
    </>
  );

  /*
   * The phone's sticky bar (PRD #43 §151, §154; AUD-04 §4, §7, MW-14): every
   * step the header offers from md is reachable here too — the first step in
   * the bar, the rest (Return, Add correction, a second step) in its labelled
   * More menu. It renders for anyone with a step to take, and the page keeps
   * room for it whenever it renders, so it never covers the last section
   * (J-D1, J-D2, D-08-05, D-08-06).
   */
  const steps: Array<{ key: string; label: string; run: () => void; variant?: "secondary" }> = [
    ...(caps.canSubmit ? [{ key: "submit", label: t("workspace.actions.submitLog"), run: () => void transition("submit", t("workspace.actions.submitting"), t("workspace.actions.submitted")) }] : []),
    ...(caps.canReview ? [{ key: "review", label: t("workspace.actions.markReviewed"), run: () => void transition("review", t("workspace.actions.reviewing"), t("workspace.actions.reviewed")) }] : []),
    ...(caps.canLock ? [{ key: "lock", label: t("workspace.actions.lock"), run: () => void transition("lock", t("workspace.actions.locking"), t("workspace.actions.locked")) }] : []),
    ...(caps.canReturn ? [{ key: "return", label: t("workspace.actions.returnForCorrection"), run: () => setAction("return"), variant: "secondary" as const }] : []),
    ...(caps.canCorrect ? [{ key: "correction", label: t("workspace.actions.addCorrection"), run: () => setAction("correction"), variant: "secondary" as const }] : []),
  ];
  // The first forward step is the bar's own button; Return and Add correction are never it when a forward step exists.
  const barStep = steps.find((step) => !step.variant) ?? (editable ? undefined : steps[0]);
  const moreSteps = steps.filter((step) => step !== barStep);
  const stickyBar = editable || steps.length > 0;
  /*
   * A dialog chosen from a bar menu opens once the menu has finished closing
   * (as task actions do since AUD-03): a menu still animating out would take
   * the dialog's first Escape, and its focus return would pull focus off it.
   */
  const afterMenu = React.useRef<(() => void) | null>(null);
  const openAfterMenu = (event: Event) => {
    const chosen = afterMenu.current;
    if (!chosen) return;
    afterMenu.current = null;
    event.preventDefault();
    chosen();
  };

  return (
    <div className={cn("space-y-4", stickyBar && "pb-[calc(6rem_+_env(safe-area-inset-bottom))] md:pb-0")} data-testid="daily-log-workspace">
      {/* Header (§146) */}
      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-meta text-fg-muted">
            <Link href={`/projects/${log.project.id}/daily-logs`} className="hover:text-accent-strong">
              {log.project.name}
            </Link>{" "}
            · {t("workspace.dailyLog")}
          </p>
          <h1 className="text-page font-semibold text-fg" data-testid="daily-log-date">
            {longDateLabel(log.workDate)}
          </h1>
          <div className="mt-1.5 flex flex-wrap items-center gap-2">
            <DailyLogStatusBadge status={log.status} />
            {log.lateEntry ? <LateEntryBadge /> : null}
            {log.corrections.length ? <CorrectedBadge /> : null}
            <span className="text-meta text-fg-muted" aria-live="polite" data-testid="save-indicator">
              {saving === "saving" ? t("common.saving") : saving === "saved" ? t("common.saved") : saving === "error" ? t("common.notSaved") : null}
            </span>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {editable ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button type="button" size="sm" variant="secondary" className="hidden md:inline-flex">
                  <Plus aria-hidden="true" /> {t("common.add")}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {SECTION_KEYS.filter((key) => caps.sections[key]).map((key) => (
                  <DropdownMenuItem key={key} onSelect={() => void openEntry(key)}>
                    {sectionLabel(key)}
                  </DropdownMenuItem>
                ))}
                {caps.canCreateTask ? <DropdownMenuItem onSelect={() => setAction("task")}>{t("workspace.task")}</DropdownMenuItem> : null}
              </DropdownMenuContent>
            </DropdownMenu>
          ) : null}
          <div className="hidden items-center gap-2 md:flex">{primaryActions}</div>
          {favorite}
          <Button asChild size="sm" variant="ghost">
            <Link href={`/projects/${log.project.id}/daily-logs/${log.id}/print`} aria-label={t("workspace.print")}>
              <Printer aria-hidden="true" />
            </Link>
          </Button>
          {caps.canVoid ? (
            <Button type="button" size="sm" variant="ghost" className="text-danger-strong hover:text-danger-strong" onClick={() => setAction("void")} aria-label={t("workspace.voidLog")}>
              <Ban aria-hidden="true" />
            </Button>
          ) : null}
        </div>
      </div>

      {statusBanner()}

      {editable && issueCount ? (
        <div className="rounded-xl border border-warning/30 bg-warning-soft px-4 py-3 text-table" role="status" data-testid="daily-log-issues">
          <p className="font-medium text-fg">{t("workspace.issues", { count: issueCount })}</p>
          <ul className="mt-1 list-disc pl-5 text-fg-muted">
            {log.issues.map((issue, index) => (
              <li key={index}>{issue.message}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {/* Summary cards (§146, §153) */}
      <div className="grid grid-cols-3 gap-2 sm:grid-cols-6" role="group" aria-label={t("workspace.summary")}>
        <Stat label={t("workspace.stat.workforce")} value={log.counts.workforce} testId="count-workforce" />
        <Stat label={t("workspace.stat.activities")} value={log.counts.activities} />
        <Stat label={t("workspace.stat.deliveries")} value={log.counts.deliveries} />
        <Stat label={t("workspace.stat.delays")} value={log.counts.delays} />
        <Stat label={t("workspace.stat.qaqcHse")} value={`${log.counts.qaqc} · ${log.counts.hse}`} />
        <Stat label={t("workspace.stat.photos")} value={log.counts.photos} testId="count-photos" />
      </div>

      <div className="grid gap-4 md:grid-cols-[11rem_minmax(0,1fr)]">
        {/* Section rail (§147) */}
        <nav aria-label={t("workspace.sections")} className="hidden md:block">
          <ul className="sticky top-20 space-y-0.5">
            {rail.map((item) => (
              <li key={item.key}>
                <a href={`#section-${item.key}`} className="flex items-center justify-between rounded-md px-2.5 py-1.5 text-table text-fg-muted hover:bg-hover hover:text-fg">
                  <span>{item.label}</span>
                  {item.count ? <span className="text-micro tabular-nums text-fg-subtle">{item.count}</span> : null}
                </a>
              </li>
            ))}
          </ul>
        </nav>

        <div className="min-w-0 space-y-3">
          {sectionShell(
            "overview",
            t("workspace.overview"),
            <NotebookPen className="size-4" />,
            <div className="grid gap-3 sm:grid-cols-2">
              <OverviewField label={t("workspace.field.summary")} value={log.summary} editable={editable} wide onSave={(value) => saveOverview("summary", value)} testId="overview-summary" />
              <OverviewField label={t("workspace.field.weatherSummary")} value={log.weatherSummary} editable={editable} onSave={(value) => saveOverview("weatherSummary", value)} />
              <div>
                <label htmlFor="site-condition" className="text-table font-medium text-fg">
                  {t("workspace.field.siteCondition")}
                </label>
                {editable ? (
                  <FormSelect id="site-condition" className={cn(selectClass, "mt-1.5")} value={log.siteCondition ?? ""} onChange={(event) => void saveOverview("siteCondition", event.target.value)}>
                    <option value="">{t("workspace.field.notRecorded")}</option>
                    {SITE_CONDITIONS.map((condition) => (
                      <option key={condition} value={condition}>
                        {L("site", condition, SITE_CONDITION_LABELS[condition])}
                      </option>
                    ))}
                  </FormSelect>
                ) : (
                  <p className="mt-1 text-table text-fg">{log.siteCondition ? L("site", log.siteCondition, SITE_CONDITION_LABELS[log.siteCondition]) : "—"}</p>
                )}
              </div>
              <OverviewField label={t("workspace.field.siteConditionNotes")} value={log.siteConditionNotes} editable={editable} onSave={(value) => saveOverview("siteConditionNotes", value)} />
              <OverviewField label={t("workspace.field.delaySummary")} value={log.delaySummary} editable={editable} onSave={(value) => saveOverview("delaySummary", value)} />
              <OverviewField label={t("workspace.field.instructionSummary")} value={log.instructionSummary} editable={editable} onSave={(value) => saveOverview("instructionSummary", value)} />
              <OverviewField label={t("workspace.field.generalNotes")} value={log.generalNotes} editable={editable} wide onSave={(value) => saveOverview("generalNotes", value)} />
              <p className="text-meta text-fg-muted sm:col-span-2">{joinedNodes(log.createdBy && <>{t("workspace.field.startedBy")} <PersonLink memberId={log.createdBy.memberId} name={log.createdBy.name} /></>, log.reviewer && <>{t("workspace.field.reviewer")} <PersonLink memberId={log.reviewer.memberId} name={log.reviewer.name} /></>)}</p>
            </div>,
          )}

          {SECTION_KEYS.map((key) => {
            const Icon = SECTION_ICON[key];
            // The workforce section also offers the project's own crews for that day (E-04 §182).
            const actions =
              key === "workforce" && caps.sections.workforce ? (
                <>
                  <WorkforceSuggestions base={base} onApplied={async (added) => void (await run(t("workspace.actions.addingLabel"), async () => null, added ? t("workspace.actions.entriesAdded", { count: added }) : undefined))} />
                  {addButton(key)}
                </>
              ) : (
                addButton(key)
              );
            return <React.Fragment key={key}>{sectionShell(key, sectionLabel(key), <Icon className="size-4" />, sections[key], actions, entriesOf(log, key).length)}</React.Fragment>;
          })}

          {sectionShell(
            "qaqc",
            t("workspace.qaqcHse"),
            <ShieldCheck className="size-4" />,
            log.records.length ? (
              <ul className="divide-y divide-line">
                {log.records.map((record) => (
                  <li key={record.linkId} className="flex items-center gap-3 py-2.5" data-testid="linked-record">
                    <span className="rounded bg-hover px-1.5 py-0.5 text-micro font-medium uppercase text-fg-muted">{record.domain === "hse" ? "HSE" : "QA/QC"}</span>
                    <span className="min-w-0 flex-1 text-table text-fg">
                      {record.href ? (
                        <Link href={record.href} className="font-medium hover:text-accent-strong">
                          {record.label}
                        </Link>
                      ) : (
                        <span className="text-fg-muted">{record.label}</span>
                      )}
                      {record.detail ? <span className="ml-2 text-meta text-fg-muted">{record.detail}</span> : null}
                    </span>
                    {(record.domain === "hse" ? caps.sections.hse : caps.sections.qaqc) ? (
                      <Button type="button" variant="ghost" size="icon-sm" aria-label={t("workspace.removeLink", { label: record.label })} onClick={(event) => { const refocus = planFocusAfterRemoval(event.currentTarget); void run(t("workspace.actions.unlinking"), () => dailyLogApi(`${base}/record-links/${record.linkId}`, { method: "DELETE" })).then((done) => done && refocus()); }}>
                        <X />
                      </Button>
                    ) : null}
                  </li>
                ))}
              </ul>
            ) : (
              empty(t("workspace.empty.records"))
            ),
            caps.sections.qaqc || caps.sections.hse ? (
              <Button type="button" variant="ghost" size="sm" onClick={() => setAction("link-record")}>
                <Link2 aria-hidden="true" /> <span className="hidden sm:inline">{t("common.link")}</span>
              </Button>
            ) : null,
            log.records.length,
          )}

          {sectionShell(
            "evidence",
            t("workspace.photosDocuments"),
            <FileCheck2 className="size-4" />,
            log.evidence === null ? (
              empty(t("workspace.empty.evidence"))
            ) : (
              <EvidenceGallery dailyLogId={log.id} evidence={log.evidence} canUpload={caps.canUploadEvidence} canEdit={editable} zone={zone} onChanged={async () => void (await refresh())} />
            ),
            undefined,
            log.counts.documents,
          )}

          {sectionShell(
            "tasks",
            t("workspace.followUpTasks"),
            <ListChecks className="size-4" />,
            log.tasks.length ? (
              <ul className="divide-y divide-line">
                {log.tasks.map((task) => (
                  <li key={task.linkId} className="flex items-center gap-3 py-2.5" data-testid="linked-task">
                    <span className="min-w-0 flex-1">
                      {task.href ? (
                        <Link href={task.href} className="block text-table font-medium text-fg hover:text-accent-strong">
                          {task.title}
                        </Link>
                      ) : (
                        <span className="block text-table text-fg-muted">{task.title}</span>
                      )}
                      <span className="block text-meta text-fg-muted">{joined(L("taskLink", task.linkType, TASK_LINK_TYPE_LABELS[task.linkType]), task.status)}</span>
                    </span>
                    {caps.sections.tasks ? (
                      <Button type="button" variant="ghost" size="icon-sm" aria-label={t("workspace.unlinkTask", { title: task.title })} onClick={(event) => { const refocus = planFocusAfterRemoval(event.currentTarget); void run(t("workspace.actions.unlinking"), () => dailyLogApi(`${base}/tasks/${task.linkId}`, { method: "DELETE" })).then((done) => done && refocus()); }}>
                        <X />
                      </Button>
                    ) : null}
                  </li>
                ))}
              </ul>
            ) : (
              empty(t("workspace.empty.tasks"))
            ),
            caps.sections.tasks ? (
              <div className="flex gap-1">
                <Button type="button" variant="ghost" size="sm" onClick={() => { void loadOptions(); setAction("link-task"); }}>
                  <Link2 aria-hidden="true" /> <span className="hidden sm:inline">{t("common.link")}</span>
                </Button>
                {caps.canCreateTask ? (
                  <Button type="button" variant="ghost" size="sm" onClick={() => { void loadOptions(); setAction("task"); }}>
                    <Plus aria-hidden="true" /> <span className="hidden sm:inline">{t("common.create")}</span>
                  </Button>
                ) : null}
              </div>
            ) : null,
            log.tasks.length,
          )}

          {sectionShell(
            "history",
            t("workspace.history"),
            <Check className="size-4" />,
            log.history.length ? (
              <ol className="space-y-2">
                {log.history.map((entry) => (
                  <li key={entry.id} className="text-table">
                    <span className="font-medium text-fg">{entry.action}</span>
                    <span className="text-fg-muted"> · {joinedNodes(entry.actorName && <PersonLink memberId={entry.actorMemberId} name={entry.actorName} />, new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: zone }).format(new Date(entry.occurredAt)), dateLabel(entry.occurredAt.slice(0, 10)))}</span>
                    {entry.note ? <span className="block text-fg-muted">“{entry.note}”</span> : null}
                  </li>
                ))}
              </ol>
            ) : (
              empty(t("workspace.empty.history"))
            ),
          )}

          {discussion}
        </div>
      </div>

      {/* Sticky actions on a phone (§151, §154) */}
      {stickyBar ? (
        <div className="fixed inset-x-0 bottom-0 z-30 flex items-center gap-2 border-t border-line bg-surface/95 pb-[max(0.75rem,env(safe-area-inset-bottom))] pl-[max(1rem,env(safe-area-inset-left))] pr-[max(1rem,env(safe-area-inset-right))] pt-3 backdrop-blur md:hidden" data-testid="daily-log-sticky-actions" data-sticky-action-bar>
          {editable ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button type="button" variant="secondary" className="min-w-0 flex-1">
                  <Plus aria-hidden="true" /> {t("common.add")}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" side="top" onCloseAutoFocus={openAfterMenu}>
                {SECTION_KEYS.filter((key) => caps.sections[key]).map((key) => (
                  <DropdownMenuItem key={key} onSelect={() => (afterMenu.current = () => void openEntry(key))}>
                    {sectionLabel(key)}
                  </DropdownMenuItem>
                ))}
                {caps.canUploadEvidence ? <DropdownMenuItem onSelect={() => { setOpen((current) => ({ ...current, evidence: true })); requestAnimationFrame(() => document.getElementById("section-evidence")?.scrollIntoView({ block: "start" })); }}>{t("workspace.photo")}</DropdownMenuItem> : null}
                {caps.canCreateTask ? <DropdownMenuItem onSelect={() => (afterMenu.current = () => setAction("task"))}>{t("workspace.task")}</DropdownMenuItem> : null}
              </DropdownMenuContent>
            </DropdownMenu>
          ) : null}
          {barStep ? (
            <Button type="button" variant={barStep.variant ?? "primary"} className="min-w-0 flex-1" disabled={pending} aria-busy={pending || undefined} onClick={barStep.run}>
              {barStep.key === "submit" ? <Send aria-hidden="true" /> : null}
              <span className="truncate">{barStep.label}</span>
            </Button>
          ) : null}
          {moreSteps.length ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button type="button" variant="secondary" disabled={pending} aria-label={t("workspace.moreActions")}>
                  <MoreHorizontal aria-hidden="true" /> {t("workspace.more")}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" side="top" onCloseAutoFocus={openAfterMenu}>
                {moreSteps.map((step) => (
                  <DropdownMenuItem key={step.key} onSelect={() => (step.variant ? (afterMenu.current = step.run) : step.run())}>
                    {step.label}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          ) : null}
        </div>
      ) : null}

      <EntryDialog
        open={dialog !== null}
        onOpenChange={(value) => !value && setDialog(null)}
        section={dialog?.section ?? null}
        initial={dialog && dialogEntry ? valuesFromEntry(dialog.section, dialogEntry) : dialog?.section === "workforce" ? { headcount: "" } : dialog?.section === "equipment" ? { quantity: 1 } : {}}
        editing={Boolean(dialogEntry)}
        options={options}
        mobile={sheet}
        onSave={saveEntry}
        onRemove={dialogEntry ? removeEntry : undefined}
      />

      <ReasonDialog
        open={action === "return" || action === "void"}
        title={action === "void" ? t("workspace.reason.voidTitle") : t("workspace.reason.returnTitle")}
        description={action === "void" ? t("workspace.reason.voidDescription") : t("workspace.reason.returnDescription")}
        label={action === "void" ? t("workspace.reason.voidLabel") : t("workspace.reason.returnLabel")}
        confirm={action === "void" ? t("workspace.voidLog") : t("workspace.actions.return")}
        destructive={action === "void"}
        pending={pending}
        onClose={() => setAction(null)}
        onConfirm={async (reason) => {
          const path = action === "void" ? "void" : "return";
          const outcome = await perform(action === "void" ? t("workspace.actions.voiding") : t("workspace.actions.returning"), () => dailyLogApi(`${base}/${path}`, { body: { expectedVersion: log.version, reason } }), action === "void" ? t("workspace.actions.voided") : t("workspace.actions.returned"));
          if (outcome.kind === "committed") setAction(null);
          return outcome;
        }}
      />

      <CorrectionDialog open={action === "correction"} pending={pending} onClose={() => setAction(null)} onConfirm={async (input) => { const outcome = await perform(t("workspace.actions.addingCorrection"), () => dailyLogApi(`${base}/corrections`, { body: input }), t("workspace.actions.correctionAdded")); if (outcome.kind === "committed") setAction(null); return outcome; }} />

      <TaskDialog
        open={action === "task"}
        options={options}
        pending={pending}
        onClose={() => setAction(null)}
        onConfirm={async (input) => {
          const outcome = await perform(t("workspace.actions.creatingTask"), () => dailyLogApi(`${base}/tasks/create`, { body: input }), t("workspace.actions.taskCreated"));
          if (outcome.kind === "committed") setAction(null);
          return outcome;
        }}
      />

      <LinkTaskDialog open={action === "link-task"} options={options} pending={pending} onClose={() => setAction(null)} onConfirm={async (taskId) => { const outcome = await perform(t("workspace.actions.linking"), () => dailyLogApi(`${base}/tasks`, { body: { taskId, linkType: "RELATED" } }), t("workspace.actions.taskLinked")); if (outcome.kind === "committed") setAction(null); return outcome; }} />

      <LinkRecordDialog open={action === "link-record"} base={base} pending={pending} onClose={() => setAction(null)} onConfirm={async (recordType, recordId) => { if (await run(t("workspace.actions.linking"), () => dailyLogApi(`${base}/record-links`, { body: { recordType, recordId } }), t("workspace.actions.recordLinked"))) setAction(null); }} />
    </div>
  );
}

function OverviewField({ label, value, editable, wide, onSave, testId }: { label: string; value: string | null; editable: boolean; wide?: boolean; onSave: (value: string) => Promise<SaveOutcome>; testId?: string }) {
  const [text, setText] = React.useState(value ?? "");
  React.useEffect(() => setText(value ?? ""), [value]);
  const id = `overview-${label.toLowerCase().replace(/\W+/g, "-")}`;
  const textRef = React.useRef(text);
  textRef.current = text;

  // Typed but not yet saved — the save runs on blur — is unsaved work (AUD-03 §3).
  const editor = useUnsavedEditor({ module: "daily_logs", saveKind: "save", label, save: () => onSave(textRef.current.trim()) });
  const { setDirty } = editor;
  // Exactly what the blur save would send: nothing when the trimmed text is what is saved.
  React.useEffect(() => setDirty(editable && (text.trim() || null) !== (value ?? null)), [editable, text, value, setDirty]);

  return (
    <div className={cn(wide && "sm:col-span-2")}>
      <label htmlFor={id} className="text-table font-medium text-fg">
        {label}
      </label>
      {editable ? (
        <Textarea id={id} rows={wide ? 3 : 2} className="mt-1.5" value={text} maxLength={5000} onChange={(event) => setText(event.target.value)} onBlur={() => void onSave(text.trim())} data-testid={testId} />
      ) : (
        <p className="mt-1 whitespace-pre-line text-table text-fg">{value || "—"}</p>
      )}
    </div>
  );
}

/**
 * A dialog's input under the unsaved-work contract (AUD-03 §3): registered from
 * inside the dialog, so closing it asks; `confirm` is the dialog's one step,
 * run once at a time, saving while it runs, unknown when it never answered.
 * A workflow step (return, void, a correction) is never run from the prompt.
 */
function useDialogStep({ label, saveKind, workflow, dirty, confirm }: { label: string; saveKind: "create" | "none"; workflow?: string; dirty: boolean; confirm: () => Promise<SaveOutcome> }) {
  const confirmRef = React.useRef(confirm);
  confirmRef.current = confirm;
  const running = React.useRef(false);
  const go = React.useRef<() => Promise<SaveOutcome>>(async () => ({ kind: "unknown" }));
  const editor = useUnsavedEditor({ module: "daily_logs", saveKind, workflow, label, save: saveKind === "none" ? undefined : () => go.current() });
  const { setDirty, setSaving, setUnresolved } = editor;
  React.useEffect(() => setDirty(dirty), [dirty, setDirty]);
  go.current = async () => {
    if (running.current) return { kind: "unknown" };
    running.current = true;
    setSaving(true);
    let outcome: SaveOutcome;
    try {
      outcome = await confirmRef.current();
    } catch {
      outcome = { kind: "unknown" };
    }
    if (outcome.kind === "committed") setDirty(false);
    setUnresolved(outcome.kind === "unknown");
    running.current = false;
    setSaving(false);
    return outcome;
  };
  return React.useCallback(() => go.current(), []);
}

type ReasonDialogProps = { open: boolean; title: string; description: string; label: string; confirm: string; destructive?: boolean; pending: boolean; onClose: () => void; onConfirm: (reason: string) => Promise<SaveOutcome> };

function ReasonDialog(props: ReasonDialogProps) {
  return (
    <Dialog open={props.open} onOpenChange={(value) => !value && props.onClose()}>
      <DialogContent>
        <DialogTitle>{props.title}</DialogTitle>
        <DialogDescription>{props.description}</DialogDescription>
        {/* Inside the dialog, so the reason belongs to its guarded close (AUD-03 §5). Mounted on open: it starts empty. */}
        <ReasonForm {...props} />
      </DialogContent>
    </Dialog>
  );
}

function ReasonForm({ title, label, confirm, destructive, pending, onConfirm }: ReasonDialogProps) {
  const t = useDailyLogsTranslations();
  const [reason, setReason] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const step = useDialogStep({ label: title, saveKind: "none", workflow: confirm, dirty: reason !== "", confirm: () => onConfirm(reason.trim()) });
  return (
    <>
      <label htmlFor="reason-text" className="mt-4 block text-table font-medium text-fg">
        {label}
      </label>
      <Textarea id="reason-text" rows={3} className="mt-1.5" value={reason} readOnly={pending} onChange={(event) => setReason(event.target.value)} aria-invalid={Boolean(error)} />
      {error ? <p role="alert" className="mt-1 text-meta text-danger-strong">{error}</p> : null}
      <DialogFooter>
        <DialogClose asChild>
          <Button variant="secondary" disabled={pending}>
            <DailyLogsText k="common.cancel" />
          </Button>
        </DialogClose>
        <Button variant={destructive ? "danger" : "primary"} disabled={pending} onClick={() => (reason.trim() ? void step() : setError(t("workspace.reason.giveReason")))}>
          {confirm}
        </Button>
      </DialogFooter>
    </>
  );
}

type CorrectionDialogProps = { open: boolean; pending: boolean; onClose: () => void; onConfirm: (input: { reason: string; correctionSummary: string }) => Promise<SaveOutcome> };

function CorrectionDialog(props: CorrectionDialogProps) {
  return (
    <Dialog open={props.open} onOpenChange={(value) => !value && props.onClose()}>
      <DialogContent>
        <DialogTitle><DailyLogsText k="workspace.correction.title" /></DialogTitle>
        <DialogDescription><DailyLogsText k="workspace.correction.description" /></DialogDescription>
        {/* Inside the dialog, so the correction belongs to its guarded close (AUD-03 §5). */}
        <CorrectionForm {...props} />
      </DialogContent>
    </Dialog>
  );
}

function CorrectionForm({ pending, onConfirm }: CorrectionDialogProps) {
  const [reason, setReason] = React.useState("");
  const [summary, setSummary] = React.useState("");
  const t = useDailyLogsTranslations();
  const [error, setError] = React.useState<string | null>(null);
  // An official correction is a workflow step on a locked record (AUD-03 §3).
  const step = useDialogStep({ label: t("workspace.correction.editor"), saveKind: "none", workflow: t("workspace.actions.addCorrection"), dirty: reason !== "" || summary !== "", confirm: () => onConfirm({ reason: reason.trim(), correctionSummary: summary.trim() }) });
  return (
    <>
      <label htmlFor="correction-reason" className="mt-4 block text-table font-medium text-fg">
        {t("workspace.correction.why")}
      </label>
      <Input id="correction-reason" className="mt-1.5" value={reason} readOnly={pending} onChange={(event) => setReason(event.target.value)} />
      <label htmlFor="correction-summary" className="mt-3 block text-table font-medium text-fg">
        {t("workspace.correction.text")}
      </label>
      <Textarea id="correction-summary" rows={4} className="mt-1.5" value={summary} readOnly={pending} onChange={(event) => setSummary(event.target.value)} />
      {error ? <p role="alert" className="mt-1 text-meta text-danger-strong">{error}</p> : null}
      <DialogFooter>
        <DialogClose asChild>
          <Button variant="secondary" disabled={pending}>
            <DailyLogsText k="common.cancel" />
          </Button>
        </DialogClose>
        <Button disabled={pending} onClick={() => (reason.trim() && summary.trim() ? void step() : setError(t("workspace.correction.missing")))}>
          {t("workspace.actions.addCorrection")}
        </Button>
      </DialogFooter>
    </>
  );
}

type TaskDialogProps = { open: boolean; options: EntryOptions | null; pending: boolean; onClose: () => void; onConfirm: (input: Record<string, unknown>) => Promise<SaveOutcome> };

function TaskDialog(props: TaskDialogProps) {
  return (
    <Dialog open={props.open} onOpenChange={(value) => !value && props.onClose()}>
      <DialogContent>
        <DialogTitle><DailyLogsText k="workspace.taskDialog.title" /></DialogTitle>
        <DialogDescription><DailyLogsText k="workspace.taskDialog.description" /></DialogDescription>
        {/* Inside the dialog, so the task belongs to its guarded close (AUD-03 §5). */}
        <TaskForm {...props} />
      </DialogContent>
    </Dialog>
  );
}

function TaskForm({ options, pending, onConfirm }: TaskDialogProps) {
  const [title, setTitle] = React.useState("");
  const [assignee, setAssignee] = React.useState("");
  const [due, setDue] = React.useState("");
  const [priority, setPriority] = React.useState("MEDIUM");
  const t = useDailyLogsTranslations();
  const [error, setError] = React.useState<string | null>(null);
  const valid = title.trim().length >= 2;
  const step = useDialogStep({
    label: t("workspace.taskDialog.editor"),
    saveKind: "create",
    dirty: title !== "" || assignee !== "" || due !== "" || priority !== "MEDIUM",
    confirm: async () => {
      if (!valid) {
        setError(t("workspace.taskDialog.needTitle"));
        return { kind: "invalid" };
      }
      return onConfirm({ title: title.trim(), assigneeMemberId: assignee || null, dueDate: due || null, priority });
    },
  });
  return (
    <>
      <fieldset disabled={pending} className="m-0 mt-4 grid min-w-0 gap-3 border-0 p-0 sm:grid-cols-2">
        <label className="flex flex-col sm:col-span-2">
          <span className="text-table font-medium text-fg">{t("workspace.taskDialog.titleLabel")}</span>
          <Input className="mt-1.5" value={title} onChange={(event) => setTitle(event.target.value)} aria-label={t("workspace.taskDialog.taskTitle")} />
        </label>
        <label className="flex flex-col">
          <span className="text-table font-medium text-fg">{t("workspace.taskDialog.assignee")}</span>
          <FormSelect className={cn(selectClass, "mt-1.5")} value={assignee} onChange={(event) => setAssignee(event.target.value)}>
            <option value="">{t("workspace.taskDialog.unassigned")}</option>
            {options?.members.map((member) => (
              <option key={member.id} value={member.id}>
                {member.label}
              </option>
            ))}
          </FormSelect>
        </label>
        <label className="flex flex-col">
          <span className="text-table font-medium text-fg">{t("workspace.taskDialog.due")}</span>
          <Input type="date" className="mt-1.5" value={due} onChange={(event) => setDue(event.target.value)} />
        </label>
        <label className="flex flex-col">
          <span className="text-table font-medium text-fg">{t("workspace.taskDialog.priority")}</span>
          <FormSelect className={cn(selectClass, "mt-1.5")} value={priority} onChange={(event) => setPriority(event.target.value)}>
            {["LOW", "MEDIUM", "HIGH", "CRITICAL"].map((value) => (
              <option key={value} value={value}>
                {dailyLogsLabel(t, "priority", value, value.charAt(0) + value.slice(1).toLowerCase())}
              </option>
            ))}
          </FormSelect>
        </label>
      </fieldset>
      {error ? <p role="alert" className="mt-2 text-meta text-danger-strong">{error}</p> : null}
      <DialogFooter>
        <DialogClose asChild>
          <Button variant="secondary" disabled={pending}>
            <DailyLogsText k="common.cancel" />
          </Button>
        </DialogClose>
        <Button disabled={pending} onClick={() => void step()}>
          {t("workspace.taskDialog.create")}
        </Button>
      </DialogFooter>
    </>
  );
}

type LinkTaskDialogProps = { open: boolean; options: EntryOptions | null; pending: boolean; onClose: () => void; onConfirm: (taskId: string) => Promise<SaveOutcome> };

function LinkTaskDialog(props: LinkTaskDialogProps) {
  return (
    <Dialog open={props.open} onOpenChange={(value) => !value && props.onClose()}>
      <DialogContent>
        <DialogTitle><DailyLogsText k="workspace.linkTask.title" /></DialogTitle>
        <DialogDescription><DailyLogsText k="workspace.linkTask.description" /></DialogDescription>
        {/* Inside the dialog, so the pick belongs to its guarded close (AUD-03 §5). */}
        <LinkTaskForm {...props} />
      </DialogContent>
    </Dialog>
  );
}

function LinkTaskForm({ options, pending, onConfirm }: LinkTaskDialogProps) {
  const [taskId, setTaskId] = React.useState("");
  const t = useDailyLogsTranslations();
  const step = useDialogStep({ label: t("workspace.linkTask.title"), saveKind: "create", dirty: taskId !== "", confirm: async () => (taskId ? onConfirm(taskId) : { kind: "invalid" }) });
  return (
    <>
      <FormSelect className={cn(selectClass, "mt-4")} value={taskId} disabled={pending} onChange={(event) => setTaskId(event.target.value)} aria-label={t("workspace.task")}>
        <option value="">{t("workspace.linkTask.choose")}</option>
        {options?.tasks.map((task) => (
          <option key={task.id} value={task.id}>
            {task.label}
          </option>
        ))}
      </FormSelect>
      <DialogFooter>
        <DialogClose asChild>
          <Button variant="secondary" disabled={pending}>
            <DailyLogsText k="common.cancel" />
          </Button>
        </DialogClose>
        <Button disabled={pending || !taskId} onClick={() => void step()}>
          {t("workspace.linkTask.submit")}
        </Button>
      </DialogFooter>
    </>
  );
}

function LinkRecordDialog({ open, base, pending, onClose, onConfirm }: { open: boolean; base: string; pending: boolean; onClose: () => void; onConfirm: (recordType: string, recordId: string) => Promise<void> }) {
  const t = useDailyLogsTranslations();
  const [candidates, setCandidates] = React.useState<Array<{ recordType: string; recordId: string; label: string; noun: string; domain: "qaqc" | "hse"; linked: boolean }> | null>(null);
  React.useEffect(() => {
    if (!open) return;
    setCandidates(null);
    void dailyLogApi<typeof candidates>(`${base}/record-links/candidates`).then(setCandidates).catch(() => setCandidates([]));
  }, [open, base]);
  return (
    <Dialog open={open} onOpenChange={(value) => !value && onClose()}>
      <DialogContent>
        <DialogTitle>{t("workspace.linkRecord.title")}</DialogTitle>
        <DialogDescription>{t("workspace.linkRecord.description")}</DialogDescription>
        <ul className="mt-4 max-h-80 divide-y divide-line overflow-y-auto">
          {candidates === null ? <li className="py-3 text-table text-fg-muted">{t("common.loading")}</li> : null}
          {candidates?.length === 0 ? <li className="py-3 text-table text-fg-muted">{t("workspace.linkRecord.none")}</li> : null}
          {candidates?.map((candidate) => (
            <li key={`${candidate.recordType}:${candidate.recordId}`} className="flex items-center gap-3 py-2.5">
              <span className="min-w-0 flex-1">
                <span className="block text-table font-medium text-fg">{candidate.label}</span>
                <span className="block text-meta text-fg-muted">{candidate.noun}</span>
              </span>
              <Button size="sm" variant="secondary" disabled={pending || candidate.linked} onClick={() => void onConfirm(candidate.recordType, candidate.recordId)}>
                {candidate.linked ? t("common.linked") : t("common.link")}
              </Button>
            </li>
          ))}
        </ul>
        <DialogFooter>
          <Button variant="secondary" onClick={onClose}>
            {t("common.close")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
