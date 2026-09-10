import { Plus } from "lucide-react";

import type { FaqItem } from "@/config/marketing";
import { cn } from "@/lib/utils/cn";

/**
 * Questions and answers.
 *
 * Built on <details> rather than React state: it opens without JavaScript, it
 * is keyboard operable and announced correctly with no ARIA of our own, and the
 * browser will find text inside a collapsed answer. The whole section costs
 * nothing to ship.
 */
export function FaqList({
  items,
  className,
}: {
  items: readonly FaqItem[];
  className?: string;
}) {
  return (
    <div className={cn("divide-y divide-line border-y border-line", className)}>
      {items.map((item) => (
        <details key={item.question} className="group">
          <summary className="flex cursor-pointer list-none items-start gap-4 py-5 [&::-webkit-details-marker]:hidden">
            <h3 className="flex-1 text-balance text-card font-medium text-fg transition-colors group-hover:text-accent-strong">
              {item.question}
            </h3>
            <Plus
              aria-hidden="true"
              className="mt-0.5 size-4 shrink-0 text-fg-subtle transition-transform group-open:rotate-45"
            />
          </summary>
          <p className="max-w-2xl pb-6 text-body leading-relaxed text-fg-muted">{item.answer}</p>
        </details>
      ))}
    </div>
  );
}
