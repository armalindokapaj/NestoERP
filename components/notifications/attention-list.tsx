"use client";

import * as React from "react";
import Link from "next/link";
import { TriangleAlert, X } from "lucide-react";

import { useLocale, useTranslations } from "@/components/i18n/i18n-provider";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import type { ReadableAttentionDTO } from "@/lib/core/notifications/attention.service";
import { cn } from "@/lib/utils/cn";

/**
 * Attention items (PRD #38 §83-§86): conditions, not messages. They leave when
 * the condition does; dismissing is offered only where the item allows it.
 */
export function AttentionList({ initial, compact = false }: { initial: ReadableAttentionDTO[]; compact?: boolean }) {
  const t = useTranslations("notificationCenter");
  const locale = useLocale();
  const toast = useToast();
  const [items, setItems] = React.useState(initial);

  React.useEffect(() => setItems(initial), [initial]);

  async function dismiss(item: ReadableAttentionDTO) {
    setItems((current) => current.filter((row) => row.id !== item.id));
    const response = await fetch(`/api/notifications/attention/${item.id}/dismiss`, { method: "POST" }).catch(() => null);
    if (response?.ok) {
      toast({ title: t("dismissed") });
    } else {
      setItems((current) => (current.some((row) => row.id === item.id) ? current : [item, ...current]));
      toast({ title: t("dismissFailed"), tone: "danger" });
    }
  }

  if (items.length === 0) {
    return <p className={cn("text-table text-fg-muted", compact ? "py-2" : "py-8 text-center text-body")}>{t("attentionEmpty")}</p>;
  }

  const date = new Intl.DateTimeFormat(locale, { day: "numeric", month: "short", year: "numeric" });

  return (
    <ul className="divide-y divide-line" data-testid="attention-list">
      {items.map((item) => (
        <li key={item.id} className={cn("flex items-start gap-3", compact ? "py-2.5" : "py-3")} data-testid="attention-item">
          <TriangleAlert
            aria-hidden="true"
            className={cn(
              "mt-0.5 size-4 shrink-0",
              item.priority === "CRITICAL" ? "text-danger-strong" : item.priority === "HIGH" ? "text-warning-strong" : "text-fg-subtle",
            )}
          />
          <div className="min-w-0 flex-1">
            <Link href={item.href} className="block text-table font-medium text-fg hover:text-accent-strong">
              {item.title}
            </Link>
            {item.body && !compact ? <p className="text-table text-fg-muted">{item.body}</p> : null}
            <p className="text-meta text-fg-subtle">
              {item.priority === "CRITICAL" ? <span className="mr-2 font-semibold text-danger-strong">{t("critical")}</span> : null}
              {item.priority === "HIGH" ? <span className="mr-2 font-medium text-warning-strong">{t("high")}</span> : null}
              {t("since", { date: date.format(new Date(item.firstDetectedAt)) })}
            </p>
          </div>
          {item.dismissible ? (
            <Button size="icon-sm" variant="ghost" aria-label={`${t("dismiss")}: ${item.title}`} title={t("dismiss")} onClick={() => void dismiss(item)}>
              <X aria-hidden="true" />
            </Button>
          ) : null}
        </li>
      ))}
    </ul>
  );
}
