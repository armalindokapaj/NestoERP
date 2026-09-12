import Link from "next/link";
import { Download } from "lucide-react";

import { Button } from "@/components/ui/button";
import type { InventoryExportType } from "@/lib/modules/inventory/inventory.export";

/**
 * CSV export (PRD #20 §214, §215).
 *
 * A plain link carrying the current filters, so the file is the list the reader
 * is looking at — same scope, same warehouse visibility, same redaction. There
 * is no separate "export everything" door.
 */
export function InventoryExportLink({
  type,
  search,
  label = "Export CSV",
}: {
  type: InventoryExportType;
  search?: string;
  label?: string;
}) {
  const params = new URLSearchParams(search ?? "");
  params.set("type", type);

  return (
    <Button asChild variant="secondary" size="sm">
      <Link href={`/api/inventory/export?${params.toString()}`} prefetch={false}>
        <Download aria-hidden="true" />
        {label}
      </Link>
    </Button>
  );
}
