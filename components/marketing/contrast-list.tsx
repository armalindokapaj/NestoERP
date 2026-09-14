import { ArrowRight } from "lucide-react";

import { getSiteCopy } from "@/lib/i18n/server";
import { cn } from "@/lib/utils/cn";

/**
 * How a construction company works today, beside how it works in NESTO.
 *
 * A claim on its own is marketing; a claim next to the thing it replaces is an
 * argument. Each row is one sentence per side, so the comparison can be read at
 * a glance rather than studied.
 */
export async function ContrastList({ className }: { className?: string }) {
  const { contrasts } = await getSiteCopy();

  return (
    <ul className={cn("divide-y divide-line border-y border-line", className)}>
      {contrasts.map((row) => (
        <li key={row.after} className="grid gap-3 py-6 md:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] md:items-center md:gap-8">
          <p className="text-body leading-relaxed text-fg-subtle line-through decoration-line-strong decoration-1">
            {row.before}
          </p>
          <ArrowRight
            aria-hidden="true"
            className="hidden size-4 shrink-0 text-fg-subtle md:block"
          />
          <p className="text-body font-medium leading-relaxed text-fg">{row.after}</p>
        </li>
      ))}
    </ul>
  );
}
