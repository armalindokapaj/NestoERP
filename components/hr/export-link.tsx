"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Download } from "lucide-react";

import { Button } from "@/components/ui/button";

/**
 * Downloads the list as it is currently filtered (PRD #16 §146, §147).
 *
 * The link carries the page's own search parameters, so the file matches the
 * screen. Nothing here decides what may be exported — the endpoint re-runs the
 * list service, which re-runs the scope.
 */
export function HrExportLink({
  type,
  label = "Export CSV",
}: {
  type: "employees" | "leave" | "attendance";
  label?: string;
}) {
  const searchParams = useSearchParams();

  const params = new URLSearchParams(searchParams.toString());
  params.delete("page");
  params.set("type", type);

  return (
    <Button asChild variant="secondary" size="sm">
      <Link href={`/api/hr/export?${params.toString()}`} prefetch={false} download>
        <Download aria-hidden="true" />
        {label}
      </Link>
    </Button>
  );
}
