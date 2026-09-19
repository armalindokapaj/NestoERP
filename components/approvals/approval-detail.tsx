"use client";

import * as React from "react";
import Link from "next/link";
import { ArrowLeft, ArrowUpRight, CircleAlert, Eye, EyeOff, FileText, Info, MessageSquare, RotateCw, TriangleAlert, UserRoundCheck, X } from "lucide-react";

import { CollaborationPanel } from "@/components/collaboration/collaboration-panel";
import { PersonLink } from "@/components/people/person-link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import type {
  ApprovalDecision,
  ApprovalStepDTO,
  ApprovalWarning,
  UnifiedApprovalDetail,
  UnifiedApprovalDocumentRef,
  UnifiedApprovalHistoryEntry,
} from "@/lib/modules/approvals/approvals.types";
import { cn } from "@/lib/utils/cn";
import { DecisionBar } from "./approval-decision";
import { DueBadge, formatMoney, formatStamp, PersonMark, PlainText, PriorityBadge, SourceIcon, StatusBadge, waitingText } from "./approval-ui";

/**
 * The review drawer (PRD #41 §80-§82, §107-§110, §178-§179, §209-§210, §218).
 *
 * One reading order everywhere — header, why, warnings, summary, the chain,
 * documents, history, discussion, the source — with the decision bar pinned
 * at the bottom. Decision history and discussion are visibly different
 * things: a note given with a decision is part of the timeline, a comment is
 * part of the conversation.
 */

export function ApprovalDetailView({
  detail,
  loading,
  failure,
  pending,
  onDecide,
  onReload,
  onClose,
  variant,
}: {
  detail: UnifiedApprovalDetail | null;
  loading: boolean;
  failure: { message: string; stale: boolean } | null;
  pending: ApprovalDecision | null;
  onDecide: (decision: ApprovalDecision, note: string | null) => Promise<boolean>;
  onReload: () => void;
  onClose: () => void;
  variant: "panel" | "sheet";
}) {
  const scrollRef = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    scrollRef.current?.scrollTo({ top: 0 });
  }, [detail?.item.id]);

  if (loading && !detail) return <DetailSkeleton variant={variant} onClose={onClose} />;

  if (!detail) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 px-8 py-16 text-center">
        {failure ? (
          <>
            <CircleAlert aria-hidden="true" className="size-6 text-fg-subtle" />
            <p className="text-body font-medium text-fg" role="alert">
              {failure.message}
            </p>
            {variant === "sheet" ? (
              <Button type="button" variant="secondary" onClick={onClose}>
                Back to the list
              </Button>
            ) : null}
          </>
        ) : (
          <>
            <span className="flex size-12 items-center justify-center rounded-full border border-line bg-surface-muted text-fg-subtle">
              <FileText aria-hidden="true" className="size-5" />
            </span>
            <p className="text-body font-medium text-fg">Select an approval to review it</p>
            <p className="max-w-xs text-table text-fg-muted">What it is, why it needs a decision, its documents and who has decided so far appear here.</p>
          </>
        )}
      </div>
    );
  }

  const { item } = detail;
  const amount = formatMoney(item.amount);

  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="approval-detail" aria-busy={loading}>
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto">
        <header className="border-b border-line px-5 pb-5 pt-4 sm:px-6">
          <div className="mb-3 flex items-center justify-between gap-2">
            {variant === "sheet" ? (
              <Button type="button" variant="ghost" size="sm" className="-ml-2" onClick={onClose}>
                <ArrowLeft aria-hidden="true" />
                Approvals
              </Button>
            ) : (
              <span className="text-micro font-medium uppercase tracking-[0.12em] text-fg-subtle">Review</span>
            )}
            <div className="flex items-center gap-1">
              <Button type="button" variant="ghost" size="icon-sm" onClick={onReload} aria-label="Reload this approval">
                <RotateCw aria-hidden="true" className={cn(loading && "animate-spin")} />
              </Button>
              {variant === "panel" ? (
                <Button type="button" variant="ghost" size="icon-sm" onClick={onClose} aria-label="Close review">
                  <X aria-hidden="true" />
                </Button>
              ) : null}
            </div>
          </div>
          <div className="flex items-start gap-3">
            <SourceIcon provider={item.providerKey} className="mt-0.5" />
            <div className="min-w-0 flex-1">
              <p className="text-micro font-semibold uppercase tracking-[0.1em] text-fg-subtle">{item.sourceLabel} approval</p>
              <h2 className="mt-1 text-[20px] font-semibold leading-snug tracking-[-0.01em] text-fg" data-testid="approval-title">
                {item.title}
              </h2>
              {item.subtitle ? <p className="mt-0.5 text-table text-fg-muted">{item.subtitle}</p> : null}
            </div>
          </div>
          {amount || item.project ? (
            <div className="mt-4 flex flex-wrap items-baseline gap-x-4 gap-y-1">
              {amount ? (
                <span className="text-[26px] font-semibold tabular-nums tracking-[-0.02em] text-fg" data-testid="approval-amount">
                  {amount}
                </span>
              ) : null}
              {item.project ? (
                <span className="text-table text-fg-muted">
                  {item.project.code ? <span className="font-mono text-meta text-fg-subtle">{item.project.code} · </span> : null}
                  {item.project.name}
                </span>
              ) : null}
            </div>
          ) : null}
          <div className="mt-3 flex flex-wrap items-center gap-1.5">
            <StatusBadge status={item.status} />
            <PriorityBadge priority={item.priority} />
            <DueBadge item={item} />
            {item.totalSteps ? (
              <Badge tone="neutral">
                Step {item.currentStep} of {item.totalSteps}
                {item.stepLabel && item.status === "PENDING" ? ` · ${item.stepLabel}` : ""}
              </Badge>
            ) : null}
          </div>
          <p className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-meta text-fg-muted">
            <PersonMark name={item.requester.name} />
            <span>
              Requested by <PersonLink memberId={item.requester.memberId} name={item.requester.name} />
            </span>
            <span aria-hidden="true">·</span>
            <time dateTime={item.requestedAt}>{formatStamp(item.requestedAt)}</time>
            {item.status === "PENDING" ? (
              <>
                <span aria-hidden="true">·</span>
                <span>{waitingText(item.requestedAt)}</span>
              </>
            ) : null}
          </p>
        </header>

        <div className="space-y-6 px-5 py-5 sm:px-6">
          {failure ? (
            <div role="alert" className="flex items-start gap-3 rounded-xl border border-warning/40 bg-warning-soft px-4 py-3">
              <TriangleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-warning-strong" />
              <div className="min-w-0 flex-1">
                <p className="text-table font-medium text-fg">{failure.message}</p>
                {failure.stale ? <p className="mt-0.5 text-meta text-fg-muted">Nothing was decided. Reload to see where it stands now.</p> : null}
              </div>
              {failure.stale ? (
                <Button type="button" size="sm" variant="secondary" onClick={onReload}>
                  Reload
                </Button>
              ) : null}
            </div>
          ) : null}

          {item.onBehalfOf ? (
            <Callout icon={<UserRoundCheck aria-hidden="true" className="size-4" />}>
              You are standing in for <PersonLink memberId={item.onBehalfOf.memberId} name={item.onBehalfOf.name} />. Your decision is recorded as yours, on their behalf.
            </Callout>
          ) : null}

          {detail.reason ? (
            <section aria-labelledby="why-heading">
              <SectionHeading id="why-heading">Why approval is needed</SectionHeading>
              <p className="mt-2 text-body leading-relaxed text-fg-muted">{detail.reason}</p>
            </section>
          ) : null}

          {detail.warnings.length > 0 ? <Warnings warnings={detail.warnings} /> : null}

          <section aria-labelledby="summary-heading">
            <SectionHeading id="summary-heading">Summary</SectionHeading>
            <dl className="mt-2 grid grid-cols-2 gap-x-6 gap-y-3 rounded-xl border border-line bg-surface-muted/40 p-4">
              {detail.summary.map((field) => (
                <div key={field.label} className="min-w-0">
                  <dt className="text-meta text-fg-subtle">{field.label}</dt>
                  <dd
                    className={cn(
                      "mt-0.5 break-words text-table",
                      field.emphasis === "strong" ? "font-semibold tabular-nums text-fg" : field.emphasis === "warning" ? "font-medium text-warning-strong" : "text-fg",
                    )}
                  >
                    {field.person ? <PersonLink {...field.person} name={field.value} /> : field.value}
                  </dd>
                </div>
              ))}
            </dl>
            {detail.description && detail.description !== item.subtitle ? <PlainText text={detail.description} className="mt-3 text-table leading-relaxed text-fg-muted" /> : null}
          </section>

          {detail.steps.length > 0 ? <Steps steps={detail.steps} mode={detail.chainMode} /> : null}

          <Documents documents={detail.documents} available={detail.documentsAvailable} />

          <History entries={detail.history} />

          {detail.discussion ? <Discussion parentType={detail.discussion.parentType} parentId={detail.discussion.parentId} key={`${detail.discussion.parentType}:${detail.discussion.parentId}`} /> : null}

          <Link
            href={detail.sourceRecord.href}
            className="flex items-center justify-between gap-3 rounded-xl border border-line px-4 py-3 text-table font-medium text-fg transition-colors hover:border-line-strong hover:bg-hover"
          >
            {detail.sourceRecord.label}
            <ArrowUpRight aria-hidden="true" className="size-4 text-fg-subtle" />
          </Link>
        </div>
      </div>

      <DecisionBar item={item} pending={pending} onDecide={onDecide} className={variant === "sheet" ? "pb-[max(0.75rem,env(safe-area-inset-bottom))]" : undefined} />
    </div>
  );
}

function SectionHeading({ id, children, trailing }: { id: string; children: React.ReactNode; trailing?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <h3 id={id} className="text-micro font-semibold uppercase tracking-[0.12em] text-fg-subtle">
        {children}
      </h3>
      {trailing}
    </div>
  );
}

function Callout({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-3 rounded-xl border border-info/30 bg-info-soft px-4 py-3 text-table text-fg">
      <span className="mt-0.5 text-info-strong">{icon}</span>
      <p>{children}</p>
    </div>
  );
}

const WARNING_STYLE: Record<ApprovalWarning["severity"], { box: string; icon: React.ReactNode; label: string }> = {
  CRITICAL: { box: "border-danger/40 bg-danger-soft", icon: <CircleAlert aria-hidden="true" className="size-4 text-danger-strong" />, label: "Critical" },
  WARNING: { box: "border-warning/40 bg-warning-soft", icon: <TriangleAlert aria-hidden="true" className="size-4 text-warning-strong" />, label: "Warning" },
  INFO: { box: "border-line bg-surface-muted", icon: <Info aria-hidden="true" className="size-4 text-fg-subtle" />, label: "Note" },
};

function Warnings({ warnings }: { warnings: ApprovalWarning[] }) {
  return (
    <section aria-label="Warnings" className="space-y-2" data-testid="approval-warnings">
      {warnings.map((warning) => {
        const style = WARNING_STYLE[warning.severity];
        return (
          <div key={warning.code} className={cn("flex items-start gap-3 rounded-xl border px-4 py-2.5", style.box)}>
            <span className="mt-0.5">{style.icon}</span>
            <p className="text-table text-fg">
              <span className="sr-only">{style.label}: </span>
              {warning.message}
            </p>
          </div>
        );
      })}
    </section>
  );
}

const STEP_TEXT: Record<ApprovalStepDTO["status"], string> = {
  PENDING: "Pending",
  WAITING: "Waiting",
  APPROVED: "Approved",
  REJECTED: "Rejected",
  RETURNED: "Returned",
  SKIPPED: "Skipped",
  CANCELLED: "Not reached",
};

function Steps({ steps, mode }: { steps: ApprovalStepDTO[]; mode: UnifiedApprovalDetail["chainMode"] }) {
  const parallel = mode === "PARALLEL";
  return (
    <section aria-labelledby="steps-heading">
      <SectionHeading id="steps-heading" trailing={<span className="text-meta text-fg-subtle">{parallel ? "Every reviewer must approve" : "In order"}</span>}>
        {parallel ? "Reviewers" : "Approval chain"}
      </SectionHeading>
      <ol className="mt-2 divide-y divide-line rounded-xl border border-line" data-testid="approval-steps">
        {steps.map((step) => (
          <li key={step.number} className="flex items-center gap-3 px-4 py-2.5">
            <span
              aria-hidden="true"
              className={cn(
                "flex size-6 shrink-0 items-center justify-center rounded-full text-micro font-semibold",
                step.status === "APPROVED"
                  ? "bg-success-soft text-success-strong"
                  : step.status === "REJECTED"
                    ? "bg-danger-soft text-danger-strong"
                    : step.status === "RETURNED"
                      ? "bg-warning-soft text-warning-strong"
                      : step.status === "PENDING"
                        ? "bg-accent text-accent-fg"
                        : "bg-surface-muted text-fg-subtle",
              )}
            >
              {parallel ? step.label.charAt(0) : step.number}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-table font-medium text-fg">
                {step.labelMemberId ? <PersonLink memberId={step.labelMemberId} name={step.label} /> : step.label}
              </span>
              {step.decidedBy ? (
                <span className="block text-meta text-fg-muted">
                  <PersonLink memberId={step.decidedByMemberId} name={step.decidedBy} />
                  {step.onBehalfOf ? (
                    <>
                      {" for "}
                      <PersonLink memberId={step.onBehalfOfMemberId} name={step.onBehalfOf} />
                    </>
                  ) : null}{" "}
                  · {formatStamp(step.decidedAt)}
                </span>
              ) : null}
            </span>
            <span className={cn("text-meta font-medium", step.status === "PENDING" ? "text-accent-strong" : step.status === "APPROVED" ? "text-success-strong" : "text-fg-subtle")}>
              {STEP_TEXT[step.status]}
            </span>
          </li>
        ))}
      </ol>
    </section>
  );
}

function Documents({ documents, available }: { documents: UnifiedApprovalDocumentRef[]; available: boolean }) {
  const [previewing, setPreviewing] = React.useState<string | null>(null);
  if (!available) {
    return (
      <section aria-labelledby="documents-heading">
        <SectionHeading id="documents-heading">Supporting documents</SectionHeading>
        <p className="mt-2 text-table text-fg-subtle">Open the record to see its files, if you have access to them.</p>
      </section>
    );
  }
  return (
    <section aria-labelledby="documents-heading">
      <SectionHeading id="documents-heading" trailing={<span className="text-meta tabular-nums text-fg-subtle">{documents.length}</span>}>
        Supporting documents
      </SectionHeading>
      {documents.length === 0 ? (
        <p className="mt-2 text-table text-fg-subtle">No documents on this record.</p>
      ) : (
        <ul className="mt-2 divide-y divide-line rounded-xl border border-line" data-testid="approval-documents">
          {documents.map((document) => (
            <li key={`${document.id}:${document.versionNumber ?? ""}`} className="px-4 py-2.5">
              <div className="flex items-center gap-3">
                <FileText aria-hidden="true" className="size-4 shrink-0 text-fg-subtle" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-table font-medium text-fg">{document.name}</span>
                  <span className="block truncate text-meta text-fg-muted">
                    {[document.versionNumber ? `v${document.versionNumber}` : null, document.fileName !== document.name ? document.fileName : null, document.sizeLabel].filter(Boolean).join(" · ")}
                  </span>
                </span>
                {document.previewable ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => setPreviewing(previewing === document.id ? null : document.id)}
                    aria-expanded={previewing === document.id}
                    aria-label={`${previewing === document.id ? "Hide preview of" : "Preview"} ${document.name}`}
                  >
                    {previewing === document.id ? <EyeOff aria-hidden="true" /> : <Eye aria-hidden="true" />}
                    {previewing === document.id ? "Hide" : "Preview"}
                  </Button>
                ) : null}
                <Button asChild variant="ghost" size="icon-sm" aria-label={`Open ${document.name}`}>
                  <Link href={document.href}>
                    <ArrowUpRight aria-hidden="true" />
                  </Link>
                </Button>
              </div>
              {previewing === document.id ? <Preview documentId={document.id} name={document.name} /> : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/**
 * A preview grant is asked for when somebody wants to look, with the same
 * authorisation as a download (PRD #41 §61, §179, §180; PRD #29 §105).
 */
function Preview({ documentId, name }: { documentId: string; name: string }) {
  const [grant, setGrant] = React.useState<{ url: string; mimeType: string } | null>(null);
  const [failed, setFailed] = React.useState(false);
  React.useEffect(() => {
    let cancelled = false;
    void (async () => {
      const response = await fetch(`/api/documents/${documentId}/preview`, { method: "POST" }).catch(() => null);
      if (cancelled) return;
      if (!response?.ok) {
        setFailed(true);
        return;
      }
      setGrant(await response.json());
    })();
    return () => {
      cancelled = true;
    };
  }, [documentId]);

  if (failed) return <p className="mt-2 rounded-md bg-surface-muted px-3 py-2 text-meta text-fg-muted">Preview unavailable. Open the document instead.</p>;
  if (!grant) return <Skeleton className="mt-2 h-72 w-full rounded-md" />;
  return (
    <div className="mt-2 overflow-hidden rounded-md border border-line bg-surface-muted">
      <object data={grant.url} type={grant.mimeType} aria-label={`Preview of ${name}`} className="h-[26rem] w-full" data-testid="approval-preview">
        <p className="p-4 text-table text-fg-muted">This file cannot be previewed here.</p>
      </object>
    </div>
  );
}

const TONE_DOT: Record<UnifiedApprovalHistoryEntry["tone"], string> = {
  neutral: "bg-line-strong",
  info: "bg-info",
  success: "bg-success",
  danger: "bg-danger",
  warning: "bg-warning",
};

function History({ entries }: { entries: UnifiedApprovalHistoryEntry[] }) {
  return (
    <section aria-labelledby="history-heading">
      <SectionHeading id="history-heading">Approval history</SectionHeading>
      {entries.length === 0 ? (
        <p className="mt-2 text-table text-fg-subtle">No history yet.</p>
      ) : (
        <ol className="relative mt-3 space-y-4 pl-5 before:absolute before:bottom-1 before:left-[5px] before:top-1 before:w-px before:bg-line" data-testid="approval-history">
          {entries.map((entry) => (
            <li key={entry.id} className="relative">
              <span aria-hidden="true" className={cn("absolute -left-5 top-1.5 size-[11px] rounded-full ring-4 ring-surface", TONE_DOT[entry.tone])} />
              <p className="text-table font-medium text-fg">{entry.action}</p>
              <p className="text-meta text-fg-muted">
                {entry.actor ? (
                  <>
                    <PersonLink memberId={entry.actor.memberId} name={entry.actor.name} />
                    {entry.onBehalfOf ? (
                      <>
                        {", for "}
                        <PersonLink memberId={entry.onBehalfOf.memberId} name={entry.onBehalfOf.name} />
                      </>
                    ) : null}
                    {` · ${formatStamp(entry.occurredAt)}`}
                  </>
                ) : (
                  [entry.actorName, formatStamp(entry.occurredAt)].filter(Boolean).join(" · ")
                )}
              </p>
              {entry.note ? <PlainText text={entry.note} className="mt-1.5 rounded-lg bg-surface-muted px-3 py-2 text-table text-fg" /> : null}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

function Discussion({ parentType, parentId }: { parentType: string; parentId: string }) {
  const [open, setOpen] = React.useState(false);
  return (
    <section aria-labelledby="discussion-heading" className="rounded-xl border border-line">
      <button
        type="button"
        className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
      >
        <span className="flex items-center gap-2">
          <MessageSquare aria-hidden="true" className="size-4 text-fg-subtle" />
          <span id="discussion-heading" className="text-table font-medium text-fg">
            Questions and discussion
          </span>
        </span>
        <span className="text-meta text-fg-subtle">{open ? "Hide" : "Show"}</span>
      </button>
      {open ? (
        <div className="border-t border-line px-4 py-3">
          <p className="mb-3 text-meta text-fg-subtle">On the record itself, so everyone working on it sees the same conversation. Decision notes stay in the history above.</p>
          <CollaborationPanel parentType={parentType} parentId={parentId} title="Discussion" />
        </div>
      ) : null}
    </section>
  );
}

function DetailSkeleton({ variant, onClose }: { variant: "panel" | "sheet"; onClose: () => void }) {
  return (
    <div className="space-y-5 px-5 py-5 sm:px-6" aria-busy="true" aria-label="Loading approval">
      {variant === "sheet" ? (
        <Button type="button" variant="ghost" size="sm" className="-ml-2" onClick={onClose}>
          <ArrowLeft aria-hidden="true" />
          Approvals
        </Button>
      ) : null}
      <div className="flex gap-3">
        <Skeleton className="size-9 rounded-lg" />
        <div className="flex-1 space-y-2">
          <Skeleton className="h-3 w-28" />
          <Skeleton className="h-6 w-3/4" />
        </div>
      </div>
      <Skeleton className="h-8 w-40" />
      <Skeleton className="h-24 w-full rounded-xl" />
      <Skeleton className="h-40 w-full rounded-xl" />
      <Skeleton className="h-28 w-full rounded-xl" />
    </div>
  );
}
