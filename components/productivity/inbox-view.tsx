"use client";

import * as React from "react";
import { Bell, ChevronRight, ClipboardCheck, Megaphone } from "@/components/icons";

import { DecisionBar } from "@/components/approvals/approval-decision";
import { approvalsApi, failureMessage, newIdempotencyKey } from "@/components/approvals/approvals-api";
import { useApprovalsTranslations, useApprovalsWord } from "@/components/approvals/approvals-text";
import { useLocale, useTranslations } from "@/components/i18n/i18n-provider";
import { useRouter } from "@/components/navigation/guarded-router";
import Link from "@/components/navigation/nav-link";
import { LineCaption, LineHead, LineIcon, lineRow } from "@/components/ui/lined";
import { useToast } from "@/components/ui/toast";
import { dateText } from "@/lib/i18n/format";
import type { ApprovalDecision, ApprovalDecisionResult, UnifiedApprovalItem } from "@/lib/modules/approvals/approvals.types";
import type { ActivityCenterItem } from "@/lib/modules/activity/activity-center.service";
import { cn } from "@/lib/utils/cn";

export type InboxData = {
  /** Approvals waiting for this person; null when they could not be read, never an empty list instead. */
  approvals: UnifiedApprovalItem[] | null;
  /** In the Group workspace an approval is decided inside its company: the row opens the Center there. */
  group: boolean;
  activity: ActivityCenterItem[] | null;
};

/**
 * Inbox, the phone's fourth place (docs/ui/UI-04-navigation-layouts.md §Phone):
 * the bell's place, with the approvals that wait for you at the top. An
 * approval is answered in its row — the Approvals Center's own decision bar,
 * so Reject and Return still ask for a reason and a high-risk record still
 * asks twice — and the rest is for your information. Two filters, visible.
 */
export function InboxView({ data }: { data: InboxData }) {
  const t = useTranslations("misc");
  const [all, setAll] = React.useState(false);
  const approvals = data.approvals ?? [];
  const activity = data.activity ?? [];
  const unread = activity.filter((item) => item.readState === "UNREAD");
  const listed = all ? activity : unread;
  const count = approvals.length;

  return (
    <div className="-mx-(--nesto-gutter) -mt-(--nesto-space-page-y) max-w-3xl pt-4 md:mx-auto" data-testid="inbox">
      <LineHead eyebrow={t("inbox.key")} title={count === 0 ? t("inbox.answerNone") : count === 1 ? t("inbox.answerOne") : t("inbox.answerMany", { count })} />
      <div className="px-4 pb-6 sm:px-6">
        <div role="group" aria-label={t("inbox.show")} className="grid grid-cols-2 border border-line-strong bg-surface">
          <button type="button" aria-pressed={!all} onClick={() => setAll(false)} className={cn("h-12 text-body font-medium transition-colors", !all ? "bg-primary text-primary-fg" : "text-fg-muted hover:bg-hover")} data-testid="inbox-needs-you">
            {t("inbox.needsYou", { count: count + unread.length })}
          </button>
          <button type="button" aria-pressed={all} onClick={() => setAll(true)} className={cn("h-12 border-l border-line-strong text-body font-medium transition-colors", all ? "bg-primary text-primary-fg" : "text-fg-muted hover:bg-hover")} data-testid="inbox-everything">
            {t("inbox.everything", { count: count + activity.length })}
          </button>
        </div>
      </div>

      <section aria-labelledby="inbox-answer">
        <LineCaption id="inbox-answer" number="01" label={t("inbox.yourAnswer")} count={data.approvals ? count : null} />
        {data.approvals === null ? (
          <p role="status" className="border-b border-line px-4 py-5 text-table text-fg-muted sm:px-6">{t("inbox.approvalsUnavailable")}</p>
        ) : count === 0 ? (
          <p className="border-b border-line px-4 py-5 text-table text-fg-muted sm:px-6">{t("inbox.answerNone")}.</p>
        ) : (
          <ul>
            {approvals.map((item) => (
              <li key={item.id}>
                <ApprovalRow item={item} group={data.group} />
              </li>
            ))}
          </ul>
        )}
        <Link href="/approvals" className="inline-flex min-h-12 items-center gap-1.5 px-4 font-mono text-meta font-medium uppercase tracking-[0.12em] text-fg hover:text-accent-strong sm:px-6">
          {t("inbox.allApprovals")}
          <ChevronRight aria-hidden="true" className="size-3.5" />
        </Link>
      </section>

      <section aria-labelledby="inbox-info" className="mt-6">
        <LineCaption id="inbox-info" number="02" label={all ? t("inbox.forYou") : t("inbox.unread")} count={data.activity ? listed.length : null} />
        {data.activity === null ? (
          <p role="status" className="border-b border-line px-4 py-5 text-table text-fg-muted sm:px-6">{t("inbox.activityUnavailable")}</p>
        ) : listed.length === 0 ? (
          <p className="border-b border-line px-4 py-5 text-table text-fg-muted sm:px-6">{all ? t("inbox.nothing") : t("inbox.nothingUnread")}</p>
        ) : (
          <ul>
            {listed.map((item) => (
              <li key={item.key}>
                <ActivityRow item={item} />
              </li>
            ))}
          </ul>
        )}
        <Link href="/activity" className="inline-flex min-h-12 items-center gap-1.5 px-4 font-mono text-meta font-medium uppercase tracking-[0.12em] text-fg hover:text-accent-strong sm:px-6">
          {t("inbox.allActivity")}
          <ChevronRight aria-hidden="true" className="size-3.5" />
        </Link>
      </section>
    </div>
  );
}

/** One approval, answered where it stands; in the Group workspace it opens the Center inside its company instead. */
function ApprovalRow({ item, group }: { item: UnifiedApprovalItem; group: boolean }) {
  const t = useTranslations("misc");
  const ta = useApprovalsTranslations();
  const word = useApprovalsWord();
  const locale = useLocale();
  const router = useRouter();
  const toast = useToast();
  const [pending, setPending] = React.useState<ApprovalDecision | null>(null);
  const attempt = React.useRef<string | null>(null);
  const meta = [word(item.sourceLabel), item.project?.name, item.requester.name].filter(Boolean).join(" · ");
  const amount = item.amount ? `${item.amount.value} ${item.amount.currency}` : null;
  const decidable = !group && (item.canApprove || item.canReject || item.canReturn);

  async function decide(decision: ApprovalDecision, note: string | null): Promise<boolean> {
    if (pending) return false;
    const path = decision === "APPROVE" ? "approve" : decision === "REJECT" ? "reject" : "return";
    attempt.current ??= newIdempotencyKey();
    setPending(decision);
    try {
      const result = await approvalsApi<ApprovalDecisionResult>(`/api/approvals/${item.providerKey}/${item.approvalId}/${path}`, {
        body: { note: note ?? undefined, expectedVersion: item.version },
        idempotencyKey: attempt.current,
      });
      attempt.current = null;
      const source = word(item.sourceLabel);
      toast({
        title:
          result.outcome === "STEP_APPROVED"
            ? ta("shell.stepApproved")
            : result.outcome === "APPROVED"
              ? ta("shell.approvedToast", { source })
              : result.outcome === "REJECTED"
                ? ta("shell.rejectedToast", { source })
                : ta("shell.returnedToast", { source }),
        description: result.alreadyApplied ? ta("shell.alreadyRecorded") : ta("shell.requesterTold", { name: item.requester.name }),
        tone: "success",
      });
      router.refresh();
      return true;
    } catch (failure) {
      toast({ title: failureMessage(failure), tone: "danger" });
      return false;
    } finally {
      setPending(null);
    }
  }

  const head = (
    <>
      <LineIcon tone="gold">
        <ClipboardCheck />
      </LineIcon>
      <span className="min-w-0 flex-1">
        <span className="flex items-baseline justify-between gap-3">
          <span className="min-w-0 truncate text-body font-medium text-fg">{item.title}</span>
          <span className="shrink-0 font-mono text-meta text-fg-subtle">{dateText(new Date(item.requestedAt), { day: "numeric", month: "short" }, locale, "en")}</span>
        </span>
        <span className="mt-0.5 block text-table text-fg-muted">{meta}</span>
        {amount ? <span className="block text-table tabular-nums text-fg-muted">{amount}</span> : null}
        {item.company ? <span className="mt-1 block font-mono text-meta uppercase tracking-[0.08em] text-fg-subtle">{t("inbox.openInCompany", { company: item.company.name })}</span> : null}
      </span>
    </>
  );

  if (!decidable) {
    return (
      <Link href={group ? "/approvals" : `/approvals?approval=${encodeURIComponent(item.id)}`} className={lineRow} data-testid="inbox-approval">
        {head}
        <ChevronRight aria-hidden="true" className="size-4 shrink-0 text-fg-subtle" />
      </Link>
    );
  }
  return (
    <div className="border-b border-line" data-testid="inbox-approval">
      <Link href={`/approvals?approval=${encodeURIComponent(item.id)}`} className={cn(lineRow, "border-b-0 pb-0")}>
        {head}
        <span className="sr-only">{t("inbox.review")}</span>
      </Link>
      <DecisionBar item={item} pending={pending} onDecide={decide} className="border-t-0 bg-transparent px-4 pb-4 pt-3 backdrop-blur-none supports-[backdrop-filter]:bg-transparent sm:px-6" />
    </div>
  );
}

/** One alert: what happened, where, when; it opens through its own re-authorising link. */
function ActivityRow({ item }: { item: ActivityCenterItem }) {
  const t = useTranslations("misc");
  const locale = useLocale();
  const Icon = item.sourceType === "ANNOUNCEMENT" ? Megaphone : Bell;
  const where = [item.project?.name, item.openIn ? t("inbox.openInCompany", { company: item.openIn.name }) : null].filter(Boolean).join(" · ");
  const body = (
    <>
      <LineIcon tone={item.readState === "UNREAD" ? "gold" : "plain"}>
        <Icon />
      </LineIcon>
      <span className="min-w-0 flex-1">
        <span className={cn("block text-body text-fg", item.readState === "UNREAD" ? "font-semibold" : "font-medium")}>{item.title}</span>
        {item.bodyPreview ? <span className="mt-0.5 line-clamp-2 text-table text-fg-muted">{item.bodyPreview}</span> : null}
        {where ? <span className="mt-0.5 block text-table text-fg-subtle">{where}</span> : null}
      </span>
      <span className="shrink-0 self-start pt-0.5 font-mono text-meta text-fg-subtle">{dateText(new Date(item.createdAt), { day: "numeric", month: "short" }, locale, "en")}</span>
    </>
  );
  // An item of another company opens through the Activity Center, which moves the workspace first (Activity Center §49).
  const href = item.openIn || !item.href ? "/activity" : item.href;
  return (
    <Link href={href} className={lineRow} data-testid="inbox-activity">
      {body}
    </Link>
  );
}
