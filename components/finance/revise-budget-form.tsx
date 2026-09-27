"use client";

import * as React from "react";
import Link from "@/components/navigation/nav-link";

import { useFinanceTranslations } from "@/components/finance/finance-text";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { reviseBudgetAction } from "@/lib/actions/finance";

/**
 * Confirms opening the next budget version (PRD #15 §115).
 *
 * On success the action redirects to the new draft, so anything that comes back
 * here is a failure.
 */
export function ReviseBudgetForm({
  budgetId,
  nextVersion,
  currency,
  lineCount,
  cancelHref,
}: {
  budgetId: string;
  nextVersion: number;
  currency: string;
  lineCount: number;
  cancelHref: string;
}) {
  const toast = useToast();
  const t = useFinanceTranslations();
  const [pending, startTransition] = React.useTransition();

  function revise() {
    startTransition(async () => {
      const result = await reviseBudgetAction(budgetId);
      if (result && !result.ok) toast({ title: result.error, tone: "danger" });
    });
  }

  return (
    <div className="nesto-card p-6">
      <p className="text-body text-fg">
        {t("revise.body", { version: nextVersion, count: lineCount })}
      </p>
      <p className="mt-3 text-table text-fg-muted">
        {t("revise.currency", { currency })}
      </p>

      <div className="mt-5 flex flex-wrap items-center gap-2">
        <Button onClick={revise} disabled={pending}>
          {pending ? t("revise.creating") : t("revise.create", { version: nextVersion })}
        </Button>
        <Button asChild variant="secondary">
          <Link href={cancelHref}>{t("revise.cancel")}</Link>
        </Button>
      </div>
    </div>
  );
}
