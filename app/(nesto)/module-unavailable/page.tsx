import type { Metadata } from "next";
import Link from "next/link";
import { ToggleRight } from "lucide-react";

import { Button } from "@/components/ui/button";

export const metadata: Metadata = {
  title: "Module unavailable",
};

/**
 * A module the company has switched off (PRD #7 §81).
 *
 * Deliberately distinct from Access Denied: nothing about this person's role is
 * wrong, and there is nothing they can change. Their administrator enables the
 * module, or nobody does (PRD #5 §99).
 */
export default function ModuleUnavailablePage() {
  return (
    <div className="flex min-h-[60vh] items-center justify-center">
      <div className="max-w-sm text-center">
        <div className="mx-auto mb-4 grid size-11 place-items-center rounded-full border border-line bg-surface text-fg-subtle">
          <ToggleRight className="size-5" />
        </div>
        <h1 className="text-section font-semibold text-fg">Module unavailable</h1>
        <p className="mt-2 text-body text-fg-muted">
          This module is not enabled for your company.
        </p>
        <Button asChild className="mt-6">
          <Link href="/dashboard">Return to Dashboard</Link>
        </Button>
      </div>
    </div>
  );
}
