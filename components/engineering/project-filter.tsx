"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { useRouter } from "@/components/navigation/guarded-router";

import { selectClass } from "@/components/forms/record-form";
import { cn } from "@/lib/utils/cn";

/** One project, or all of them, for a report (PRD #46 §206). The choice lives in the URL. */
export function ProjectFilter({ projects, className }: { projects: Array<{ id: string; name: string }>; className?: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  return (
    <label className={cn("flex items-center gap-2 text-table text-fg-muted", className)}>
      Project
      <select
        className={cn(selectClass, "h-9 w-auto min-w-[14rem]")}
        value={params.get("projectId") ?? ""}
        onChange={(event) => {
          const next = new URLSearchParams(params.toString());
          if (event.target.value) next.set("projectId", event.target.value);
          else next.delete("projectId");
          router.replace(`${pathname}${next.size ? `?${next}` : ""}`);
        }}
      >
        <option value="">All projects</option>
        {projects.map((project) => (
          <option key={project.id} value={project.id}>
            {project.name}
          </option>
        ))}
      </select>
    </label>
  );
}
