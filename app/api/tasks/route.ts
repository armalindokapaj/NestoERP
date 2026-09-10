import { apiOk, readJson, withContext } from "@/lib/api/respond";
import { parseTaskListQuery } from "@/lib/modules/tasks/task.query";
import { createTaskSchema } from "@/lib/modules/tasks/task.schema";
import * as tasks from "@/lib/modules/tasks/task.service";

/**
 * GET  /api/tasks — scoped, filtered, paginated list (PRD #11 §113, §114).
 * POST /api/tasks — create, requiring task.create (PRD #11 §52).
 *
 * Both run the same service the UI uses, so hiding a button in the interface
 * and refusing the request are never out of step (PRD #11 §20).
 */
export async function GET(request: Request) {
  return withContext(async (context) => {
    const url = new URL(request.url);
    const query = parseTaskListQuery(url.searchParams);
    return apiOk(await tasks.listTasks(context, query));
  });
}

export async function POST(request: Request) {
  return withContext(async (context) => {
    const body = await readJson(request);
    // companyId, createdByMemberId, completedAt and archivedAt are absent from
    // the schema, so they cannot be set from a request body (PRD #11 §116).
    const input = createTaskSchema.parse(body);
    return apiOk({ data: await tasks.createTask(context, input) }, { status: 201 });
  });
}
