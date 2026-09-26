import { apiOk, readJson, withContext } from "@/lib/api/respond";
import { revalidateTaskViews } from "@/lib/modules/tasks/task.invalidate";
import { parseTaskListQuery } from "@/lib/modules/tasks/task.query";
import { createTaskSchema } from "@/lib/modules/tasks/task.schema";
import * as tasks from "@/lib/modules/tasks/task.service";
import { listTasksForWorkspace } from "@/lib/modules/tasks/task.workspace";

/**
 * GET  /api/tasks — scoped, filtered, paginated list (PRD #11 §113, §114).
 * POST /api/tasks — create, requiring task.create (PRD #11 §52).
 *
 * Both run the same service the UI uses, so hiding a button in the interface
 * and refusing the request are never out of step (PRD #11 §20). Only the list
 * reads across companies in the Group workspace; a create is refused there.
 */
export async function GET(request: Request) {
  return withContext(
    async (context) => {
      const url = new URL(request.url);
      const query = parseTaskListQuery(url.searchParams);
      // Company workspace: this company's tasks. Group workspace: the union of
      // every company the person may open Tasks in, each row naming its
      // company; `company` narrows it and is checked against those companies
      // (Workspace Context §32, §58, §86).
      return apiOk(await listTasksForWorkspace(context, query));
    },
    { group: "read" },
  );
}

export async function POST(request: Request) {
  return withContext(async (context) => {
    const body = await readJson(request);
    // companyId, createdByMemberId, completedAt and archivedAt are absent from
    // the schema, so they cannot be set from a request body (PRD #11 §116).
    const input = createTaskSchema.parse(body);
    const task = await tasks.createTask(context, input);
    // The same invalidation as the server action (AUD-02 §8); the task starts at version 1.
    revalidateTaskViews(task.id, { projectIds: task.project ? [task.project.id] : [] });
    return apiOk({ data: task }, { status: 201 });
  });
}
