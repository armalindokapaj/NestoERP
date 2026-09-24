import Link from "@/components/navigation/nav-link";
import { Download } from "lucide-react";

import { Button } from "@/components/ui/button";
import type { QaqcExportType } from "@/lib/modules/qaqc/qaqc.export";

/**
 * CSV export (PRD #21 §201, §202).
 *
 * A plain link carrying the current filters, so the file is the list the reader
 * is looking at — same scope, same rows. There is no separate "export
 * everything" door.
 */
export function QaqcExportLink({
  type,
  search,
  label = "Export CSV",
}: {
  type: QaqcExportType;
  search?: string;
  label?: string;
}) {
  const params = new URLSearchParams(search ?? "");
  params.set("kind", type);

  return (
    <Button asChild variant="secondary" size="sm">
      <Link href={`/api/qaqc/export?${params.toString()}`} prefetch={false}>
        <Download aria-hidden="true" />
        {label}
      </Link>
    </Button>
  );
}
