import type { Metadata } from "next";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";

import { ModulePlaceholder } from "@/components/modules/module-placeholder";
import { requirePermission } from "@/lib/auth/session";

export const metadata: Metadata = {
  title: "New project",
};

/**
 * Write route. Reachable only with project.create, which read-only roles never
 * hold — the guard is enforced in middleware and again here (spec §69).
 */
export default async function NewProjectPage() {
  await requirePermission("project.create");

  return (
    <div className="space-y-5">
      <div>
        <Link
          href="/projects"
          className="inline-flex items-center gap-1 text-table text-fg-muted transition-colors hover:text-fg"
        >
          <ChevronLeft className="size-3.5" />
          Projects
        </Link>
        <h1 className="mt-2 text-page font-semibold text-fg">New project</h1>
        <p className="mt-1 text-body text-fg-muted">
          Create a project in your company workspace.
        </p>
      </div>

      <ModulePlaceholder
        title="Project creation"
        description="Project creation arrives with the Projects module in V0.2."
      />
    </div>
  );
}
