import { Hammer } from "lucide-react";

import { Icon } from "@/components/ui/icon";

/**
 * The standard "not built yet" state (spec §31, §68; design spec §29).
 * A module page always renders real structure; this fills the content area
 * until that section becomes functional. No blank screens.
 */
export function ModulePlaceholder({
  title,
  description = "Module functionality will be introduced progressively.",
}: {
  title: string;
  description?: string;
}) {
  return (
    <div className="rounded-lg border border-dashed border-line-strong bg-surface-muted px-6 py-14 text-center">
      <div className="mx-auto mb-3 grid size-10 place-items-center rounded-full border border-line bg-surface text-fg-subtle">
        <Icon icon={Hammer} size="lg" />
      </div>
      <p className="text-card font-semibold text-fg">{title}</p>
      <p className="mx-auto mt-1 max-w-md text-table text-fg-muted">
        This area is ready for development. {description}
      </p>
    </div>
  );
}
