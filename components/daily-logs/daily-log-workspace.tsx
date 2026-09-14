"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
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
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/toast";
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
import { dailyLogApi, failureMessage, isFailure } from "./daily-log-api";
import { CorrectedBadge, DailyLogStatusBadge, LateEntryBadge, Stat } from "./daily-log-ui";
import { EntryDialog, type EntryOptions } from "./entry-dialog";
import { entriesOf, payloadFromValues, valuesFromEntry } from "./entry-fields";
import { EvidenceGallery } from "./evidence-gallery";

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

function useMobile() {
  const [mobile, setMobile] = React.useState(false);
  React.useEffect(() => {
    const media = window.matchMedia("(max-width: 767px)");
    const update = () => setMobile(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  return mobile;
}

function EntryLine({ primary, secondary, meta, onEdit, testId }: { primary: React.ReactNode; secondary?: React.ReactNode; meta?: React.ReactNode; onEdit?: () => void; testId: string }) {
  return (
    <li className="flex items-start gap-3 py-2.5" data-testid={testId}>
      <span className="min-w-0 flex-1">
        <span className="block text-table font-medium text-fg">{primary}</span>
        {secondary ? <span className="block text-meta text-fg-muted">{secondary}</span> : null}
      </span>
      {meta ? <span className="shrink-0 text-table tabular-nums text-fg">{meta}</span> : null}
      {onEdit ? (
        <Button type="button" variant="ghost" size="icon-sm" onClick={onEdit} aria-label="Edit entry">
          <Pencil />
        </Button>
      ) : null}
    </li>
  );
}

const joined = (...parts: Array<string | number | null | undefined | false>) => parts.filter((part) => part !== null && part !== undefined && part !== false && part !== "").join(" · ");

export function DailyLogWorkspace({ initial, discussion, zone }: { initial: DailyLogDetailDTO; discussion: React.ReactNode; zone: string }) {
  const router = useRouter();
  const toast = useToast();
  const mobile = useMobile();
  const [log, setLog] = React.useState(initial);
  const [options, setOptions] = React.useState<EntryOptions | null>(null);
  const [dialog, setDialog] = React.useState<{ section: SectionKey; entryId?: string } | null>(null);
  const [saving, setSaving] = React.useState<"idle" | "saving" | "saved" | "error">("idle");
  const [open, setOpen] = React.useState<Record<string, boolean>>({});
  const [action, setAction] = React.useState<"return" | "void" | "correction" | "task" | "link-task" | "link-record" | null>(null);
  const [pending, setPending] = React.useState(false);
  const caps = log.capabilities;
  const editable = caps.canEdit;
  const base = `/api/daily-logs/${log.id}`;

  React.useEffect(() => setLog(initial), [initial]);

  const refresh = React.useCallback(async () => {
    const next = await dailyLogApi<DailyLogDetailDTO>(base);
    setLog(next);
    return next;
  }, [base]);

  const loadOptions = React.useCallback(async () => {
    if (options) return options;
    const data = await dailyLogApi<{ suppliers: Array<{ id: string; label: string }>; purchaseOrders: Array<{ id: string; label: string }>; goodsReceipts: Array<{ id: string; label: string }>; inventoryReceipts: Array<{ id: string; label: string }>; tasks: Array<{ id: string; label: string }>; members: Array<{ id: string; label: string }> }>(`${base}/options`);
    setOptions(data);
    return data;
  }, [base, options]);

  async function run(label: string, work: () => Promise<unknown>, success?: string) {
    setPending(true);
    try {
      await work();
      await refresh();
      if (success) toast({ title: success, tone: "success" });
      router.refresh();
      return true;
    } catch (error) {
      toast({ title: failureMessage(error, `${label} failed.`), tone: "danger" });
      if (isFailure(error) && (error.status === 409 || error.detailCode === "DAILY_LOG_STALE")) void refresh();
      return false;
    } finally {
      setPending(false);
    }
  }

  async function openEntry(section: SectionKey, entryId?: string) {
    setDialog({ section, entryId });
    void loadOptions().catch(() => undefined);
  }

  const dialogEntry = dialog?.entryId ? entriesOf(log, dialog.section).find((entry) => entry.id === dialog.entryId) : undefined;

  async function saveEntry(values: Record<string, unknown>) {
    if (!dialog) return;
    const body = { ...payloadFromValues(dialog.section, values), ...(dialogEntry ? { updatedAt: dialogEntry.updatedAt } : {}) };
    setSaving("saving");
    try {
      if (dialogEntry) await dailyLogApi(`${base}/${dialog.section}/${dialogEntry.id}`, { method: "PATCH", body });
      else await dailyLogApi(`${base}/${dialog.section}`, { body });
      await refresh();
      setSaving("saved");
    } catch (error) {
      setSaving("error");
      throw error;
    }
  }

  async function removeEntry() {
    if (!dialog || !dialogEntry) return;
    await dailyLogApi(`${base}/${dialog.section}/${dialogEntry.id}`, { method: "DELETE" });
    await refresh();
  }

  async function saveOverview(field: string, value: string | null) {
    if (!editable) return;
    const current = (log as unknown as Record<string, unknown>)[field];
    if ((current ?? null) === (value || null)) return;
    setSaving("saving");
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
      await refresh();
      setSaving("saved");
    } catch (error) {
      setSaving("error");
      toast({ title: failureMessage(error), tone: "danger" });
      if (isFailure(error) && error.status === 409) void refresh();
    }
  }

  const transition = (path: string, label: string, success: string) => run(label, () => dailyLogApi(`${base}/${path}`, { body: { expectedVersion: log.version } }), success);

  const issueCount = log.issues.length;
  const rail: Array<{ key: Rail; label: string; count?: number }> = [
    { key: "overview", label: "Overview" },
    ...SECTION_KEYS.map((key) => ({ key, label: SECTION_LABELS[key], count: entriesOf(log, key).length })),
    { key: "qaqc", label: "QA/QC & HSE", count: log.records.length },
    { key: "evidence", label: "Evidence", count: log.counts.photos + (log.counts.documents - log.counts.photos) },
    { key: "tasks", label: "Tasks", count: log.tasks.length },
    { key: "history", label: "History" },
  ];
  const isOpen = (key: string) => (mobile ? Boolean(open[key]) : true);
  const toggle = (key: string) => setOpen((current) => ({ ...current, [key]: !current[key] }));

  const sectionShell = (key: Rail, title: string, icon: React.ReactNode, body: React.ReactNode, actions?: React.ReactNode, count?: number) => (
    <section id={`section-${key}`} aria-labelledby={`title-${key}`} className="nesto-card scroll-mt-24 px-4 py-3 sm:px-5 sm:py-4" data-testid={`section-${key}`}>
      <header className="flex items-center gap-2">
        <button type="button" className="flex min-w-0 flex-1 items-center gap-2 text-left md:pointer-events-none" onClick={() => toggle(key)} aria-expanded={isOpen(key)}>
          <span className="text-fg-subtle" aria-hidden="true">
            {icon}
          </span>
          <h2 id={`title-${key}`} className="text-card font-semibold text-fg">
            {title}
          </h2>
          {count !== undefined ? <span className="rounded-full bg-hover px-1.5 text-micro font-medium tabular-nums text-fg-muted">{count}</span> : null}
          <ChevronDown className={cn("ml-auto size-4 text-fg-subtle transition-transform md:hidden", isOpen(key) && "rotate-180")} aria-hidden="true" />
        </button>
        {actions}
      </header>
      {isOpen(key) ? <div className="mt-2">{body}</div> : null}
    </section>
  );

  const addButton = (section: SectionKey) =>
    caps.sections[section] ? (
      <Button type="button" variant="ghost" size="sm" onClick={() => void openEntry(section)} aria-label={`Add ${SECTION_LABELS[section].toLowerCase()}`}>
        <Plus aria-hidden="true" /> <span className="hidden sm:inline">Add</span>
      </Button>
    ) : null;

  const empty = (text: string) => <p className="py-2 text-table text-fg-subtle">{text}</p>;

  const sections: Record<SectionKey, React.ReactNode> = {
    weather: log.weather.length ? (
      <ul className="divide-y divide-line">
        {log.weather.map((entry) => (
          <EntryLine key={entry.id} testId="weather-entry" primary={joined(entry.observedAt, entry.condition ? WEATHER_CONDITION_LABELS[entry.condition] : null)} secondary={joined(entry.precipitationMm !== null && `${entry.precipitationMm} mm rain`, entry.windKph !== null && `wind ${entry.windKph} km/h`, entry.humidityPct !== null && `${entry.humidityPct}% humidity`, entry.notes)} meta={entry.temperatureC !== null ? `${entry.temperatureC} °C` : undefined} onEdit={caps.sections.weather ? () => void openEntry("weather", entry.id) : undefined} />
        ))}
      </ul>
    ) : empty("No weather readings."),
    workforce: log.workforce.length ? (
      <ul className="divide-y divide-line">
        {log.workforce.map((entry) => (
          <EntryLine key={entry.id} testId="workforce-entry" primary={entry.organizationName} secondary={joined(entry.trade, entry.crewName, entry.supplier ? `Supplier: ${entry.supplier.label}` : null, entry.notes)} meta={`${entry.headcount}`} onEdit={caps.sections.workforce ? () => void openEntry("workforce", entry.id) : undefined} />
        ))}
        <li className="flex justify-between pt-2.5 text-table font-medium text-fg">
          <span>On site</span>
          <span className="tabular-nums" data-testid="workforce-total">{log.counts.workforce}</span>
        </li>
      </ul>
    ) : empty("No workforce recorded."),
    activities: log.activities.length ? (
      <ul className="divide-y divide-line">
        {log.activities.map((entry) => (
          <EntryLine key={entry.id} testId="activity-entry" primary={entry.title} secondary={joined(entry.projectArea, entry.floorZone, entry.trade, entry.task ? `Task: ${entry.task.label}` : null, entry.description)} meta={entry.progressPercent !== null ? `${entry.progressPercent}%` : undefined} onEdit={caps.sections.activities ? () => void openEntry("activities", entry.id) : undefined} />
        ))}
      </ul>
    ) : empty("No work recorded."),
    equipment: log.equipment.length ? (
      <ul className="divide-y divide-line">
        {log.equipment.map((entry) => (
          <EntryLine key={entry.id} testId="equipment-entry" primary={joined(entry.equipmentName, entry.equipmentCode)} secondary={joined(entry.status ? EQUIPMENT_STATUS_LABELS[entry.status] : null, entry.hoursUsed !== null && `${entry.hoursUsed} h`, entry.supplier?.label, entry.notes)} meta={`× ${entry.quantity}`} onEdit={caps.sections.equipment ? () => void openEntry("equipment", entry.id) : undefined} />
        ))}
      </ul>
    ) : empty("No equipment recorded."),
    deliveries: log.deliveries.length ? (
      <ul className="divide-y divide-line">
        {log.deliveries.map((entry) => (
          <EntryLine
            key={entry.id}
            testId="delivery-entry"
            primary={entry.description}
            secondary={
              <>
                {joined(entry.supplier?.label, entry.deliveredTime && `arrived ${entry.deliveredTime}`, entry.outsideWorkDate && entry.deliveredDate ? `on ${dateLabel(entry.deliveredDate)}` : null, entry.conditionNote)}
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
    ) : empty("No deliveries recorded."),
    visitors: log.visitors.length ? (
      <ul className="divide-y divide-line">
        {log.visitors.map((entry) => (
          <EntryLine key={entry.id} testId="visitor-entry" primary={joined(entry.name, entry.organization)} secondary={joined(entry.purpose, entry.escortedBy && `escorted by ${entry.escortedBy.name}`, entry.notes)} meta={entry.arrivedAt ? `${entry.arrivedAt}${entry.departedAt ? `–${entry.departedAt}` : ""}` : undefined} onEdit={caps.sections.visitors ? () => void openEntry("visitors", entry.id) : undefined} />
        ))}
      </ul>
    ) : empty("No visitors recorded."),
    delays: log.delays.length ? (
      <ul className="divide-y divide-line">
        {log.delays.map((entry) => (
          <EntryLine key={entry.id} testId="delay-entry" primary={entry.title} secondary={joined(DELAY_CATEGORY_LABELS[entry.category], entry.impact && `${DELAY_IMPACT_LABELS[entry.impact]} impact`, entry.startedAt && `${entry.startedAt}–${entry.endedAt ?? "…"}`, entry.responsiblePartyText, entry.task ? `Task: ${entry.task.label}` : null)} meta={entry.durationMinutes ? formatDuration(entry.durationMinutes) : undefined} onEdit={caps.sections.delays ? () => void openEntry("delays", entry.id) : undefined} />
        ))}
      </ul>
    ) : empty("No delays recorded."),
    instructions: log.instructions.length ? (
      <ul className="divide-y divide-line">
        {log.instructions.map((entry) => (
          <EntryLine key={entry.id} testId="instruction-entry" primary={entry.title} secondary={joined(entry.issuedByText ?? entry.issuedBy?.name, entry.recipientText && `to ${entry.recipientText}`, entry.issuedAt, entry.requiresAction && "Requires action", entry.task ? `Task: ${entry.task.label}` : null, entry.description)} onEdit={caps.sections.instructions ? () => void openEntry("instructions", entry.id) : undefined} />
        ))}
      </ul>
    ) : empty("No instructions recorded."),
  };

  const statusBanner = () => {
    if (log.status === "CORRECTION_REQUIRED") {
      return (
        <div className="rounded-xl border border-warning/30 bg-warning-soft px-4 py-3 text-table text-fg" role="status" data-testid="daily-log-banner">
          <p className="font-medium">Returned for correction</p>
          {log.returnReason ? <p className="mt-1 whitespace-pre-line text-fg-muted">“{log.returnReason}”</p> : null}
        </div>
      );
    }
    if (log.status === "SUBMITTED") {
      return (
        <div className="rounded-xl border border-info/30 bg-info-soft px-4 py-3 text-table text-fg" role="status" data-testid="daily-log-banner">
          Submitted{log.submittedBy ? ` by ${log.submittedBy.name}` : ""}{log.reviewer ? `, waiting for ${log.reviewer.name}'s review` : ""}. The log cannot change until it is reviewed or returned.
        </div>
      );
    }
    if (log.status === "LOCKED") {
      return (
        <div className="rounded-xl border border-success/30 bg-success-soft px-4 py-3 text-table text-fg" role="status" data-testid="daily-log-banner">
          <p className="flex items-center gap-2 font-medium">
            <Lock className="size-4 text-success-strong" aria-hidden="true" /> The official record{log.lockedBy ? `, locked by ${log.lockedBy.name}` : ""}.
          </p>
          {log.corrections.map((correction) => (
            <div key={correction.id} className="mt-2 border-t border-success/20 pt-2" data-testid="daily-log-correction">
              <p className="font-medium">Official correction added {dateLabel(correction.createdAt.slice(0, 10))}{correction.createdBy ? ` by ${correction.createdBy.name}` : ""}</p>
              <p className="whitespace-pre-line text-fg">{correction.correctionSummary}</p>
              <p className="text-meta text-fg-muted">Reason: {correction.reason}</p>
            </div>
          ))}
        </div>
      );
    }
    if (log.status === "VOID") {
      return (
        <div className="rounded-xl border border-line bg-surface-muted px-4 py-3 text-table text-fg-muted" role="status" data-testid="daily-log-banner">
          <p className="font-medium text-fg">This log was voided.</p>
          {log.voidReason ? <p className="mt-1">“{log.voidReason}”</p> : null}
        </div>
      );
    }
    if (log.status === "REVIEWED") {
      return (
        <div className="rounded-xl border border-success/30 bg-success-soft px-4 py-3 text-table text-fg" role="status" data-testid="daily-log-banner">
          Reviewed{log.reviewedBy ? ` by ${log.reviewedBy.name}` : ""}. Lock it to make it the official record.
        </div>
      );
    }
    return null;
  };

  const primaryActions = (
    <>
      {caps.canSubmit ? (
        <Button type="button" size="sm" disabled={pending} onClick={() => void transition("submit", "Submitting", "Daily log submitted")}>
          <Send aria-hidden="true" /> Submit
        </Button>
      ) : null}
      {caps.canReview ? (
        <Button type="button" size="sm" disabled={pending} onClick={() => void transition("review", "Reviewing", "Daily log reviewed")}>
          <FileCheck2 aria-hidden="true" /> Mark reviewed
        </Button>
      ) : null}
      {caps.canReturn ? (
        <Button type="button" size="sm" variant="secondary" disabled={pending} onClick={() => setAction("return")}>
          <RotateCcw aria-hidden="true" /> Return
        </Button>
      ) : null}
      {caps.canLock ? (
        <Button type="button" size="sm" disabled={pending} onClick={() => void transition("lock", "Locking", "Daily log locked")}>
          <Lock aria-hidden="true" /> Lock
        </Button>
      ) : null}
      {caps.canCorrect ? (
        <Button type="button" size="sm" variant="secondary" disabled={pending} onClick={() => setAction("correction")}>
          <Pencil aria-hidden="true" /> Add correction
        </Button>
      ) : null}
    </>
  );

  return (
    <div className={cn("space-y-4", editable && "pb-24 md:pb-0")} data-testid="daily-log-workspace">
      {/* Header (§146) */}
      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-meta text-fg-muted">
            <Link href={`/projects/${log.project.id}/daily-logs`} className="hover:text-accent-strong">
              {log.project.name}
            </Link>{" "}
            · Daily log
          </p>
          <h1 className="text-page font-semibold text-fg" data-testid="daily-log-date">
            {longDateLabel(log.workDate)}
          </h1>
          <div className="mt-1.5 flex flex-wrap items-center gap-2">
            <DailyLogStatusBadge status={log.status} />
            {log.lateEntry ? <LateEntryBadge /> : null}
            {log.corrections.length ? <CorrectedBadge /> : null}
            <span className="text-meta text-fg-muted" aria-live="polite" data-testid="save-indicator">
              {saving === "saving" ? "Saving…" : saving === "saved" ? "Saved" : saving === "error" ? "Not saved" : null}
            </span>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {editable ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button type="button" size="sm" variant="secondary" className="hidden md:inline-flex">
                  <Plus aria-hidden="true" /> Add
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {SECTION_KEYS.filter((key) => caps.sections[key]).map((key) => (
                  <DropdownMenuItem key={key} onSelect={() => void openEntry(key)}>
                    {SECTION_LABELS[key]}
                  </DropdownMenuItem>
                ))}
                {caps.canCreateTask ? <DropdownMenuItem onSelect={() => setAction("task")}>Task</DropdownMenuItem> : null}
              </DropdownMenuContent>
            </DropdownMenu>
          ) : null}
          <div className="hidden items-center gap-2 md:flex">{primaryActions}</div>
          <Button asChild size="sm" variant="ghost">
            <Link href={`/projects/${log.project.id}/daily-logs/${log.id}/print`} aria-label="Print">
              <Printer aria-hidden="true" />
            </Link>
          </Button>
          {caps.canVoid ? (
            <Button type="button" size="sm" variant="ghost" className="text-danger-strong hover:text-danger-strong" onClick={() => setAction("void")} aria-label="Void log">
              <Ban aria-hidden="true" />
            </Button>
          ) : null}
        </div>
      </div>

      {statusBanner()}

      {editable && issueCount ? (
        <div className="rounded-xl border border-warning/30 bg-warning-soft px-4 py-3 text-table" role="status" data-testid="daily-log-issues">
          <p className="font-medium text-fg">{issueCount} {issueCount === 1 ? "issue needs" : "issues need"} attention before submitting</p>
          <ul className="mt-1 list-disc pl-5 text-fg-muted">
            {log.issues.map((issue, index) => (
              <li key={index}>{issue.message}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {/* Summary cards (§146, §153) */}
      <div className="grid grid-cols-3 gap-2 sm:grid-cols-6" aria-label="Daily summary">
        <Stat label="Workforce" value={log.counts.workforce} testId="count-workforce" />
        <Stat label="Activities" value={log.counts.activities} />
        <Stat label="Deliveries" value={log.counts.deliveries} />
        <Stat label="Delays" value={log.counts.delays} />
        <Stat label="QA/QC · HSE" value={`${log.counts.qaqc} · ${log.counts.hse}`} />
        <Stat label="Photos" value={log.counts.photos} testId="count-photos" />
      </div>

      <div className="grid gap-4 md:grid-cols-[11rem_minmax(0,1fr)]">
        {/* Section rail (§147) */}
        <nav aria-label="Log sections" className="hidden md:block">
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
            "Overview",
            <NotebookPen className="size-4" />,
            <div className="grid gap-3 sm:grid-cols-2">
              <OverviewField label="Summary" value={log.summary} editable={editable} wide onSave={(value) => void saveOverview("summary", value)} testId="overview-summary" />
              <OverviewField label="Weather summary" value={log.weatherSummary} editable={editable} onSave={(value) => void saveOverview("weatherSummary", value)} />
              <div>
                <label htmlFor="site-condition" className="text-table font-medium text-fg">
                  Site condition
                </label>
                {editable ? (
                  <select id="site-condition" className={cn(selectClass, "mt-1.5")} value={log.siteCondition ?? ""} onChange={(event) => void saveOverview("siteCondition", event.target.value)}>
                    <option value="">Not recorded</option>
                    {SITE_CONDITIONS.map((condition) => (
                      <option key={condition} value={condition}>
                        {SITE_CONDITION_LABELS[condition]}
                      </option>
                    ))}
                  </select>
                ) : (
                  <p className="mt-1 text-table text-fg">{log.siteCondition ? SITE_CONDITION_LABELS[log.siteCondition] : "—"}</p>
                )}
              </div>
              <OverviewField label="Site condition notes" value={log.siteConditionNotes} editable={editable} onSave={(value) => void saveOverview("siteConditionNotes", value)} />
              <OverviewField label="Delays in brief" value={log.delaySummary} editable={editable} onSave={(value) => void saveOverview("delaySummary", value)} />
              <OverviewField label="Instructions in brief" value={log.instructionSummary} editable={editable} onSave={(value) => void saveOverview("instructionSummary", value)} />
              <OverviewField label="General notes" value={log.generalNotes} editable={editable} wide onSave={(value) => void saveOverview("generalNotes", value)} />
              <p className="text-meta text-fg-muted sm:col-span-2">{joined(log.createdBy && `Started by ${log.createdBy.name}`, log.reviewer && `Reviewer ${log.reviewer.name}`)}</p>
            </div>,
          )}

          {SECTION_KEYS.map((key) => {
            const Icon = SECTION_ICON[key];
            return <React.Fragment key={key}>{sectionShell(key, SECTION_LABELS[key], <Icon className="size-4" />, sections[key], addButton(key), entriesOf(log, key).length)}</React.Fragment>;
          })}

          {sectionShell(
            "qaqc",
            "QA/QC & HSE",
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
                      <Button type="button" variant="ghost" size="icon-sm" aria-label="Remove link" onClick={() => void run("Unlinking", () => dailyLogApi(`${base}/record-links/${record.linkId}`, { method: "DELETE" }))}>
                        <X />
                      </Button>
                    ) : null}
                  </li>
                ))}
              </ul>
            ) : (
              empty("No QA/QC or HSE records linked. The records themselves stay in their own modules.")
            ),
            caps.sections.qaqc || caps.sections.hse ? (
              <Button type="button" variant="ghost" size="sm" onClick={() => setAction("link-record")}>
                <Link2 aria-hidden="true" /> <span className="hidden sm:inline">Link</span>
              </Button>
            ) : null,
            log.records.length,
          )}

          {sectionShell(
            "evidence",
            "Photos & documents",
            <FileCheck2 className="size-4" />,
            log.evidence === null ? (
              empty("You cannot view files on this log.")
            ) : (
              <EvidenceGallery dailyLogId={log.id} evidence={log.evidence} canUpload={caps.canUploadEvidence} canEdit={editable} zone={zone} onChanged={async () => void (await refresh())} />
            ),
            undefined,
            log.counts.documents,
          )}

          {sectionShell(
            "tasks",
            "Follow-up tasks",
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
                      <span className="block text-meta text-fg-muted">{joined(TASK_LINK_TYPE_LABELS[task.linkType], task.status)}</span>
                    </span>
                    {caps.sections.tasks ? (
                      <Button type="button" variant="ghost" size="icon-sm" aria-label="Unlink task" onClick={() => void run("Unlinking", () => dailyLogApi(`${base}/tasks/${task.linkId}`, { method: "DELETE" }))}>
                        <X />
                      </Button>
                    ) : null}
                  </li>
                ))}
              </ul>
            ) : (
              empty("No tasks linked. Completing a task stays in Tasks.")
            ),
            caps.sections.tasks ? (
              <div className="flex gap-1">
                <Button type="button" variant="ghost" size="sm" onClick={() => { void loadOptions(); setAction("link-task"); }}>
                  <Link2 aria-hidden="true" /> <span className="hidden sm:inline">Link</span>
                </Button>
                {caps.canCreateTask ? (
                  <Button type="button" variant="ghost" size="sm" onClick={() => { void loadOptions(); setAction("task"); }}>
                    <Plus aria-hidden="true" /> <span className="hidden sm:inline">Create</span>
                  </Button>
                ) : null}
              </div>
            ) : null,
            log.tasks.length,
          )}

          {sectionShell(
            "history",
            "History",
            <Check className="size-4" />,
            log.history.length ? (
              <ol className="space-y-2">
                {log.history.map((entry) => (
                  <li key={entry.id} className="text-table">
                    <span className="font-medium text-fg">{entry.action}</span>
                    <span className="text-fg-muted"> · {joined(entry.actorName, new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: zone }).format(new Date(entry.occurredAt)), dateLabel(entry.occurredAt.slice(0, 10)))}</span>
                    {entry.note ? <span className="block text-fg-muted">“{entry.note}”</span> : null}
                  </li>
                ))}
              </ol>
            ) : (
              empty("Nothing yet.")
            ),
          )}

          {discussion}
        </div>
      </div>

      {/* Sticky actions on a phone (§151, §154) */}
      {editable || caps.canReview || caps.canLock ? (
        <div className="fixed inset-x-0 bottom-0 z-30 flex items-center gap-2 border-t border-line bg-surface/95 px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3 backdrop-blur md:hidden" data-testid="daily-log-sticky-actions">
          {editable ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button type="button" variant="secondary" className="flex-1">
                  <Plus aria-hidden="true" /> Add
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" side="top">
                {SECTION_KEYS.filter((key) => caps.sections[key]).map((key) => (
                  <DropdownMenuItem key={key} onSelect={() => void openEntry(key)}>
                    {SECTION_LABELS[key]}
                  </DropdownMenuItem>
                ))}
                {caps.canUploadEvidence ? <DropdownMenuItem onSelect={() => { setOpen((current) => ({ ...current, evidence: true })); document.getElementById("section-evidence")?.scrollIntoView(); }}>Photo</DropdownMenuItem> : null}
                {caps.canCreateTask ? <DropdownMenuItem onSelect={() => setAction("task")}>Task</DropdownMenuItem> : null}
              </DropdownMenuContent>
            </DropdownMenu>
          ) : null}
          {caps.canSubmit ? (
            <Button type="button" className="flex-1" disabled={pending} onClick={() => void transition("submit", "Submitting", "Daily log submitted")}>
              <Send aria-hidden="true" /> Submit log
            </Button>
          ) : null}
          {caps.canReview ? (
            <Button type="button" className="flex-1" disabled={pending} onClick={() => void transition("review", "Reviewing", "Daily log reviewed")}>
              Mark reviewed
            </Button>
          ) : null}
          {caps.canLock ? (
            <Button type="button" className="flex-1" disabled={pending} onClick={() => void transition("lock", "Locking", "Daily log locked")}>
              Lock
            </Button>
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
        mobile={mobile}
        onSave={saveEntry}
        onRemove={dialogEntry ? removeEntry : undefined}
      />

      <ReasonDialog
        open={action === "return" || action === "void"}
        title={action === "void" ? "Void this log?" : "Return for correction?"}
        description={action === "void" ? "A void log stays in the history with its reason, and the day has no valid log." : "The authors can edit the log again and resubmit it."}
        label={action === "void" ? "Why it is void" : "What needs correcting"}
        confirm={action === "void" ? "Void log" : "Return"}
        destructive={action === "void"}
        pending={pending}
        onClose={() => setAction(null)}
        onConfirm={async (reason) => {
          const path = action === "void" ? "void" : "return";
          const ok = await run(action === "void" ? "Voiding" : "Returning", () => dailyLogApi(`${base}/${path}`, { body: { expectedVersion: log.version, reason } }), action === "void" ? "Daily log voided" : "Returned for correction");
          if (ok) setAction(null);
        }}
      />

      <CorrectionDialog open={action === "correction"} pending={pending} onClose={() => setAction(null)} onConfirm={async (input) => { if (await run("Adding the correction", () => dailyLogApi(`${base}/corrections`, { body: input }), "Correction added")) setAction(null); }} />

      <TaskDialog
        open={action === "task"}
        options={options}
        pending={pending}
        onClose={() => setAction(null)}
        onConfirm={async (input) => {
          if (await run("Creating the task", () => dailyLogApi(`${base}/tasks/create`, { body: input }), "Task created")) setAction(null);
        }}
      />

      <LinkTaskDialog open={action === "link-task"} options={options} pending={pending} onClose={() => setAction(null)} onConfirm={async (taskId) => { if (await run("Linking", () => dailyLogApi(`${base}/tasks`, { body: { taskId, linkType: "RELATED" } }), "Task linked")) setAction(null); }} />

      <LinkRecordDialog open={action === "link-record"} base={base} pending={pending} onClose={() => setAction(null)} onConfirm={async (recordType, recordId) => { if (await run("Linking", () => dailyLogApi(`${base}/record-links`, { body: { recordType, recordId } }), "Record linked")) setAction(null); }} />
    </div>
  );
}

function OverviewField({ label, value, editable, wide, onSave, testId }: { label: string; value: string | null; editable: boolean; wide?: boolean; onSave: (value: string) => void; testId?: string }) {
  const [text, setText] = React.useState(value ?? "");
  React.useEffect(() => setText(value ?? ""), [value]);
  const id = `overview-${label.toLowerCase().replace(/\W+/g, "-")}`;
  return (
    <div className={cn(wide && "sm:col-span-2")}>
      <label htmlFor={id} className="text-table font-medium text-fg">
        {label}
      </label>
      {editable ? (
        <Textarea id={id} rows={wide ? 3 : 2} className="mt-1.5" value={text} maxLength={5000} onChange={(event) => setText(event.target.value)} onBlur={() => onSave(text.trim())} data-testid={testId} />
      ) : (
        <p className="mt-1 whitespace-pre-line text-table text-fg">{value || "—"}</p>
      )}
    </div>
  );
}

function ReasonDialog({ open, title, description, label, confirm, destructive, pending, onClose, onConfirm }: { open: boolean; title: string; description: string; label: string; confirm: string; destructive?: boolean; pending: boolean; onClose: () => void; onConfirm: (reason: string) => Promise<void> }) {
  const [reason, setReason] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  React.useEffect(() => {
    if (open) {
      setReason("");
      setError(null);
    }
  }, [open]);
  return (
    <Dialog open={open} onOpenChange={(value) => !value && onClose()}>
      <DialogContent>
        <DialogTitle>{title}</DialogTitle>
        <DialogDescription>{description}</DialogDescription>
        <label htmlFor="reason-text" className="mt-4 block text-table font-medium text-fg">
          {label}
        </label>
        <Textarea id="reason-text" rows={3} className="mt-1.5" value={reason} onChange={(event) => setReason(event.target.value)} aria-invalid={Boolean(error)} />
        {error ? <p role="alert" className="mt-1 text-meta text-danger-strong">{error}</p> : null}
        <DialogFooter>
          <Button variant="secondary" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button variant={destructive ? "danger" : "primary"} disabled={pending} onClick={() => (reason.trim() ? void onConfirm(reason.trim()) : setError("Give a reason."))}>
            {confirm}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CorrectionDialog({ open, pending, onClose, onConfirm }: { open: boolean; pending: boolean; onClose: () => void; onConfirm: (input: { reason: string; correctionSummary: string }) => Promise<void> }) {
  const [reason, setReason] = React.useState("");
  const [summary, setSummary] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  React.useEffect(() => {
    if (open) {
      setReason("");
      setSummary("");
      setError(null);
    }
  }, [open]);
  return (
    <Dialog open={open} onOpenChange={(value) => !value && onClose()}>
      <DialogContent>
        <DialogTitle>Add an official correction</DialogTitle>
        <DialogDescription>The locked log stays exactly as it was; the correction is added beside it, dated and attributed.</DialogDescription>
        <label htmlFor="correction-reason" className="mt-4 block text-table font-medium text-fg">
          Why it needs correcting
        </label>
        <Input id="correction-reason" className="mt-1.5" value={reason} onChange={(event) => setReason(event.target.value)} />
        <label htmlFor="correction-summary" className="mt-3 block text-table font-medium text-fg">
          The correction
        </label>
        <Textarea id="correction-summary" rows={4} className="mt-1.5" value={summary} onChange={(event) => setSummary(event.target.value)} />
        {error ? <p role="alert" className="mt-1 text-meta text-danger-strong">{error}</p> : null}
        <DialogFooter>
          <Button variant="secondary" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button disabled={pending} onClick={() => (reason.trim() && summary.trim() ? void onConfirm({ reason: reason.trim(), correctionSummary: summary.trim() }) : setError("Give the reason and the correction."))}>
            Add correction
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function TaskDialog({ open, options, pending, onClose, onConfirm }: { open: boolean; options: EntryOptions | null; pending: boolean; onClose: () => void; onConfirm: (input: Record<string, unknown>) => Promise<void> }) {
  const [title, setTitle] = React.useState("");
  const [assignee, setAssignee] = React.useState("");
  const [due, setDue] = React.useState("");
  const [priority, setPriority] = React.useState("MEDIUM");
  const [error, setError] = React.useState<string | null>(null);
  React.useEffect(() => {
    if (open) {
      setTitle("");
      setAssignee("");
      setDue("");
      setPriority("MEDIUM");
      setError(null);
    }
  }, [open]);
  return (
    <Dialog open={open} onOpenChange={(value) => !value && onClose()}>
      <DialogContent>
        <DialogTitle>Create a follow-up task</DialogTitle>
        <DialogDescription>The task is created in Tasks, on this log&apos;s project, and linked here.</DialogDescription>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <label className="flex flex-col sm:col-span-2">
            <span className="text-table font-medium text-fg">Title</span>
            <Input className="mt-1.5" value={title} onChange={(event) => setTitle(event.target.value)} aria-label="Task title" />
          </label>
          <label className="flex flex-col">
            <span className="text-table font-medium text-fg">Assignee</span>
            <select className={cn(selectClass, "mt-1.5")} value={assignee} onChange={(event) => setAssignee(event.target.value)}>
              <option value="">Unassigned</option>
              {options?.members.map((member) => (
                <option key={member.id} value={member.id}>
                  {member.label}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col">
            <span className="text-table font-medium text-fg">Due</span>
            <Input type="date" className="mt-1.5" value={due} onChange={(event) => setDue(event.target.value)} />
          </label>
          <label className="flex flex-col">
            <span className="text-table font-medium text-fg">Priority</span>
            <select className={cn(selectClass, "mt-1.5")} value={priority} onChange={(event) => setPriority(event.target.value)}>
              {["LOW", "MEDIUM", "HIGH", "CRITICAL"].map((value) => (
                <option key={value} value={value}>
                  {value.charAt(0) + value.slice(1).toLowerCase()}
                </option>
              ))}
            </select>
          </label>
        </div>
        {error ? <p role="alert" className="mt-2 text-meta text-danger-strong">{error}</p> : null}
        <DialogFooter>
          <Button variant="secondary" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button disabled={pending} onClick={() => (title.trim().length >= 2 ? void onConfirm({ title: title.trim(), assigneeMemberId: assignee || null, dueDate: due || null, priority }) : setError("Give the task a title."))}>
            Create task
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function LinkTaskDialog({ open, options, pending, onClose, onConfirm }: { open: boolean; options: EntryOptions | null; pending: boolean; onClose: () => void; onConfirm: (taskId: string) => Promise<void> }) {
  const [taskId, setTaskId] = React.useState("");
  React.useEffect(() => {
    if (open) setTaskId("");
  }, [open]);
  return (
    <Dialog open={open} onOpenChange={(value) => !value && onClose()}>
      <DialogContent>
        <DialogTitle>Link a task</DialogTitle>
        <DialogDescription>Tasks on this project that you can open.</DialogDescription>
        <select className={cn(selectClass, "mt-4")} value={taskId} onChange={(event) => setTaskId(event.target.value)} aria-label="Task">
          <option value="">Choose a task</option>
          {options?.tasks.map((task) => (
            <option key={task.id} value={task.id}>
              {task.label}
            </option>
          ))}
        </select>
        <DialogFooter>
          <Button variant="secondary" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button disabled={pending || !taskId} onClick={() => void onConfirm(taskId)}>
            Link task
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function LinkRecordDialog({ open, base, pending, onClose, onConfirm }: { open: boolean; base: string; pending: boolean; onClose: () => void; onConfirm: (recordType: string, recordId: string) => Promise<void> }) {
  const [candidates, setCandidates] = React.useState<Array<{ recordType: string; recordId: string; label: string; noun: string; domain: "qaqc" | "hse"; linked: boolean }> | null>(null);
  React.useEffect(() => {
    if (!open) return;
    setCandidates(null);
    void dailyLogApi<typeof candidates>(`${base}/record-links/candidates`).then(setCandidates).catch(() => setCandidates([]));
  }, [open, base]);
  return (
    <Dialog open={open} onOpenChange={(value) => !value && onClose()}>
      <DialogContent>
        <DialogTitle>Link a QA/QC or HSE record</DialogTitle>
        <DialogDescription>Records on this project around the log&apos;s day. Linking changes nothing on the record.</DialogDescription>
        <ul className="mt-4 max-h-80 divide-y divide-line overflow-y-auto">
          {candidates === null ? <li className="py-3 text-table text-fg-muted">Loading…</li> : null}
          {candidates?.length === 0 ? <li className="py-3 text-table text-fg-muted">No records on this project for this day.</li> : null}
          {candidates?.map((candidate) => (
            <li key={`${candidate.recordType}:${candidate.recordId}`} className="flex items-center gap-3 py-2.5">
              <span className="min-w-0 flex-1">
                <span className="block text-table font-medium text-fg">{candidate.label}</span>
                <span className="block text-meta text-fg-muted">{candidate.noun}</span>
              </span>
              <Button size="sm" variant="secondary" disabled={pending || candidate.linked} onClick={() => void onConfirm(candidate.recordType, candidate.recordId)}>
                {candidate.linked ? "Linked" : "Link"}
              </Button>
            </li>
          ))}
        </ul>
        <DialogFooter>
          <Button variant="secondary" onClick={onClose}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
