import { AccessError } from "@/lib/access/guards";
import { apiOk } from "@/lib/api/respond";
import { revalidateTaskViews } from "./task.invalidate";
import type { TaskMutationResponse } from "./task.service";

/**
 * The task command routes' shared edges (AUD-02 §6).
 *
 * A command's body is where its version travels, so an absent body is not a
 * malformed request: it is a request that named no version, and the command
 * answers 428 for it — after the access checks, like every other refusal. A
 * body that is there but is not a JSON object is still 422.
 */
export async function readCommandBody(request: Request): Promise<Record<string, unknown>> {
  const text = await request.text();
  if (text.trim() === "") return {};
  try {
    const body = JSON.parse(text);
    if (body && typeof body === "object" && !Array.isArray(body)) return body as Record<string, unknown>;
  } catch {
    // fall through
  }
  throw new AccessError("VALIDATION_ERROR", "Expected a JSON object body.");
}

/**
 * `{ data, meta }`, and `redirectTo` when the change took the task out of the
 * caller's sight. The same invalidation as the server actions runs first.
 */
export function commandResponse(result: TaskMutationResponse): Response {
  if (result.meta.changed) revalidateTaskViews(result.meta.taskId, result.effects);
  return apiOk({ data: result.data, meta: result.meta, ...(result.redirectTo ? { redirectTo: result.redirectTo } : {}) });
}
