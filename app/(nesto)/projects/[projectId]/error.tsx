"use client";

import { Button } from "@/components/ui/button";

export default function ProjectWorkspaceError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="nesto-card grid min-h-72 place-items-center p-6 text-center">
      <div><h1 className="text-section font-semibold text-fg">Project could not be loaded.</h1><p className="mt-2 text-body text-fg-muted">Try loading the workspace again.</p><Button className="mt-5" onClick={reset}>Try again</Button></div>
    </div>
  );
}
