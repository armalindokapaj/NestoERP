import Link from "@/components/navigation/nav-link";
import { Download } from "lucide-react";

import { Button } from "@/components/ui/button";

/**
 * CSV export (PRD #18 §225, §226).
 *
 * A plain link carrying the current filters, so the file is the list the reader
 * is looking at — including its redaction (PRD #18 §227).
 */
export function ContractExportLink({
  type = "contracts",
  search,
}: {
  type?: "contracts" | "obligations" | "amendments";
  search?: string;
}) {
  const params = new URLSearchParams(search ?? "");
  params.set("type", type);

  return (
    <Button asChild variant="secondary" size="sm">
      <Link href={`/api/contracts/export?${params.toString()}`} prefetch={false}>
        <Download aria-hidden="true" />
        Export CSV
      </Link>
    </Button>
  );
}
