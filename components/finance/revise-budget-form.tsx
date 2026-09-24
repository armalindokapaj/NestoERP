"use client";

import * as React from "react";
import Link from "@/components/navigation/nav-link";

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
        Version {nextVersion} will be created as a draft, copying all {lineCount} line
        {lineCount === 1 ? "" : "s"} from the approved version. The approved budget is left
        untouched until the revision is approved in its turn.
      </p>
      <p className="mt-3 text-table text-fg-muted">
        The currency stays {currency}: the project&apos;s costs are already recorded in it, and
        V0.1 does not convert currencies.
      </p>

      <div className="mt-5 flex flex-wrap items-center gap-2">
        <Button onClick={revise} disabled={pending}>
          {pending ? "Creating…" : `Create version ${nextVersion}`}
        </Button>
        <Button asChild variant="secondary">
          <Link href={cancelHref}>Cancel</Link>
        </Button>
      </div>
    </div>
  );
}
