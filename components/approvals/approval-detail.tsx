"use client";

import * as React from "react";
import Link from "@/components/navigation/nav-link";
import { ArrowLeft, ArrowUpRight, CircleAlert, Download, ExternalLink, Eye, EyeOff, FileText, Info, MessageSquare, RotateCw, TriangleAlert, UserRoundCheck, X } from "lucide-react";

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
import { useApprovalDraft } from "./approval-drafts";
import { useApprovalsTranslations, useApprovalsWord } from "./approvals-text";
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
  const t = useApprovalsTranslations();
  const word = useApprovalsWord();
  const scrollRef = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    scrollRef.current?.scrollTo({ top: 0 });
  }, [detail?.item.id]);
  // A refused decision is explained at the top of the review: brought into
  // view, since on a phone the reader pressed the bar at the bottom (AUD-04 MW-12).
  React.useEffect(() => {
    if (failure) scrollRef.current?.scrollTo({ top: 0 });
  }, [failure]);

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
                {t("detail.backToList")}
              </Button>
            ) : null}
          </>
        ) : (
          <>
            <span className="flex size-12 items-center justify-center rounded-full border border-line bg-surface-muted text-fg-subtle">
              <FileText aria-hidden="true" className="size-5" />
            </span>
            <p className="text-body font-medium text-fg">{t("detail.selectTitle")}</p>
            <p className="max-w-xs text-table text-fg-muted">{t("detail.selectBody")}</p>
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
                {t("title")}
              </Button>
            ) : (
              <span className="text-micro font-medium uppercase tracking-[0.12em] text-fg-subtle">{t("detail.review")}</span>
            )}
            <div className="flex items-center gap-1">
              <Button type="button" variant="ghost" size="icon-sm" onClick={onReload} aria-label={t("detail.reload")}>
                <RotateCw aria-hidden="true" className={cn(loading && "animate-spin")} />
              </Button>
              {variant === "panel" ? (
                <Button type="button" variant="ghost" size="icon-sm" onClick={onClose} aria-label={t("detail.close")}>
                  <X aria-hidden="true" />
                </Button>
              ) : null}
            </div>
          </div>
          <div className="flex items-start gap-3">
            <SourceIcon provider={item.providerKey} className="mt-0.5" />
            <div className="min-w-0 flex-1">
              <p className="text-micro font-semibold uppercase tracking-[0.1em] text-fg-subtle">{t("detail.sourceApproval", { source: word(item.sourceLabel) })}</p>
              <h2 className="mt-1 text-section font-semibold leading-snug tracking-[-0.01em] text-fg [overflow-wrap:anywhere]" data-testid="approval-title">
                {item.title}
              </h2>
              {item.subtitle ? <p className="mt-0.5 text-table text-fg-muted">{item.subtitle}</p> : null}
            </div>
          </div>
          {amount || item.project ? (
            <div className="mt-4 flex flex-wrap items-baseline gap-x-4 gap-y-1">
              {amount ? (
                <span className="min-w-0 text-[26px] font-semibold tabular-nums tracking-[-0.02em] text-fg [overflow-wrap:anywhere]" data-testid="approval-amount">
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
                {t("detail.step", { current: item.currentStep ?? "", total: item.totalSteps })}
                {item.stepLabel && item.status === "PENDING" ? ` · ${item.stepLabel}` : ""}
              </Badge>
            ) : null}
          </div>
          <p className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-meta text-fg-muted">
            <PersonMark name={item.requester.name} />
            <span>
              {t("detail.requestedBy")} <PersonLink memberId={item.requester.memberId} name={item.requester.name} />
            </span>
            <span aria-hidden="true">·</span>
            <time dateTime={item.requestedAt}>{formatStamp(item.requestedAt)}</time>
            {item.status === "PENDING" ? (
              <>
                <span aria-hidden="true">·</span>
                <span>{waitingText(item.requestedAt, new Date(), t)}</span>
              </>
            ) : null}
          </p>
        </header>

        <div className="space-y-6 px-5 py-5 sm:px-6">
          {failure ? (
            <div role="alert" className="flex items-start gap-3 rounded-xl border border-warning/40 bg-warning-soft px-4 py-3" data-testid="approval-decision-failure">
              <TriangleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-warning-strong" />
              <div className="min-w-0 flex-1">
                <p className="text-table font-medium text-fg">{failure.message}</p>
                {failure.stale ? <p className="mt-0.5 text-meta text-fg-muted">{t("detail.staleHint")}</p> : null}
              </div>
              {failure.stale ? (
                <Button type="button" size="sm" variant="secondary" onClick={onReload}>
                  {t("detail.reloadButton")}
                </Button>
              ) : null}
            </div>
          ) : null}

          {item.onBehalfOf ? (
            <Callout icon={<UserRoundCheck aria-hidden="true" className="size-4" />}>
              {t("detail.standingIn")} <PersonLink memberId={item.onBehalfOf.memberId} name={item.onBehalfOf.name} />
              {t("detail.standingInRest")}
            </Callout>
          ) : null}

          {detail.reason ? (
            <section aria-labelledby="why-heading">
              <SectionHeading id="why-heading">{t("detail.why")}</SectionHeading>
              <p className="mt-2 text-body leading-relaxed text-fg-muted">{detail.reason}</p>
            </section>
          ) : null}

          {detail.warnings.length > 0 ? <Warnings warnings={detail.warnings} /> : null}

          <section aria-labelledby="summary-heading">
            <SectionHeading id="summary-heading">{t("detail.summary")}</SectionHeading>
            {/* One column on the narrowest phones, so a long amount, IBAN or reference is not squeezed into 140px (AUD-04 §5, MW-05). */}
            <dl className="mt-2 grid grid-cols-1 gap-x-6 gap-y-3 rounded-xl border border-line bg-surface-muted/40 p-4 min-[400px]:grid-cols-2">
              {detail.summary.map((field) => (
                <div key={field.label} className="min-w-0">
                  <dt className="text-meta text-fg-subtle">{field.label}</dt>
                  <dd
                    className={cn(
                      "mt-0.5 text-table [overflow-wrap:anywhere]",
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

      <DecisionBar key={item.id} item={item} pending={pending} failure={failure} onDecide={onDecide} className={variant === "sheet" ? "pb-[max(0.75rem,env(safe-area-inset-bottom))]" : undefined} />
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

const WARNING_STYLE: Record<ApprovalWarning["severity"], { box: string; icon: React.ReactNode; label: "warningCritical" | "warningWarning" | "warningNote" }> = {
  CRITICAL: { box: "border-danger/40 bg-danger-soft", icon: <CircleAlert aria-hidden="true" className="size-4 text-danger-strong" />, label: "warningCritical" },
  WARNING: { box: "border-warning/40 bg-warning-soft", icon: <TriangleAlert aria-hidden="true" className="size-4 text-warning-strong" />, label: "warningWarning" },
  INFO: { box: "border-line bg-surface-muted", icon: <Info aria-hidden="true" className="size-4 text-fg-subtle" />, label: "warningNote" },
};

function Warnings({ warnings }: { warnings: ApprovalWarning[] }) {
  const t = useApprovalsTranslations();
  return (
    <section aria-label={t("detail.warnings")} className="space-y-2" data-testid="approval-warnings">
      {warnings.map((warning) => {
        const style = WARNING_STYLE[warning.severity];
        return (
          <div key={warning.code} className={cn("flex items-start gap-3 rounded-xl border px-4 py-2.5", style.box)}>
            <span className="mt-0.5">{style.icon}</span>
            <p className="text-table text-fg">
              <span className="sr-only">{t(`detail.${style.label}`)}: </span>
              {warning.message}
            </p>
          </div>
        );
      })}
    </section>
  );
}

function Steps({ steps, mode }: { steps: ApprovalStepDTO[]; mode: UnifiedApprovalDetail["chainMode"] }) {
  const t = useApprovalsTranslations();
  const parallel = mode === "PARALLEL";
  return (
    <section aria-labelledby="steps-heading">
      <SectionHeading id="steps-heading" trailing={<span className="text-meta text-fg-subtle">{parallel ? t("detail.everyReviewer") : t("detail.inOrder")}</span>}>
        {parallel ? t("detail.reviewers") : t("detail.chain")}
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
                      {t("detail.for")}
                      <PersonLink memberId={step.onBehalfOfMemberId} name={step.onBehalfOf} />
                    </>
                  ) : null}{" "}
                  · {formatStamp(step.decidedAt)}
                </span>
              ) : null}
            </span>
            <span className={cn("text-meta font-medium", step.status === "PENDING" ? "text-accent-strong" : step.status === "APPROVED" ? "text-success-strong" : "text-fg-subtle")}>
              {t(`stepStatus.${step.status}`)}
            </span>
          </li>
        ))}
      </ol>
    </section>
  );
}

function Documents({ documents, available }: { documents: UnifiedApprovalDocumentRef[]; available: boolean }) {
  const t = useApprovalsTranslations();
  const [previewing, setPreviewing] = useApprovalDraft<string | null>("documents:previewing", null);
  if (!available) {
    return (
      <section aria-labelledby="documents-heading">
        <SectionHeading id="documents-heading">{t("detail.documents")}</SectionHeading>
        <p className="mt-2 text-table text-fg-subtle">{t("detail.documentsHidden")}</p>
      </section>
    );
  }
  return (
    <section aria-labelledby="documents-heading">
      <SectionHeading id="documents-heading" trailing={<span className="text-meta tabular-nums text-fg-subtle">{documents.length}</span>}>
        {t("detail.documents")}
      </SectionHeading>
      {documents.length === 0 ? (
        <p className="mt-2 text-table text-fg-subtle">{t("detail.noDocuments")}</p>
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
                    aria-label={previewing === document.id ? t("detail.hidePreviewOf", { name: document.name }) : t("detail.previewOf", { name: document.name })}
                  >
                    {previewing === document.id ? <EyeOff aria-hidden="true" /> : <Eye aria-hidden="true" />}
                    {previewing === document.id ? t("detail.hide") : t("detail.preview")}
                  </Button>
                ) : null}
                <Button asChild variant="ghost" size="icon-sm" aria-label={t("detail.openName", { name: document.name })}>
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
 *
 * What is drawn is only ever something the browser can really show (AUD-04
 * §5, MW-12, MW-17). An image is an `<img>` whose failure is noticed. A PDF is
 * embedded only where the browser says it has an inline PDF viewer and the
 * pointer is fine; phone browsers either draw nothing (Android) or one page
 * (iOS) inside an `<object>` and report neither, so there the reader gets an
 * explicit Open / Download instead of a blank box that looks loaded. Open is
 * the preview grant itself; Download is the application-proxied download,
 * which runs the whole authorisation again. Both are offered under every
 * preview as well.
 */
function Preview({ documentId, name }: { documentId: string; name: string }) {
  const t = useApprovalsTranslations();
  const [grant, setGrant] = React.useState<{ url: string; mimeType: string; kind?: "pdf" | "image" } | null>(null);
  const [failed, setFailed] = React.useState(false);
  const [imageFailed, setImageFailed] = React.useState(false);
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

  const download = `/api/documents/${documentId}/download`;
  if (failed) {
    return (
      <div className="mt-2 space-y-2 rounded-md bg-surface-muted px-3 py-2" data-testid="approval-preview-fallback">
        <p className="text-meta text-fg-muted">{t("detail.previewUnavailable")}</p>
        <PreviewLinks name={name} download={download} />
      </div>
    );
  }
  if (!grant) return <Skeleton className="mt-2 h-72 w-full rounded-md" />;

  const kind = grant.kind ?? (grant.mimeType === "application/pdf" ? "pdf" : grant.mimeType.startsWith("image/") ? "image" : null);
  // Read only after a person asked to preview, so never during server rendering.
  const inlinePdf = typeof navigator !== "undefined" && navigator.pdfViewerEnabled === true && window.matchMedia("(pointer: fine)").matches;

  if (kind === "image" && !imageFailed) {
    return (
      <div className="mt-2 space-y-2">
        <div className="overflow-hidden rounded-md border border-line bg-surface-muted">
          {/* A short-lived grant URL: next/image would cache and re-request it. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={grant.url} alt={t("detail.previewImage", { name })} className="mx-auto max-h-[26rem] w-auto max-w-full object-contain" onError={() => setImageFailed(true)} data-testid="approval-preview" />
        </div>
        <PreviewLinks name={name} open={grant.url} download={download} />
      </div>
    );
  }
  if (kind === "pdf" && inlinePdf) {
    return (
      <div className="mt-2 space-y-2">
        <div className="overflow-hidden rounded-md border border-line bg-surface-muted">
          <object data={grant.url} type={grant.mimeType} aria-label={t("detail.previewImage", { name })} className="h-[26rem] w-full" data-testid="approval-preview">
            <p className="p-4 text-table text-fg-muted">{t("detail.cannotPreview")}</p>
          </object>
        </div>
        <PreviewLinks name={name} open={grant.url} download={download} />
      </div>
    );
  }
  return (
    <div className="mt-2 space-y-2 rounded-md border border-line bg-surface-muted px-3 py-3" data-testid="approval-preview-fallback">
      <p className="text-table text-fg-muted">
        {kind === "image" ? t("detail.imageNotShown") : t("detail.pdfNotShown")} {t("detail.openOrDownload")}
      </p>
      <PreviewLinks name={name} open={grant.url} download={download} />
    </div>
  );
}

function PreviewLinks({ name, open, download }: { name: string; open?: string; download: string }) {
  const t = useApprovalsTranslations();
  return (
    <div className="flex flex-wrap gap-2">
      {open ? (
        <Button asChild variant="secondary" size="sm">
          <a href={open} target="_blank" rel="noopener noreferrer" aria-label={t("detail.openNewTab", { name })}>
            <ExternalLink aria-hidden="true" />
            {t("detail.open")}
          </a>
        </Button>
      ) : null}
      <Button asChild variant="secondary" size="sm">
        <a href={download} download aria-label={t("detail.downloadName", { name })}>
          <Download aria-hidden="true" />
          {t("detail.download")}
        </a>
      </Button>
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
  const t = useApprovalsTranslations();
  return (
    <section aria-labelledby="history-heading">
      <SectionHeading id="history-heading">{t("detail.history")}</SectionHeading>
      {entries.length === 0 ? (
        <p className="mt-2 text-table text-fg-subtle">{t("detail.noHistory")}</p>
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
                        {t("detail.forComma")}
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
  // Kept open across a rotation between the panel and the sheet (AUD-04 MW-16).
  const t = useApprovalsTranslations();
  const [open, setOpen] = useApprovalDraft(`discussion:${parentType}:${parentId}`, false);
  return (
    <section aria-labelledby="discussion-heading" className="rounded-xl border border-line">
      <button
        type="button"
        className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
      >
        <span className="flex items-center gap-2">
          <MessageSquare aria-hidden="true" className="size-4 text-fg-subtle" />
          <span id="discussion-heading" className="text-table font-medium text-fg">
            {t("detail.discussion")}
          </span>
        </span>
        <span className="text-meta text-fg-subtle">{open ? t("detail.hide") : t("detail.show")}</span>
      </button>
      {open ? (
        <div className="border-t border-line px-4 py-3">
          <p className="mb-3 text-meta text-fg-subtle">{t("detail.discussionNote")}</p>
          <CollaborationPanel parentType={parentType} parentId={parentId} title={t("detail.discussionTitle")} />
        </div>
      ) : null}
    </section>
  );
}

function DetailSkeleton({ variant, onClose }: { variant: "panel" | "sheet"; onClose: () => void }) {
  const t = useApprovalsTranslations();
  return (
    <div className="space-y-5 px-5 py-5 sm:px-6" role="status" aria-busy="true" aria-label={t("detail.loading")}>
      {variant === "sheet" ? (
        <Button type="button" variant="ghost" size="sm" className="-ml-2" onClick={onClose}>
          <ArrowLeft aria-hidden="true" />
          {t("title")}
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
