import { revalidatePath } from "next/cache";

import type { TaskMutationEffects } from "./task.mutation";

/**
 * What a task change makes stale, for the API routes and the server actions
 * alike (AUD-02 §8): the task lists (My Tasks, Overdue, Completed, Archived
 * are all under `/tasks`), the task itself, the dashboard counters, both
 * projects when the task moved, the meeting whose action followed it, and the
 * record it was raised from.
 *
 * Nothing between users is cached; this is what makes the next navigation,
 * Refresh or Back in the actor's own browser read the committed task. Another
 * person's open page is kept honest by the version, not by this.
 */
export function revalidateTaskViews(taskId: string, effects?: Partial<TaskMutationEffects>): void {
  const paths: Array<[string, "layout" | "page"]> = [
    ["/tasks", "layout"],
    [`/tasks/${taskId}`, "layout"],
    ["/dashboard", "page"],
    ...(effects?.projectIds ?? []).map((id): [string, "layout"] => [`/projects/${id}`, "layout"]),
    ...(effects?.meetingIds ?? []).map((id): [string, "layout"] => [`/meetings/${id}`, "layout"]),
    ...(effects?.parentHref ? [[effects.parentHref, "layout"] as [string, "layout"]] : []),
  ];
  for (const [path, type] of paths) {
    try {
      revalidatePath(path, type);
    } catch (error) {
      // Outside a request — a script, or a test calling a route handler
      // directly — there is no cache to invalidate.
      if (!(error instanceof Error && error.message.includes("static generation store missing"))) throw error;
    }
  }
}
