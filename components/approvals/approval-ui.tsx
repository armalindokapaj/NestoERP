"use client";

import * as React from "react";
import {
  Building2,
  CircleAlert,
  ClipboardCheck,
  Clock,
  FileCheck,
  Handshake,
  Landmark,
  type LucideIcon,
  Scale,
  ShieldCheck,
  ShoppingCart,
  Stamp,
  TrendingUp,
  Users,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import type { ApprovalMoney, ApprovalPriority, ApprovalProviderKey, DueState, UnifiedApprovalItem, UnifiedApprovalStatus } from "@/lib/modules/approvals/approvals.types";
import { cn } from "@/lib/utils/cn";

/**
 * The small, restrained vocabulary the Approvals Center is drawn with (PRD
 * #41 §104-§106, §215, §216): a module icon and label rather than a colour per
 * module, semantic tones for status, and words beside every colour so nothing
 * is carried by colour alone (§103).
 */

export const SOURCE_ICONS: Record<ApprovalProviderKey, LucideIcon> = {
  finance: Landmark,
  procurement: ShoppingCart,
  hr: Users,
  sales: TrendingUp,
  legal: Scale,
  documents: FileCheck,
  qaqc: ClipboardCheck,
  hse: ShieldCheck,
  timesheets: Clock,
  projects: Building2,
  unit_sales: Handshake,
};

export function SourceIcon({ provider, className }: { provider: ApprovalProviderKey; className?: string }) {
  const Icon = SOURCE_ICONS[provider] ?? Stamp;
  return (
    <span aria-hidden="true" className={cn("flex size-9 shrink-0 items-center justify-center rounded-lg border border-line bg-surface-muted text-fg-muted", className)}>
      <Icon className="size-4" />
    </span>
  );
}

const STATUS_TONE: Record<UnifiedApprovalStatus, "default" | "neutral" | "success" | "warning" | "danger" | "info"> = {
  PENDING: "info",
  APPROVED: "success",
  REJECTED: "danger",
  RETURNED: "warning",
  CANCELLED: "default",
  EXPIRED: "default",
};

const STATUS_TEXT: Record<UnifiedApprovalStatus, string> = {
  PENDING: "Pending",
  APPROVED: "Approved",
  REJECTED: "Rejected",
  RETURNED: "Returned",
  CANCELLED: "Cancelled",
  EXPIRED: "Expired",
};

export function StatusBadge({ status }: { status: UnifiedApprovalStatus }) {
  return <Badge tone={STATUS_TONE[status]}>{STATUS_TEXT[status]}</Badge>;
}

export function PriorityBadge({ priority }: { priority: ApprovalPriority }) {
  if (priority !== "HIGH" && priority !== "CRITICAL") return null;
  return (
    <Badge tone={priority === "CRITICAL" ? "danger" : "warning"} className="uppercase tracking-[0.06em]">
      {priority === "CRITICAL" ? "Critical" : "High"}
    </Badge>
  );
}

const DAY = 86_400_000;

function dayStart(value: Date) {
  return Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate());
}

export function dueText(dueAt: string | null, state: DueState, now = new Date()): string | null {
  if (!dueAt || state === "none") return null;
  const days = Math.round((dayStart(new Date(dueAt)) - dayStart(now)) / DAY);
  if (state === "overdue") return `Overdue ${Math.abs(days)}d`;
  if (state === "due_today") return "Due today";
  return `Due in ${days}d`;
}

export function DueBadge({ item }: { item: Pick<UnifiedApprovalItem, "dueAt" | "dueState" | "status"> }) {
  if (item.status !== "PENDING") return null;
  const text = dueText(item.dueAt, item.dueState);
  if (!text) return null;
  const tone = item.dueState === "overdue" ? "danger" : item.dueState === "due_today" ? "warning" : "default";
  return (
    <Badge tone={tone}>
      {item.dueState === "overdue" ? <CircleAlert aria-hidden="true" className="size-3" /> : <Clock aria-hidden="true" className="size-3" />}
      {text}
    </Badge>
  );
}

export function formatMoney(amount: ApprovalMoney | null): string | null {
  if (!amount) return null;
  const value = Number(amount.value);
  try {
    return new Intl.NumberFormat("en-GB", { style: "currency", currency: amount.currency, maximumFractionDigits: value % 1 === 0 ? 0 : 2 }).format(value);
  } catch {
    return `${amount.currency} ${value.toFixed(2)}`;
  }
}

/** "13 Sep 2026, 14:32" (PRD #41 §211). */
export function formatStamp(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(iso));
}

export function formatDay(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric" }).format(new Date(iso));
}

/** "Waiting 3 days" (PRD #41 §166). */
export function waitingText(requestedAt: string, now = new Date()): string {
  const hours = Math.floor((now.getTime() - new Date(requestedAt).getTime()) / 3_600_000);
  if (hours < 1) return "Just now";
  if (hours < 24) return `Waiting ${hours}h`;
  const days = Math.floor(hours / 24);
  return `Waiting ${days} ${days === 1 ? "day" : "days"}`;
}

export function relativeText(iso: string, now = new Date()): string {
  const minutes = Math.floor((now.getTime() - new Date(iso).getTime()) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return formatDay(iso);
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? "") + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase() || "?";
}

export function PersonMark({ name, className }: { name: string; className?: string }) {
  return (
    <span aria-hidden="true" className={cn("inline-flex size-5 shrink-0 items-center justify-center rounded-full bg-surface-muted text-micro font-semibold text-fg-muted ring-1 ring-line", className)}>
      {initials(name)}
    </span>
  );
}

/** Plain text, line breaks kept, never interpreted as markup. */
export function PlainText({ text, className }: { text: string; className?: string }) {
  return <p className={cn("whitespace-pre-line break-words", className)}>{text}</p>;
}
