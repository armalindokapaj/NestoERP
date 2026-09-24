"use client";

import Link from "@/components/navigation/nav-link";
import { useSearchParams } from "next/navigation";
import { Download } from "lucide-react";

import { Button } from "@/components/ui/button";

/**
 * Downloads the list as it is currently filtered (PRD #17 §170, §171).
 *
 * The link carries the page's own search parameters, so the file matches the
 * screen. Nothing here decides what may be exported — the endpoint re-runs the
 * list service, which re-runs the scope.
 */
export function SalesExportLink({
  type,
  label = "Export CSV",
}: {
  type: "leads" | "opportunities" | "proposals";
  label?: string;
}) {
  const searchParams = useSearchParams();

  const params = new URLSearchParams(searchParams.toString());
  params.delete("page");
  params.set("type", type);

  return (
    <Button asChild variant="secondary" size="sm">
      <Link href={`/api/sales/export?${params.toString()}`} prefetch={false} download>
        <Download aria-hidden="true" />
        {label}
      </Link>
    </Button>
  );
}
