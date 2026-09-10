import * as React from "react";
import Link from "next/link";
import { Inbox } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils/cn";

export type EmptyStateProps = {
  title: string;
  description?: string;
  icon?: React.ReactNode;
  /** Rendered only when supplied — callers gate this on a permission check. */
  action?: { label: string; href: string };
  className?: string;
};

/**
 * The standard NESTO empty state (spec §59; design spec §30). Designed now so
 * that a module becoming functional is a matter of replacing the data, not the
 * layout.
 */
export function EmptyState({ title, description, icon, action, className }: EmptyStateProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center rounded-lg border border-dashed border-line-strong bg-surface-muted px-6 py-14 text-center",
        className,
      )}
    >
      <div className="mb-3 flex size-10 items-center justify-center rounded-full border border-line bg-surface text-fg-subtle [&_svg]:size-5">
        {icon ?? <Inbox />}
      </div>
      <p className="text-card font-semibold text-fg">{title}</p>
      {description ? (
        <p className="mt-1 max-w-sm text-table text-fg-muted">{description}</p>
      ) : null}
      {action ? (
        <Button asChild variant="secondary" size="sm" className="mt-4">
          <Link href={action.href}>{action.label}</Link>
        </Button>
      ) : null}
    </div>
  );
}
