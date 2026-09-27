import { Boxes, Building2, ClipboardCheck, FileSignal, FileText, Flag, FolderKanban, HardHat, NotebookPen, Presentation, ReceiptText, ShoppingCart, SquareCheckBig, type LucideIcon } from "lucide-react";

import type { Translate } from "@/lib/i18n/translator";
import type { NavigableType } from "@/lib/modules/productivity/navigable.types";

/** The shared record-type icons and relative times for Favorites and Recent Work (PRD #45; Fast Re-entry §58, §171). */

export const ENTITY_ICON: Record<NavigableType, LucideIcon> = {
  project: FolderKanban,
  project_milestone: Flag,
  task: SquareCheckBig,
  meeting: Presentation,
  daily_log: NotebookPen,
  client: Building2,
  document: FileText,
  contract: FileSignal,
  purchase_order: ShoppingCart,
  invoice: ReceiptText,
  project_unit: Boxes,
  purchase_request: ShoppingCart,
  rfq: ShoppingCart,
  quality_inspection: ClipboardCheck,
  non_conformance_report: ClipboardCheck,
  incident: HardHat,
};

export function relativeTime(iso: string, now = Date.now(), t?: Translate<"common">): string {
  const minutes = Math.round((now - new Date(iso).getTime()) / 60_000);
  if (minutes < 1) return t ? t("time.justNow") : "Just now";
  if (minutes < 60) return t ? t("time.minutesAgo", { count: minutes }) : `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return t ? t("time.hoursAgo", { count: hours }) : `${hours} h ago`;
  const days = Math.round(hours / 24);
  if (days === 1) return t ? t("time.yesterday") : "Yesterday";
  return t ? t("time.daysAgo", { count: days }) : `${days} days ago`;
}
