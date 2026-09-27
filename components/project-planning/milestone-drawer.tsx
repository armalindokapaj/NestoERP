"use client";

import * as React from "react";
import { useTranslations } from "@/components/i18n/i18n-provider";
import Link from "@/components/navigation/nav-link";
import { AlertTriangle, Check, FileText, Link2, Lock, MoreHorizontal, Pencil, Plus, RotateCcw, Upload, X } from "lucide-react";

import { CollaborationPanel } from "@/components/collaboration/collaboration-panel";
import { FavoriteButton } from "@/components/productivity/favorite-button";
import { UPLOAD_IN_FLIGHT, useUploadQueue } from "@/components/documents/upload-queue";
import { selectClass } from "@/components/forms/record-form";
import { PersonLink } from "@/components/people/person-link";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { useDialogClose } from "@/components/ui/dialog";
import { Drawer, DrawerContent, DrawerDescription, DrawerTitle } from "@/components/ui/drawer";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/toast";
import { useUnsavedEditor, type UnsavedEditor } from "@/components/unsaved/use-unsaved";
import { dateLabel } from "@/lib/modules/project-planning/planning.dates";
import type { MilestoneOptions } from "@/lib/modules/project-planning/planning.links";
import {
  BLOCKER_SEVERITIES,
  MILESTONE_STATUSES,
  TASK_LINK_TYPES,
  type BlockerSeverity,
  type MilestoneDetailDTO,
  type MilestoneStatus,
  type Option,
  type TaskLinkType,
} from "@/lib/modules/project-planning/planning.types";
import type { SaveKind, SaveOutcome } from "@/lib/unsaved/coordinator";
import { cn } from "@/lib/utils/cn";
import type { DrawerPanel } from "./milestone-list";
import { MilestoneFormDialog } from "./milestone-form";
import { failureMessage, numberOrRaw, planningApi } from "./planning-api";
import { COMMITTED, failureOutcome, INVALID } from "./use-values-editor";
import { CommittedBadge, CriticalBadge, MilestoneStatusBadge, OwnerName, ProgressBar, useVarianceLabel, Variance } from "./planning-ui";

/**
 * The milestone drawer (PRD #44 §108-§113, §153-§159, §161, §162, §246, §247).
 *
 * Everything about one milestone, in the order it is read: what it is and how
 * it stands against its baseline; a quick update of status, forecast and
 * progress; its dates; what it waits on and what waits on it; its tasks and
 * blockers; the files, meetings and site days behind it; its history and
 * discussion. Every action is offered only when the server would accept it,
 * and each opens inline, so nothing stacks over the drawer on a phone.
 *
 * Unsaved work (AUD-03 §3, §5): the quick update and whichever inline panel is
 * open are editors of their own. Closing the drawer, a link, Back, starting
 * another panel or Cancel asks when either holds input; the quick update and
 * the panels that add something save through Save and continue exactly as
 * their buttons do, while completing, reopening, a baseline change and
 * resolving a blocker are steps only their own button takes.
 */

type Panel = "complete" | "reopen" | "baseline" | "blocker" | "task" | "link-task" | "dependency" | "meeting" | "log" | null;

/** What Save and continue may do for each panel: add a record, or nothing — a step belongs to its button. */
const PANEL_KIND: Record<Exclude<Panel, null>, { saveKind: SaveKind; workflow?: string; label: string }> = {
  complete: { saveKind: "none", workflow: "Complete milestone", label: "Completing the milestone" },
  reopen: { saveKind: "none", workflow: "Reopen milestone", label: "Reopening the milestone" },
  baseline: { saveKind: "none", workflow: "Save baseline", label: "Baseline change" },
  blocker: { saveKind: "create", label: "New blocker" },
  task: { saveKind: "create", label: "New task" },
  "link-task": { saveKind: "create", label: "Task link" },
  dependency: { saveKind: "create", label: "New dependency" },
  meeting: { saveKind: "create", label: "Meeting link" },
  log: { saveKind: "create", label: "Daily log link" },
};

function Section({ title, count, action, children, id }: { title: string; count?: React.ReactNode; action?: React.ReactNode; children: React.ReactNode; id?: string }) {
  return (
    <section className="border-t border-line px-5 py-4" aria-labelledby={id ? `${id}-title` : undefined} data-testid={id ? `drawer-${id}` : undefined}>
      <div className="mb-2 flex items-center gap-2">
        <h3 id={id ? `${id}-title` : undefined} className="text-table font-semibold text-fg">
          {title}
        </h3>
        {count !== undefined ? <span className="text-meta tabular-nums text-fg-muted">{count}</span> : null}
        <span className="flex-1" />
        {action}
      </div>
      {children}
    </section>
  );
}

function InlinePanel({ title, onCancel, children }: { title: string; onCancel: () => void; children: React.ReactNode }) {
  const t = useTranslations("projects");
  return (
    <div className="mt-2 rounded-lg border border-line bg-surface-muted/60 p-3" role="group" aria-label={title}>
      <div className="mb-2 flex items-center justify-between">
        <p className="text-table font-medium text-fg">{title}</p>
        <Button type="button" variant="ghost" size="icon-sm" onClick={onCancel} aria-label={t("drawer.cancel")}>
          <X />
        </Button>
      </div>
      {children}
    </div>
  );
}

function Labeled({ label, htmlFor, children }: { label: string; htmlFor: string; children: React.ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <label htmlFor={htmlFor} className="text-meta font-medium text-fg-muted">
        {label}
      </label>
      {children}
    </div>
  );
}

function OptionSelect({ id, value, onChange, options, placeholder }: { id: string; value: string; onChange: (value: string) => void; options: Array<Option & { disabled?: boolean }>; placeholder: string }) {
  return (
    <select id={id} className={selectClass} value={value} onChange={(event) => onChange(event.target.value)}>
      <option value="">{placeholder}</option>
      {options.map((option) => (
        <option key={option.id} value={option.id} disabled={option.disabled}>
          {option.label}
        </option>
      ))}
    </select>
  );
}

export function MilestoneDrawer({
  milestoneId,
  initialPanel,
  mobile,
  phases,
  members,
  canSetBaseline,
  onClose,
  onChanged,
}: {
  milestoneId: string | null;
  initialPanel: DrawerPanel;
  mobile: boolean;
  phases: Option[];
  members: Option[];
  canSetBaseline: boolean;
  onClose: () => void;
  onChanged: () => void;
}) {
  return (
    <Drawer open={Boolean(milestoneId)} onOpenChange={(open) => !open && onClose()}>
      <DrawerContent side={mobile ? "bottom" : "right"} className={cn("bg-surface", mobile ? "max-h-[92dvh]" : "w-full sm:max-w-[500px]")} data-testid="milestone-drawer" aria-describedby={undefined}>
        {/* Inside the drawer, so closing the drawer is what asks about its editors (AUD-03 §5). */}
        <MilestoneDrawerBody milestoneId={milestoneId} initialPanel={initialPanel} phases={phases} members={members} canSetBaseline={canSetBaseline} onClose={onClose} onChanged={onChanged} />
      </DrawerContent>
    </Drawer>
  );
}

function MilestoneDrawerBody({
  milestoneId,
  initialPanel,
  phases,
  members,
  canSetBaseline,
  onClose,
  onChanged,
}: {
  milestoneId: string | null;
  initialPanel: DrawerPanel;
  phases: Option[];
  members: Option[];
  canSetBaseline: boolean;
  onClose: () => void;
  onChanged: () => void;
}) {
  const t = useTranslations("projects");
  const varianceLabel = useVarianceLabel();
  const toast = useToast();
  const closeDrawer = useDialogClose();
  const [detail, setDetail] = React.useState<MilestoneDetailDTO | null>(null);
  const [loadError, setLoadError] = React.useState<string | null>(null);
  const [options, setOptions] = React.useState<MilestoneOptions | null>(null);
  const [panel, setPanel] = React.useState<Panel>(null);
  const [pending, setPending] = React.useState(false);
  const [editing, setEditing] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [form, setForm] = React.useState<Record<string, string | boolean>>({});
  // What the open panel (or a blocker's resolve line) started with: typing it back is clean again.
  const [formBaseline, setFormBaseline] = React.useState<Record<string, string | boolean>>({});
  const [quick, setQuick] = React.useState<{ status: MilestoneStatus; forecastDate: string; progress: string; reason: string } | null>(null);
  const quickRef = React.useRef<HTMLDivElement>(null);
  const quickDirtyRef = React.useRef(false);

  /**
   * `resetQuick` only when the milestone opens or its quick update was saved:
   * any other refresh keeps an update being typed (AUD-03 §3 rule 6).
   */
  // The milestone on screen now: a read for one opened earlier never lands on it (AUD-07 §6, PS-10).
  const shownId = React.useRef(milestoneId);
  shownId.current = milestoneId;

  const load = React.useCallback(async (id: string, resetQuick = false) => {
    try {
      const next = await planningApi<MilestoneDetailDTO>(`/api/project-milestones/${id}`);
      if (shownId.current !== id) return null;
      const keep = !resetQuick && quickDirtyRef.current;
      setDetail(next);
      setQuick((current) => (keep && current ? current : { status: next.status, forecastDate: next.forecastDate ?? "", progress: next.progressPercent === null ? "" : String(next.progressPercent), reason: "" }));
      setLoadError(null);
      return next;
    } catch (failure) {
      if (shownId.current === id) setLoadError(failureMessage(failure, t("drawer.openFailed")));
      return null;
    }
  }, [t]);

  const loadOptions = React.useCallback(async () => {
    if (options || !milestoneId) return options;
    const next = await planningApi<MilestoneOptions>(`/api/project-milestones/${milestoneId}/options`).catch(() => null);
    if (shownId.current !== milestoneId) return null;
    setOptions(next);
    return next;
  }, [options, milestoneId]);

  React.useEffect(() => {
    setDetail(null);
    setOptions(null);
    setPanel(null);
    setForm({});
    setFormBaseline({});
    setError(null);
    setEditing(false);
    if (!milestoneId) return;
    void load(milestoneId, true).then((next) => {
      if (!next) return;
      // Opening a milestone is returning to it later (PRD #45 §99).
      void planningApi("/api/recent-work/access", { body: { entityType: "project_milestone", entityId: next.id } }).catch(() => undefined);
      const map: Record<Exclude<DrawerPanel, null>, Panel> = { status: null, forecast: null, blocker: "blocker", task: "task", complete: "complete" };
      if (initialPanel && map[initialPanel]) showPanel(map[initialPanel]);
      if (initialPanel === "status" || initialPanel === "forecast") setTimeout(() => quickRef.current?.querySelector<HTMLElement>(initialPanel === "status" ? "select" : "input[type=date]")?.focus(), 250);
    });
    // Re-open when the milestone or the requested action changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [milestoneId, initialPanel]);

  function showPanel(next: Panel) {
    setError(null);
    const start: Record<string, string | boolean> = next === "complete" ? { actualDate: detail?.today ?? "", completionNote: "" } : next === "baseline" ? { newBaselineDate: detail?.baselineDate ?? "", reason: "" } : next === "blocker" ? { severity: "MEDIUM" } : next === "task" || next === "link-task" ? { linkType: "SUPPORTS", priority: "MEDIUM" } : next === "dependency" ? { lagDays: "0" } : {};
    setForm(start);
    setFormBaseline(start);
    setPanel(next);
    if (next && ["blocker", "task", "link-task", "dependency", "meeting", "log"].includes(next)) void loadOptions();
  }

  const persistPanel = React.useRef<() => Promise<SaveOutcome>>(async () => INVALID);
  const panelKind: { saveKind: SaveKind; workflow?: string; label: string } = panel ? PANEL_KIND[panel] : form.blockerId ? { saveKind: "none", workflow: "Resolve", label: "Resolving a blocker" } : { saveKind: "none", label: "Milestone panel" };
  const panelEditor = useUnsavedEditor({ module: "planning", saveKind: panelKind.saveKind, workflow: panelKind.workflow, label: panelKind.label, save: panelKind.saveKind === "none" ? undefined : () => persistPanel.current() });
  const quickEditor = useUnsavedEditor({ module: "planning", saveKind: "save", label: "Milestone update", save: () => saveQuick() });
  const setPanelDirty = panelEditor.setDirty;
  const setQuickDirty = quickEditor.setDirty;
  const panelActive = panel !== null || Boolean(form.blockerId);
  const panelDirty = panelActive && JSON.stringify(form) !== JSON.stringify(formBaseline);
  React.useEffect(() => setPanelDirty(panelDirty), [panelDirty, setPanelDirty]);

  /** Another panel, the resolve line or Cancel replaces what is being typed: asked first. */
  function openPanel(next: Panel) {
    void panelEditor.requestDismiss(() => showPanel(next));
  }

  /**
   * Runs one command. `owner` is the editor whose input it sends: it saves
   * while the request runs, is clean once the server said yes, and holds an
   * unknown outcome when no answer came back (AUD-03 §6). A command that is
   * not the open panel's leaves the panel and what is typed in it alone.
   */
  async function act(run: () => Promise<unknown>, success: string, after?: () => void, owner?: UnsavedEditor): Promise<SaveOutcome> {
    if (!detail) return INVALID;
    setPending(true);
    owner?.setSaving(true);
    setError(null);
    try {
      await run();
      owner?.setUnresolved(false);
      owner?.setDirty(false);
      toast({ title: success, tone: "success" });
      if (owner === panelEditor) setPanel(null);
      after?.();
      setOptions(null);
      await load(detail.id, owner === quickEditor);
      onChanged();
      return COMMITTED;
    } catch (failure) {
      const outcome = failureOutcome(failure);
      owner?.setUnresolved(outcome.kind === "unknown");
      setError(failureMessage(failure));
      if ((failure as { code?: string }).code === "CONFLICT") void load(detail.id);
      return outcome;
    } finally {
      setPending(false);
      owner?.setSaving(false);
    }
  }

  /** The open panel's own command, for its button and for Save and continue alike. */
  persistPanel.current = async () => {
    if (!detail) return INVALID;
    switch (panel) {
      case "complete":
        return act(() => planningApi(`${base}/complete`, { body: { expectedVersion: detail.version, actualDate: text("actualDate") || null, completionNote: text("completionNote") || null } }), t("drawer.completed"), undefined, panelEditor);
      case "reopen":
        if (!text("reason").trim()) return INVALID;
        return act(() => planningApi(`${base}/reopen`, { body: { expectedVersion: detail.version, reason: text("reason") } }), t("drawer.reopened"), undefined, panelEditor);
      case "baseline":
        if (!text("newBaselineDate")) return INVALID;
        return act(() => planningApi(`${base}/baseline`, { body: { expectedVersion: detail.version, newBaselineDate: text("newBaselineDate"), reason: text("reason") || null } }), t("drawer.baselineChanged"), undefined, panelEditor);
      case "dependency":
        if (!text("predecessorMilestoneId")) return INVALID;
        return act(() => planningApi(`${base}/dependencies`, { body: { predecessorMilestoneId: text("predecessorMilestoneId"), lagDays: Number(text("lagDays") || 0) } }), t("drawer.dependencyAdded"), undefined, panelEditor);
      case "link-task":
        if (!text("taskId")) return INVALID;
        return act(() => planningApi(`${base}/tasks`, { body: { taskId: text("taskId"), linkType: text("linkType") as TaskLinkType } }), t("drawer.taskLinked"), undefined, panelEditor);
      case "task":
        if (!text("title").trim()) return INVALID;
        return act(() => planningApi(`${base}/tasks/create`, { body: { title: text("title"), assigneeMemberId: text("assigneeMemberId") || null, dueDate: text("dueDate") || null, priority: "MEDIUM", linkType: "SUPPORTS" } }), t("drawer.taskCreated"), undefined, panelEditor);
      case "blocker":
        if (!text("title").trim()) return INVALID;
        return act(() => planningApi(`${base}/blockers`, { body: { title: text("title"), severity: text("severity") as BlockerSeverity, ownerMemberId: text("ownerMemberId") || null, dueDate: text("dueDate") || null, description: text("description") || null, createTask: form.createTask === true } }), t("drawer.blockerAdded"), undefined, panelEditor);
      case "meeting":
      case "log":
        if (!text("recordId")) return INVALID;
        return act(() => planningApi(`${base}/${panel === "meeting" ? "meetings" : "daily-logs"}`, { body: { recordId: text("recordId") } }), t("drawer.linked"), undefined, panelEditor);
      default: {
        const blockerId = typeof form.blockerId === "string" ? form.blockerId : null;
        if (!blockerId) return INVALID;
        return act(() => planningApi(`/api/project-milestone-blockers/${blockerId}/resolve`, { body: { resolutionNote: text("resolutionNote") || null } }), t("drawer.blockerResolved"), () => { setForm({}); setFormBaseline({}); }, panelEditor);
      }
    }
  };
  const submitPanel = () => void persistPanel.current();

  function saveQuick(): Promise<SaveOutcome> {
    if (!detail || !quick) return Promise.resolve(INVALID);
    return act(
      () =>
        planningApi(`${base}/quick-update`, {
          body: {
            expectedVersion: detail.version,
            status: quick.status,
            forecastDate: quick.forecastDate || null,
            progressPercent: numberOrRaw(quick.progress),
            forecastReason: quick.reason || null,
          },
        }),
      t("drawer.updated"),
      undefined,
      quickEditor,
    );
  }

  const base = detail ? `/api/project-milestones/${detail.id}` : "";
  const caps = detail?.capabilities;
  const text = (key: string) => (typeof form[key] === "string" ? (form[key] as string) : "");
  const setField = (key: string, value: string | boolean) => setForm((current) => ({ ...current, [key]: value }));

  const upload = useUploadQueue({
    parent: { context: "record", entityType: "project_milestone", entityId: milestoneId ?? undefined },
    onUploaded: () => {
      if (detail) void load(detail.id);
    },
  });
  const uploading = upload.items.some((item) => UPLOAD_IN_FLIGHT.includes(item.status));
  const fileRef = React.useRef<HTMLInputElement>(null);

  const quickDirty = Boolean(detail && quick && (quick.status !== detail.status || quick.forecastDate !== (detail.forecastDate ?? "") || quick.progress !== (detail.progressPercent === null ? "" : String(detail.progressPercent))));
  quickDirtyRef.current = quickDirty;
  // Before, the drawer closed over a changed status without a word (AUD-03 §5).
  React.useEffect(() => setQuickDirty(quickDirty), [quickDirty, setQuickDirty]);

  return (
    <>
        {!detail ? (
          <div className="p-6">
            <DrawerTitle className="text-card font-semibold text-fg">{loadError ? t("drawer.unavailable") : t("drawer.loading")}</DrawerTitle>
            {loadError ? <p className="mt-2 text-table text-fg-muted">{loadError}</p> : <div className="mt-4 space-y-2">{[0, 1, 2].map((key) => <div key={key} className="h-4 animate-pulse rounded bg-line" />)}</div>}
          </div>
        ) : (
          <>
            {/* Header (§110) */}
            <header className="sticky top-0 z-10 border-b border-line bg-surface px-5 pb-4 pt-5">
              <div className="flex items-start gap-2">
                <div className="min-w-0 flex-1">
                  <p className="text-meta uppercase tracking-wide text-fg-subtle">
                    {t(`milestoneType.${detail.type}`)}
                    {detail.phase ? ` · ${detail.phase.name}` : ""}
                  </p>
                  <DrawerTitle className="mt-0.5 text-section font-semibold text-fg" data-testid="drawer-milestone-name">
                    {detail.name}
                  </DrawerTitle>
                  <DrawerDescription className="sr-only">{t("drawer.srDescription")}</DrawerDescription>
                  <div className="mt-2 flex flex-wrap items-center gap-1.5">
                    <MilestoneStatusBadge status={detail.status} delayed={detail.delayed} />
                    {detail.critical ? <CriticalBadge /> : null}
                    {detail.externallyCommitted ? <CommittedBadge /> : null}
                    {detail.waitingOn ? <span className="text-meta text-fg-muted">Waiting on {detail.waitingOn}</span> : null}
                  </div>
                </div>
                <FavoriteButton key={`favorite-${detail.id}`} entityType="project_milestone" entityId={detail.id} initial={detail.favorite} compact />
                {caps?.canEdit || caps?.canArchive ? (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button type="button" variant="ghost" size="icon-sm" aria-label={t("drawer.moreActions")}>
                        <MoreHorizontal />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      {caps.canEdit ? <DropdownMenuItem onSelect={() => setEditing(true)}>{t("drawer.edit")}</DropdownMenuItem> : null}
                      {caps.canArchive ? (
                        <DropdownMenuItem onSelect={() => void act(() => planningApi(base, { method: "DELETE" }), t("drawer.archived"), onClose)} className="text-danger-strong">
                          {t("drawer.archive")}
                        </DropdownMenuItem>
                      ) : null}
                    </DropdownMenuContent>
                  </DropdownMenu>
                ) : null}
                <Button type="button" variant="ghost" size="icon-sm" onClick={closeDrawer} aria-label={t("drawer.close")}>
                  <X />
                </Button>
              </div>
              <dl className="mt-4 grid grid-cols-3 gap-3">
                <div>
                  <dt className="text-meta text-fg-subtle">{detail.status === "COMPLETED" ? t("drawer.actual") : t("drawer.forecast")}</dt>
                  <dd className="text-table font-semibold tabular-nums text-fg" data-testid="drawer-forecast">
                    {dateLabel(detail.status === "COMPLETED" ? detail.actualDate : (detail.forecastDate ?? detail.plannedDate))}
                  </dd>
                </div>
                <div>
                  <dt className="text-meta text-fg-subtle">{t("drawer.baseline")}</dt>
                  <dd className="text-table tabular-nums text-fg">{dateLabel(detail.baselineDate)}</dd>
                </div>
                <div>
                  <dt className="text-meta text-fg-subtle">{t("drawer.variance")}</dt>
                  <dd className="text-table font-medium">
                    <Variance days={detail.varianceDays} />
                  </dd>
                </div>
              </dl>
              <div className="mt-3 flex flex-wrap gap-2">
                {caps?.canComplete ? (
                  <Button type="button" size="sm" onClick={() => openPanel("complete")}>
                    <Check /> Mark complete
                  </Button>
                ) : null}
                {caps?.canReopen ? (
                  <Button type="button" size="sm" variant="secondary" onClick={() => openPanel("reopen")}>
                    <RotateCcw /> Reopen
                  </Button>
                ) : null}
                {caps?.canEdit ? (
                  <Button type="button" size="sm" variant="secondary" onClick={() => setEditing(true)}>
                    <Pencil /> Edit
                  </Button>
                ) : null}
              </div>
              {panel === "complete" ? (
                <InlinePanel title={t("drawer.markComplete")} onCancel={() => void panelEditor.requestDismiss(() => setPanel(null))}>
                  <div className="grid gap-2">
                    <Labeled label={t("drawer.actualDate")} htmlFor="complete-date">
                      <Input id="complete-date" type="date" value={text("actualDate")} max={detail.today} onChange={(event) => setField("actualDate", event.target.value)} />
                    </Labeled>
                    <Labeled label={t("drawer.completionNote")} htmlFor="complete-note">
                      <Textarea id="complete-note" rows={2} value={text("completionNote")} onChange={(event) => setField("completionNote", event.target.value)} maxLength={2000} />
                    </Labeled>
                    <p className="text-meta text-fg-subtle">{t("drawer.tasksUnchanged")}</p>
                    <Button type="button" size="sm" disabled={pending} onClick={submitPanel}>
                      {t("drawer.complete")}
                    </Button>
                  </div>
                </InlinePanel>
              ) : null}
              {panel === "reopen" ? (
                <InlinePanel title={t("drawer.reopen")} onCancel={() => void panelEditor.requestDismiss(() => setPanel(null))}>
                  <Labeled label={t("drawer.reason")} htmlFor="reopen-reason">
                    <Textarea id="reopen-reason" rows={2} value={text("reason")} onChange={(event) => setField("reason", event.target.value)} maxLength={2000} />
                  </Labeled>
                  <Button type="button" size="sm" className="mt-2" disabled={pending || !text("reason").trim()} onClick={submitPanel}>
                    {t("drawer.reopen")}
                  </Button>
                </InlinePanel>
              ) : null}
              {error && (panel === "complete" || panel === "reopen" || panel === null) ? (
                <p role="alert" className="mt-2 rounded-md bg-danger-soft px-3 py-2 text-table text-danger-strong">
                  {error}
                </p>
              ) : null}
            </header>

            {/* Warnings and suggestions (§43, §161, §162) */}
            {detail.dependencyWarning || detail.suggestion.forecastDate || (detail.suggestion.atRisk.length && detail.status !== "AT_RISK") ? (
              <div className="space-y-2 px-5 py-3">
                {detail.dependencyWarning ? (
                  <p className="flex items-start gap-2 rounded-md bg-warning-soft px-3 py-2 text-table text-warning-strong" data-testid="dependency-warning">
                    <Link2 aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
                    {detail.dependencyWarning}
                  </p>
                ) : null}
                {detail.suggestion.forecastDate && caps?.canEdit ? (
                  <p className="flex flex-wrap items-center gap-2 text-table text-fg-muted">
                    {t("drawer.predecessorsSuggest")} <span className="font-medium text-fg">{dateLabel(detail.suggestion.forecastDate)}</span>.
                    <Button type="button" variant="link" size="sm" className="h-auto px-0" disabled={pending} onClick={() => void act(() => planningApi(`${base}/quick-update`, { body: { expectedVersion: detail.version, forecastDate: detail.suggestion.forecastDate, forecastReason: "Follows its predecessors" } }), t("drawer.forecastUpdated"))}>
                      {t("drawer.useIt")}
                    </Button>
                  </p>
                ) : null}
                {detail.suggestion.atRisk.length && detail.status !== "AT_RISK" && detail.status !== "COMPLETED" && detail.status !== "CANCELLED" ? (
                  <p className="flex items-start gap-2 text-table text-fg-muted">
                    <AlertTriangle aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-warning-strong" />
                    <span>{t("drawer.mightBeAtRisk", { reasons: detail.suggestion.atRisk.join("; ") })}</span>
                  </p>
                ) : null}
              </div>
            ) : null}

            {/* Quick update (§111, §119, §247) */}
            {caps?.canEdit && detail.status !== "COMPLETED" && quick ? (
              <Section title={t("drawer.update")} id="quick-update">
                <div ref={quickRef} className="grid gap-3 sm:grid-cols-3">
                  <Labeled label={t("drawer.status")} htmlFor="quick-status">
                    <select id="quick-status" className={selectClass} value={quick.status} onChange={(event) => setQuick({ ...quick, status: event.target.value as MilestoneStatus })}>
                      {MILESTONE_STATUSES.filter((status) => status !== "COMPLETED").map((status) => (
                        <option key={status} value={status}>
                          {t(`milestoneStatus.${status}`)}
                        </option>
                      ))}
                    </select>
                  </Labeled>
                  <Labeled label={t("drawer.forecastDate")} htmlFor="quick-forecast">
                    <Input id="quick-forecast" type="date" value={quick.forecastDate} onChange={(event) => setQuick({ ...quick, forecastDate: event.target.value })} />
                  </Labeled>
                  <Labeled label={t("drawer.progressPercent")} htmlFor="quick-progress">
                    <Input id="quick-progress" type="number" min={0} max={100} inputMode="numeric" value={quick.progress} onChange={(event) => setQuick({ ...quick, progress: event.target.value })} />
                  </Labeled>
                </div>
                {quick.forecastDate !== (detail.forecastDate ?? "") ? (
                  <div className="mt-2">
                    <Labeled label={t("drawer.whyMoved")} htmlFor="quick-reason">
                      <Input id="quick-reason" value={quick.reason} onChange={(event) => setQuick({ ...quick, reason: event.target.value })} maxLength={2000} />
                    </Labeled>
                  </div>
                ) : null}
                {quickDirty ? (
                  <div className="mt-3 flex gap-2">
                    <Button
                      type="button"
                      size="sm"
                      disabled={pending}
                      onClick={() => void saveQuick()}
                    >
                      {t("drawer.saveUpdate")}
                    </Button>
                    <Button type="button" size="sm" variant="ghost" onClick={() => void quickEditor.requestDismiss(() => setQuick({ status: detail.status, forecastDate: detail.forecastDate ?? "", progress: detail.progressPercent === null ? "" : String(detail.progressPercent), reason: "" }))}>
                      {t("drawer.discard")}
                    </Button>
                  </div>
                ) : null}
              </Section>
            ) : null}

            {/* Dates, owner, progress (§15-§20, §47) */}
            <Section
              title={t("drawer.dates")}
              id="dates"
              action={
                caps?.canChangeBaseline ? (
                  <Button type="button" variant="ghost" size="sm" onClick={() => openPanel("baseline")}>
                    {detail.baselineDate ? t("drawer.changeBaseline") : t("drawer.setBaseline")}
                  </Button>
                ) : detail.baselineLocked ? (
                  <span className="flex items-center gap-1 text-meta text-fg-muted">
                    <Lock aria-hidden="true" className="size-3.5" /> {t("drawer.baselineLocked")}
                  </span>
                ) : null
              }
            >
              <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-table">
                {[
                  [t("drawer.baseline"), detail.baselineDate],
                  [t("drawer.planned"), detail.plannedDate],
                  [t("drawer.forecast"), detail.forecastDate],
                  [t("drawer.actual"), detail.actualDate],
                ].map(([label, value]) => (
                  <div key={label} className="flex justify-between gap-2 border-b border-line/60 pb-1.5">
                    <dt className="text-fg-muted">{label}</dt>
                    <dd className="tabular-nums text-fg">{dateLabel(value)}</dd>
                  </div>
                ))}
              </dl>
              {panel === "baseline" ? (
                <InlinePanel title={detail.baselineDate ? t("drawer.changeBaseline") : t("drawer.setBaseline")} onCancel={() => void panelEditor.requestDismiss(() => setPanel(null))}>
                  <div className="grid gap-2">
                    <Labeled label={t("drawer.newBaselineDate")} htmlFor="baseline-date">
                      <Input id="baseline-date" type="date" value={text("newBaselineDate")} onChange={(event) => setField("newBaselineDate", event.target.value)} />
                    </Labeled>
                    <Labeled label={detail.baselineDate && detail.baselineReasonRequired ? t("drawer.reason") : t("drawer.reasonOptional")} htmlFor="baseline-reason">
                      <Textarea id="baseline-reason" rows={2} value={text("reason")} onChange={(event) => setField("reason", event.target.value)} maxLength={2000} />
                    </Labeled>
                    <p className="text-meta text-fg-subtle">{t("drawer.baselineAudit")}</p>
                    {error ? <p role="alert" className="text-table text-danger-strong">{error}</p> : null}
                    <Button type="button" size="sm" disabled={pending || !text("newBaselineDate")} onClick={submitPanel}>
                      {t("drawer.saveBaseline")}
                    </Button>
                  </div>
                </InlinePanel>
              ) : null}
              <dl className="mt-3 grid grid-cols-2 gap-3 text-table">
                <div>
                  <dt className="text-meta text-fg-subtle">{t("drawer.owner")}</dt>
                  <dd className="text-fg">
                    <OwnerName owner={detail.owner} />
                  </dd>
                </div>
                <div>
                  <dt className="text-meta text-fg-subtle">{t("drawer.progress")}</dt>
                  <dd className="flex items-center gap-2">
                    <ProgressBar value={detail.progressPercent} label={t("drawer.milestoneProgress")} className="w-20" />
                    <span className="tabular-nums text-fg">{detail.progressPercent === null ? "—" : `${Math.round(detail.progressPercent)}%`}</span>
                  </dd>
                </div>
              </dl>
              {detail.description ? <p className="mt-3 whitespace-pre-wrap text-table text-fg-muted">{detail.description}</p> : null}
              {detail.completionNote && detail.status === "COMPLETED" ? (
                <p className="mt-3 text-table text-fg-muted">
                  <span className="font-medium text-fg">Completed{detail.completedBy ? <> by <PersonLink memberId={detail.completedBy.memberId} name={detail.completedBy.name} /></> : null}:</span> {detail.completionNote}
                </p>
              ) : null}
            </Section>

            {/* Dependencies (§158, §159) */}
            <Section
              title={t("drawer.dependencies")}
              id="dependencies"
              action={
                caps?.canManageDependencies ? (
                  <Button type="button" variant="ghost" size="sm" onClick={() => openPanel("dependency")}>
                    <Plus /> {t("drawer.dependsOn")}
                  </Button>
                ) : null
              }
            >
              {!detail.predecessors.length && !detail.successors.length ? <p className="text-table text-fg-subtle">{t("drawer.noDependencies")}</p> : null}
              {[
                { label: t("drawer.dependsOn"), rows: detail.predecessors },
                { label: t("drawer.blocks"), rows: detail.successors },
              ].map((group) =>
                group.rows.length ? (
                  <div key={group.label} className="mb-2">
                    <p className="text-meta font-medium text-fg-muted">{group.label}</p>
                    <ul className="mt-1 divide-y divide-line/60">
                      {group.rows.map((row) => (
                        <li key={row.dependencyId} className="flex items-center gap-2 py-1.5 text-table" data-testid="dependency-row">
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-fg">{row.name}</span>
                            <span className="text-meta text-fg-muted">
                              {row.delayed ? <span className="text-danger-strong">{t("drawer.daysLate", { count: row.overdueDays })}</span> : t(`milestoneStatus.${row.status}`)} · {dateLabel(row.targetDate)}
                              {row.lagDays ? ` · ${row.lagDays}d lag` : ""}
                            </span>
                          </span>
                          {caps?.canManageDependencies ? (
                            <Button type="button" variant="ghost" size="icon-sm" aria-label={t("drawer.removeDependency", { name: row.name })} onClick={() => void act(() => planningApi(`${base}/dependencies/${row.dependencyId}`, { method: "DELETE" }), "Dependency removed")}>
                              <X />
                            </Button>
                          ) : null}
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null,
              )}
              {panel === "dependency" ? (
                <InlinePanel title={t("drawer.addDependencyTitle")} onCancel={() => void panelEditor.requestDismiss(() => setPanel(null))}>
                  <div className="grid gap-2 sm:grid-cols-[1fr_6rem]">
                    <Labeled label={t("drawer.predecessor")} htmlFor="dependency-milestone">
                      <OptionSelect id="dependency-milestone" value={text("predecessorMilestoneId")} onChange={(value) => setField("predecessorMilestoneId", value)} options={(options?.milestones ?? []).map((row) => ({ id: row.id, label: `${row.label} · ${row.status}`, disabled: row.blocked }))} placeholder={options ? t("drawer.chooseMilestone") : t("drawer.loadingShort")} />
                    </Labeled>
                    <Labeled label={t("drawer.lag")} htmlFor="dependency-lag">
                      <Input id="dependency-lag" type="number" min={0} inputMode="numeric" value={text("lagDays")} onChange={(event) => setField("lagDays", event.target.value)} />
                    </Labeled>
                  </div>
                  {error ? <p role="alert" className="mt-2 text-table text-danger-strong">{error}</p> : null}
                  <Button type="button" size="sm" className="mt-2" disabled={pending || !text("predecessorMilestoneId")} onClick={submitPanel}>
                    {t("drawer.addDependency")}
                  </Button>
                </InlinePanel>
              ) : null}
            </Section>

            {/* Tasks (§49-§55) */}
            <Section
              title={t("drawer.tasks")}
              id="tasks"
              count={detail.taskStats.total ? t("drawer.tasksComplete", { done: detail.taskStats.completed, total: detail.taskStats.total }) : undefined}
              action={
                <span className="flex gap-1">
                  {caps?.canLinkTasks ? (
                    <Button type="button" variant="ghost" size="sm" onClick={() => openPanel("link-task")}>
                      <Link2 /> {t("drawer.link")}
                    </Button>
                  ) : null}
                  {caps?.canCreateTask ? (
                    <Button type="button" variant="ghost" size="sm" onClick={() => openPanel("task")}>
                      <Plus /> {t("drawer.createTask")}
                    </Button>
                  ) : null}
                </span>
              }
            >
              {detail.tasks.length ? (
                <ul className="divide-y divide-line/60">
                  {detail.tasks.map((task) => (
                    <li key={task.taskId} className="flex items-center gap-2 py-1.5 text-table" data-testid="milestone-task">
                      <span className="min-w-0 flex-1">
                        {task.href ? (
                          <Link href={task.href} className="block truncate text-fg hover:text-accent-strong">
                            {task.title}
                          </Link>
                        ) : (
                          <span className="block truncate text-fg-muted">{task.title}</span>
                        )}
                        <span className="text-meta text-fg-muted">
                          {t(`taskLink.${task.linkType}`)}
                          {task.status ? ` · ${task.status.replace("_", " ").toLowerCase()}` : ""}
                        </span>
                      </span>
                      {caps?.canLinkTasks ? (
                        <Button type="button" variant="ghost" size="icon-sm" aria-label={t("drawer.unlink", { name: task.title })} onClick={() => void act(() => planningApi(`${base}/tasks/${task.taskId}`, { method: "DELETE" }), t("drawer.taskUnlinked"))}>
                          <X />
                        </Button>
                      ) : null}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-table text-fg-subtle">{t("drawer.noTasks")}</p>
              )}
              {panel === "link-task" ? (
                <InlinePanel title={t("drawer.linkTask")} onCancel={() => void panelEditor.requestDismiss(() => setPanel(null))}>
                  <div className="grid gap-2 sm:grid-cols-[1fr_8rem]">
                    <Labeled label={t("drawer.task")} htmlFor="link-task">
                      <OptionSelect id="link-task" value={text("taskId")} onChange={(value) => setField("taskId", value)} options={(options?.tasks ?? []).map((row) => ({ id: row.id, label: row.label, disabled: row.linked }))} placeholder={options ? t("drawer.chooseTask") : t("drawer.loadingShort")} />
                    </Labeled>
                    <Labeled label={t("drawer.relationship")} htmlFor="link-task-type">
                      <select id="link-task-type" className={selectClass} value={text("linkType")} onChange={(event) => setField("linkType", event.target.value)}>
                        {TASK_LINK_TYPES.map((type) => (
                          <option key={type} value={type}>
                            {t(`taskLink.${type}`)}
                          </option>
                        ))}
                      </select>
                    </Labeled>
                  </div>
                  {error ? <p role="alert" className="mt-2 text-table text-danger-strong">{error}</p> : null}
                  <Button type="button" size="sm" className="mt-2" disabled={pending || !text("taskId")} onClick={submitPanel}>
                    {t("drawer.linkTaskButton")}
                  </Button>
                </InlinePanel>
              ) : null}
              {panel === "task" ? (
                <InlinePanel title={t("drawer.createTaskTitle")} onCancel={() => void panelEditor.requestDismiss(() => setPanel(null))}>
                  <div className="grid gap-2">
                    <Labeled label={t("drawer.title")} htmlFor="task-title">
                      <Input id="task-title" value={text("title")} onChange={(event) => setField("title", event.target.value)} maxLength={200} />
                    </Labeled>
                    <div className="grid gap-2 sm:grid-cols-2">
                      <Labeled label={t("drawer.assignee")} htmlFor="task-assignee">
                        <OptionSelect id="task-assignee" value={text("assigneeMemberId")} onChange={(value) => setField("assigneeMemberId", value)} options={options?.members ?? members} placeholder={t("drawer.unassigned")} />
                      </Labeled>
                      <Labeled label={t("drawer.dueDate")} htmlFor="task-due">
                        <Input id="task-due" type="date" value={text("dueDate")} onChange={(event) => setField("dueDate", event.target.value)} />
                      </Labeled>
                    </div>
                    {error ? <p role="alert" className="text-table text-danger-strong">{error}</p> : null}
                    <Button type="button" size="sm" disabled={pending || !text("title").trim()} onClick={submitPanel}>
                      {t("drawer.saveTask")}
                    </Button>
                  </div>
                </InlinePanel>
              ) : null}
            </Section>

            {/* Blockers (§153-§157) */}
            <Section
              title={t("drawer.blockers")}
              id="blockers"
              count={detail.blockers.filter((blocker) => !blocker.resolvedAt).length || undefined}
              action={
                caps?.canManageBlockers ? (
                  <Button type="button" variant="ghost" size="sm" onClick={() => openPanel("blocker")}>
                    <Plus /> {t("drawer.addBlocker")}
                  </Button>
                ) : null
              }
            >
              {panel === "blocker" ? (
                <InlinePanel title={t("drawer.addBlockerTitle")} onCancel={() => void panelEditor.requestDismiss(() => setPanel(null))}>
                  <div className="grid gap-2">
                    <Labeled label={t("drawer.title")} htmlFor="blocker-title">
                      <Input id="blocker-title" value={text("title")} onChange={(event) => setField("title", event.target.value)} maxLength={200} />
                    </Labeled>
                    <div className="grid gap-2 sm:grid-cols-3">
                      <Labeled label={t("drawer.severity")} htmlFor="blocker-severity">
                        <select id="blocker-severity" className={selectClass} value={text("severity")} onChange={(event) => setField("severity", event.target.value)}>
                          {BLOCKER_SEVERITIES.map((severity) => (
                            <option key={severity} value={severity}>
                              {t(`severity.${severity}`)}
                            </option>
                          ))}
                        </select>
                      </Labeled>
                      <Labeled label={t("drawer.owner")} htmlFor="blocker-owner">
                        <OptionSelect id="blocker-owner" value={text("ownerMemberId")} onChange={(value) => setField("ownerMemberId", value)} options={options?.members ?? members} placeholder={t("drawer.unassigned")} />
                      </Labeled>
                      <Labeled label={t("drawer.dueDate")} htmlFor="blocker-due">
                        <Input id="blocker-due" type="date" value={text("dueDate")} onChange={(event) => setField("dueDate", event.target.value)} />
                      </Labeled>
                    </div>
                    <Labeled label={t("drawer.descriptionOptional")} htmlFor="blocker-description">
                      <Textarea id="blocker-description" rows={2} value={text("description")} onChange={(event) => setField("description", event.target.value)} maxLength={5000} />
                    </Labeled>
                    {caps?.canCreateTask ? (
                      <label className="flex items-center gap-2 text-table text-fg">
                        <Checkbox checked={form.createTask === true} onCheckedChange={(checked) => setField("createTask", checked === true)} aria-label={t("drawer.alsoTask")} />
                        {t("drawer.alsoTaskFor")}
                      </label>
                    ) : null}
                    {error ? <p role="alert" className="text-table text-danger-strong">{error}</p> : null}
                    <Button
                      type="button"
                      size="sm"
                      disabled={pending || !text("title").trim()}
                      onClick={submitPanel}
                    >
                      {t("drawer.saveBlocker")}
                    </Button>
                  </div>
                </InlinePanel>
              ) : null}
              {detail.blockers.length ? (
                <ul className="space-y-2">
                  {detail.blockers.map((blocker) => (
                    <li key={blocker.id} className={cn("rounded-md border px-3 py-2", blocker.resolvedAt ? "border-line bg-surface-muted/50" : blocker.severity === "CRITICAL" ? "border-danger/40 bg-danger-soft/40" : "border-line")} data-testid="milestone-blocker">
                      <div className="flex items-start gap-2">
                        <span className="min-w-0 flex-1">
                          <span className={cn("block text-table font-medium", blocker.resolvedAt ? "text-fg-muted line-through decoration-fg-subtle/50" : "text-fg")}>{blocker.title}</span>
                          <span className="text-meta text-fg-muted">
                            {t(`severity.${blocker.severity}`)}
                            {blocker.owner ? <> · <PersonLink memberId={blocker.owner.memberId} name={blocker.owner.name} /></> : null}
                            {blocker.dueDate ? t("drawer.due", { date: dateLabel(blocker.dueDate) }) : ""}
                            {blocker.overdue ? <span className="text-danger-strong">{t("drawer.overdue")}</span> : null}
                            {blocker.resolvedAt ? <>{t("drawer.resolved")}{blocker.resolvedBy ? <> {t("drawer.by")} <PersonLink memberId={blocker.resolvedBy.memberId} name={blocker.resolvedBy.name} /></> : null}</> : null}
                          </span>
                          {blocker.linkedTask ? (
                            <span className="block text-meta">
                              {blocker.linkedTask.href ? (
                                <Link href={blocker.linkedTask.href} className="text-accent-strong hover:underline">
                                  {t("drawer.taskPrefix", { title: blocker.linkedTask.title })}
                                </Link>
                              ) : (
                                <span className="text-fg-muted">{blocker.linkedTask.title}</span>
                              )}
                            </span>
                          ) : null}
                          {blocker.resolutionNote ? <span className="block text-meta text-fg-muted">{blocker.resolutionNote}</span> : null}
                        </span>
                        {!blocker.resolvedAt && caps?.canManageBlockers ? (
                          <Button type="button" variant="secondary" size="sm" onClick={() =>
                              void panelEditor.requestDismiss(() => {
                                const start = { blockerId: blocker.id, resolutionNote: "" };
                                setForm(start);
                                setFormBaseline(start);
                                setPanel(null);
                              })
                            }>
                            {t("drawer.resolve")}
                          </Button>
                        ) : null}
                      </div>
                      {form.blockerId === blocker.id && !panel ? (
                        <div className="mt-2 flex flex-col gap-2 sm:flex-row">
                          <Input aria-label={t("drawer.resolutionNote")} placeholder={t("drawer.resolutionPlaceholder")} value={text("resolutionNote")} onChange={(event) => setField("resolutionNote", event.target.value)} maxLength={2000} />
                          <Button type="button" size="sm" className="h-10" disabled={pending} onClick={submitPanel}>
                            {t("drawer.confirmResolve")}
                          </Button>
                        </div>
                      ) : null}
                    </li>
                  ))}
                </ul>
              ) : panel !== "blocker" ? (
                <p className="text-table text-fg-subtle">{t("drawer.noBlockers")}</p>
              ) : null}
            </Section>

            {/* Documents (§57-§59, §182) */}
            {caps?.canViewDocuments ? (
              <Section
                title={t("drawer.documents")}
                id="documents"
                count={detail.documents?.length || undefined}
                action={
                  caps.canUploadDocuments ? (
                    <>
                      <input ref={fileRef} type="file" multiple className="sr-only" aria-label={t("drawer.uploadDocuments")} onChange={(event) => { if (event.target.files?.length) upload.enqueue([...event.target.files], (file) => ({ name: file.name })); event.target.value = ""; }} />
                      <Button type="button" variant="ghost" size="sm" onClick={() => fileRef.current?.click()} disabled={uploading}>
                        <Upload /> {uploading ? t("drawer.uploading") : t("drawer.upload")}
                      </Button>
                    </>
                  ) : null
                }
              >
                {detail.documents?.length ? (
                  <ul className="divide-y divide-line/60">
                    {detail.documents.map((document) => (
                      <li key={document.documentId} className="flex items-center gap-2 py-1.5 text-table">
                        <FileText aria-hidden="true" className="size-4 shrink-0 text-fg-subtle" />
                        <Link href={document.href} className="min-w-0 flex-1 truncate text-fg hover:text-accent-strong">
                          {document.name}
                        </Link>
                        <span className="shrink-0 text-meta text-fg-muted">{document.uploadedBy ? <PersonLink memberId={document.uploadedByMemberId} name={document.uploadedBy} /> : null}</span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-table text-fg-subtle">{t("drawer.noDocuments")}</p>
                )}
              </Section>
            ) : null}

            {/* Meetings and daily logs (§60-§64) */}
            {[
              { key: "meetings" as const, title: t("drawer.meetings"), linkTitle: t("drawer.linkMeeting"), rows: detail.meetings, can: caps?.canLinkMeetings, panelKey: "meeting" as const, endpoint: "meetings", choices: options?.meetings, empty: t("drawer.noMeetings") },
              { key: "dailyLogs" as const, title: t("drawer.dailyLogs"), linkTitle: t("drawer.linkDailyLog"), rows: detail.dailyLogs, can: caps?.canLinkDailyLogs, panelKey: "log" as const, endpoint: "daily-logs", choices: options?.dailyLogs, empty: t("drawer.noDailyLogs") },
            ].map((group) =>
              group.rows.length || group.can ? (
                <Section
                  key={group.key}
                  title={group.title}
                  id={group.key}
                  count={group.rows.length || undefined}
                  action={
                    group.can ? (
                      <Button type="button" variant="ghost" size="sm" onClick={() => openPanel(group.panelKey)}>
                        <Link2 /> {t("drawer.link")}
                      </Button>
                    ) : null
                  }
                >
                  {group.rows.length ? (
                    <ul className="divide-y divide-line/60">
                      {group.rows.map((row) => (
                        <li key={row.linkId} className="flex items-center gap-2 py-1.5 text-table">
                          {row.href ? (
                            <Link href={row.href} className="min-w-0 flex-1 truncate text-fg hover:text-accent-strong">
                              {row.label}
                            </Link>
                          ) : (
                            <span className="min-w-0 flex-1 truncate text-fg-muted">{row.label}</span>
                          )}
                          {group.can ? (
                            <Button type="button" variant="ghost" size="icon-sm" aria-label={t("drawer.unlink", { name: row.label })} onClick={() => void act(() => planningApi(`${base}/links/${row.linkId}`, { method: "DELETE" }), t("drawer.linkRemoved"))}>
                              <X />
                            </Button>
                          ) : null}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-table text-fg-subtle">{group.empty}</p>
                  )}
                  {panel === group.panelKey ? (
                    <InlinePanel title={group.linkTitle} onCancel={() => void panelEditor.requestDismiss(() => setPanel(null))}>
                      <OptionSelect id={`link-${group.key}`} value={text("recordId")} onChange={(value) => setField("recordId", value)} options={(group.choices ?? []).map((row) => ({ id: row.id, label: row.label, disabled: row.linked }))} placeholder={options ? t("drawer.chooseFromProject") : t("drawer.loadingShort")} />
                      {error ? <p role="alert" className="mt-2 text-table text-danger-strong">{error}</p> : null}
                      <Button type="button" size="sm" className="mt-2" disabled={pending || !text("recordId")} onClick={submitPanel}>
                        {t("drawer.saveLink")}
                      </Button>
                    </InlinePanel>
                  ) : null}
                </Section>
              ) : null,
            )}

            {/* Activity and discussion (§178-§181, §210) */}
            <Section title={t("drawer.activity")} id="activity">
              {detail.history.length ? (
                <ul className="space-y-2">
                  {detail.history.map((entry) => (
                    <li key={entry.id} className="text-table">
                      <span className="font-medium text-fg">{entry.action}</span>
                      <span className="text-meta text-fg-muted">
                        {" "}
                        · {entry.actorName ? <PersonLink memberId={entry.actorMemberId} name={entry.actorName} /> : "NESTO"} · {dateLabel(entry.occurredAt.slice(0, 10))}
                      </span>
                      {entry.note ? <span className="block text-meta text-fg-muted">{entry.note}</span> : null}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-table text-fg-subtle">{t("drawer.nothingNotable")}</p>
              )}
              <div className="mt-4">
                <CollaborationPanel key={`discussion-${detail.id}`} parentType="project_milestone" parentId={detail.id} />
              </div>
            </Section>

            <p className="px-5 pb-6 pt-2 text-meta text-fg-subtle">
              {varianceLabel(detail.varianceDays)}{t("drawer.created", { date: dateLabel(detail.createdAt.slice(0, 10)) })}
              {detail.createdBy ? <> {t("drawer.by")} <PersonLink memberId={detail.createdBy.memberId} name={detail.createdBy.name} /></> : null}
            </p>

            <MilestoneFormDialog
              open={editing}
              onOpenChange={setEditing}
              projectId={detail.project.id}
              milestoneId={detail.id}
              version={detail.version}
              phases={phases}
              members={members}
              canSetBaseline={canSetBaseline}
              initial={{
                name: detail.name,
                phaseId: detail.phaseId ?? "",
                milestoneType: detail.type,
                ownerMemberId: detail.owner?.memberId ?? "",
                baselineDate: detail.baselineDate ?? "",
                plannedDate: detail.plannedDate ?? "",
                forecastDate: detail.forecastDate ?? "",
                actualDate: detail.actualDate ?? "",
                status: detail.status,
                progressPercent: detail.progressPercent === null ? "" : String(detail.progressPercent),
                critical: detail.critical,
                externallyCommitted: detail.externallyCommitted,
                description: detail.description ?? "",
              }}
              onSaved={() => {
                toast({ title: t("drawer.saved"), tone: "success" });
                void load(detail.id);
                onChanged();
              }}
            />
          </>
        )}
    </>
  );
}
