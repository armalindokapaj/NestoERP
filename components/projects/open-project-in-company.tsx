"use client";

import * as React from "react";
import Link from "@/components/navigation/nav-link";
import { useRouter } from "@/components/navigation/guarded-router";
import { Building2, Loader2 } from "lucide-react";

import { announcementApi, failureMessage } from "@/components/announcements/announcement-api";
import { Button } from "@/components/ui/button";

/**
 * Moves the session into the project's company, then opens the project
 * (E-05A §26).
 *
 * The server commits the new workspace before client navigation opens the
 * project, so the next server component payload is resolved in that company.
 */
export function OpenProjectInCompany({
  projectId,
  projectName,
  companyName,
  destination,
}: {
  projectId: string;
  projectName: string;
  companyName: string;
  destination: string;
}) {
  const router = useRouter();
  const [error, setError] = React.useState<string | null>(null);
  const started = React.useRef(false);

  React.useEffect(() => {
    if (started.current) return;
    started.current = true;
    announcementApi(`/api/projects/${projectId}/open`, { method: "POST" })
      .then(() => router.replace(destination))
      .catch((failure) => setError(failureMessage(failure, "This project could not be opened.")));
  }, [projectId, destination, router]);

  return (
    <div className="mx-auto flex max-w-md flex-col items-center py-24 text-center" data-testid="open-project-in-company">
      <div className="mb-4 flex size-12 items-center justify-center rounded-full border border-line bg-surface text-fg-subtle">
        {error ? <Building2 aria-hidden="true" className="size-5" /> : <Loader2 aria-hidden="true" className="size-5 animate-spin motion-reduce:animate-none" />}
      </div>
      {error ? (
        <>
          <p role="alert" className="text-card font-semibold text-fg">{error}</p>
          <Button asChild variant="secondary" size="sm" className="mt-4">
            <Link href="/projects">Back to projects</Link>
          </Button>
        </>
      ) : (
        <>
          <p className="text-card font-semibold text-fg" aria-live="polite">Opening {projectName}</p>
          <p className="mt-1 text-table text-fg-muted">Switching to {companyName}…</p>
        </>
      )}
    </div>
  );
}
