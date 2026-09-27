"use client";

import { ExportControl } from "@/lib/core/export/export-control";
import type { InventoryExportType } from "@/lib/modules/inventory/inventory.export";

/**
 * CSV export (PRD #20 §214, §215; AUD-08 §7).
 *
 * Every row the list's current filters match — same scope, same warehouse
 * visibility, same redaction, same order — read from the page's own address
 * when clicked, so a filtered reservation list exports the filtered
 * reservations even where the page passes no `search`. There is no separate
 * "export everything" door.
 */
export function InventoryExportLink({
  type,
  label = "Export CSV",
}: {
  type: InventoryExportType;
  search?: string;
  label?: string;
}) {
  return <ExportControl endpoint="/api/inventory/export" selector={{ param: "type", value: type }} label={label} testId={`inventory-export-${type}`} />;
}
