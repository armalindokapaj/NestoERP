import { apiOk, readJson, withContext } from "@/lib/api/respond";
import {
  listPreferences,
  updatePreference,
  updatePreferenceSchema,
} from "@/lib/core/notifications/notification.preferences";

/** GET /api/notifications/preferences — the caller's own delivery choices by category (PRD #38 §78). */
export async function GET() {
  return withContext(async (context) => apiOk({ data: await listPreferences(context) }));
}

/**
 * PATCH /api/notifications/preferences — change one category.
 *
 * A member only ever writes their own row; the mandatory in-app lock is
 * enforced by the service whatever the request says.
 */
export async function PATCH(request: Request) {
  return withContext(async (context) => {
    const input = updatePreferenceSchema.parse(await readJson(request));
    return apiOk({ data: await updatePreference(context, input) });
  });
}
