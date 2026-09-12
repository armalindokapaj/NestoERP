import Link from "next/link";
import { Download } from "lucide-react";

import { Button } from "@/components/ui/button";
import type { HseExportKind } from "@/lib/modules/hse/hse.export";

/**
 * CSV export (PRD #22 §216, §217).
 *
 * A plain link carrying the current filters, so the file is the list the reader
 * is looking at — same scope, same rows. There is no separate "export
 * everything" door.
 */
export function HseExportLink({
  kind,
  search,
  label = "Export CSV",
}: {
  kind: HseExportKind;
  search?: string;
  label?: string;
}) {
  const params = new URLSearchParams(search ?? "");
  params.set("kind", kind);

  return (
    <Button asChild variant="secondary" size="sm">
      <Link href={`/api/hse/export?${params.toString()}`} prefetch={false}>
        <Download aria-hidden="true" />
        {label}
      </Link>
    </Button>
  );
}
