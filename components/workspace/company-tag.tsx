import { Building2 } from "lucide-react";

import { cn } from "@/lib/utils/cn";

/**
 * The company a row belongs to, on a list in the Group workspace (Workspace
 * Context §30, §32, §45). Without it a row from one company reads like any
 * other.
 */
export function CompanyTag({ name, className }: { name: string; className?: string }) {
  return (
    <span
      data-testid="company-tag"
      className={cn("inline-flex max-w-full items-center gap-1 rounded-full border border-line bg-surface-muted px-2 py-0.5 text-micro font-medium text-fg-muted", className)}
    >
      <Building2 aria-hidden="true" className="size-3 shrink-0" />
      <span className="truncate">{name}</span>
    </span>
  );
}
