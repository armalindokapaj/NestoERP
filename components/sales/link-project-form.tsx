"use client";

import * as React from "react";
import { useRouter } from "@/components/navigation/guarded-router";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { selectClass } from "@/components/forms/record-form";
import { useToast } from "@/components/ui/toast";
import { SaveMessages, UnsavedIndicator } from "@/components/unsaved/editor-status";
import { useEditorSave } from "@/components/unsaved/use-editor-save";
import { linkProjectAction } from "@/lib/actions/sales";
import { committed } from "@/lib/forms/committed";
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
  const formRef = React.useRef<HTMLFormElement>(null);
  const [projectId, setProjectId] = React.useState("");

  // The link is an ordinary save under the unsaved-work contract (AUD-03 §3):
  // its answer is explicit, and a committed link opens the opportunity.
  const save = useEditorSave({
    formRef,
    module: "sales",
    saveKind: "save",
    label: "Project link",
    action: async (formData: FormData) => {
      const result = await linkProjectAction(opportunityId, String(formData.get("projectId") ?? ""));
      return result.ok ? committed(cancelHref) : result;
    },
    onCommitted: () => {
      toast({ title: "Project linked.", tone: "success" });
    },
  });
  const { pending } = save;

  if (projects.length === 0) {
    return (
      <p className="nesto-card p-5 text-table text-fg-muted">
        There is no project for this client yet. Create one in Projects, then come back.
      </p>
    );
  }

  return (
    <form ref={formRef} onSubmit={save.onSubmit} className="nesto-card space-y-4 p-5">
      <SaveMessages save={save} />
      <fieldset disabled={pending || Boolean(save.saved)} className="m-0 min-w-0 space-y-1.5 border-0 p-0">
        <Label htmlFor="projectId">Project</Label>
        <select
          id="projectId"
          name="projectId"
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
      </fieldset>

      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" disabled={pending || !projectId || Boolean(save.saved)}>
          {pending ? "Linking…" : "Link project"}
        </Button>
        <Button type="button" variant="secondary" onClick={() => router.push(cancelHref)} disabled={pending}>
          Cancel
        </Button>
        <UnsavedIndicator save={save} />
      </div>
    </form>
  );
}
