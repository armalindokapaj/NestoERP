"use client";

import * as React from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { selectClass } from "@/components/forms/record-form";
import { useToast } from "@/components/ui/toast";
import { linkProjectAction } from "@/lib/actions/sales";
import type { Option } from "@/lib/modules/sales/sales.options";

/**
 * Links a project to an already-won opportunity (PRD #17 §423).
 *
 * Only projects belonging to the deal's own client are offered, and the server
 * refuses a mismatch regardless (PRD #17 §89).
 */
export function LinkProjectForm({
  opportunityId,
  projects,
  cancelHref,
}: {
  opportunityId: string;
  projects: Option[];
  cancelHref: string;
}) {
  const router = useRouter();
  const toast = useToast();
  const [projectId, setProjectId] = React.useState("");
  const [pending, startTransition] = React.useTransition();

  function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!projectId) return;

    startTransition(async () => {
      const result = await linkProjectAction(opportunityId, projectId);
      if (result.ok) {
        toast({ title: "Project linked.", tone: "success" });
        router.push(cancelHref);
      } else {
        toast({ title: result.error, tone: "danger" });
      }
    });
  }

  if (projects.length === 0) {
    return (
      <p className="nesto-card p-5 text-table text-fg-muted">
        There is no project for this client yet. Create one in Projects, then come back.
      </p>
    );
  }

  return (
    <form onSubmit={submit} className="nesto-card space-y-4 p-5">
      <div className="space-y-1.5">
        <Label htmlFor="projectId">Project</Label>
        <select
          id="projectId"
          className={selectClass}
          value={projectId}
          onChange={(event) => setProjectId(event.target.value)}
          required
        >
          <option value="">Choose a project</option>
          {projects.map((project) => (
            <option key={project.value} value={project.value}>
              {project.label}
            </option>
          ))}
        </select>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" disabled={pending || !projectId}>
          {pending ? "Linking…" : "Link project"}
        </Button>
        <Button type="button" variant="secondary" onClick={() => router.push(cancelHref)}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
