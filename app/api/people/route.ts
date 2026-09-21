import { apiOk, withContext } from "@/lib/api/respond";
import { directoryQuerySchema } from "@/lib/modules/people/people.schema";
import { listPeople } from "@/lib/modules/people/people.service";

/** GET /api/people — the group's people directory, searched and filtered, a page at a time (E-01 §35-§40, §123). */
export async function GET(request: Request) {
  // `group: "read"`: the directory is group-wide by design, and a company workspace narrows it (Workspace Context §46).
  return withContext(
    async (context) => {
      const url = new URL(request.url);
      return apiOk(await listPeople(context, directoryQuerySchema.parse(Object.fromEntries(url.searchParams))));
    },
    { group: "read" },
  );
}
