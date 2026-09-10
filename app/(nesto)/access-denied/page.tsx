import type { Metadata } from "next";
import Link from "next/link";
import { Lock } from "lucide-react";

import { Button } from "@/components/ui/button";

export const metadata: Metadata = {
  title: "Access denied",
};

/**
 * Unauthorized page (spec §56).
 * Nothing about the restricted area is described — no module name, no data.
 */
export default function AccessDeniedPage() {
  return (
    <div className="flex min-h-[60vh] items-center justify-center">
      <div className="max-w-sm text-center">
        <div className="mx-auto mb-4 grid size-11 place-items-center rounded-full border border-line bg-surface text-fg-subtle">
          <Lock className="size-5" />
        </div>
        <h1 className="text-section font-semibold text-fg">
          You don&apos;t have access to this area.
        </h1>
        <p className="mt-2 text-body text-fg-muted">
          If you need access, contact your company administrator.
        </p>
        <Button asChild className="mt-6">
          <Link href="/dashboard">Return to Dashboard</Link>
        </Button>
      </div>
    </div>
  );
}
