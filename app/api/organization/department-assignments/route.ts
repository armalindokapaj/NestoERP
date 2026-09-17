import { apiOk, readJson, withContext } from "@/lib/api/respond";
import { appoint, appointSchema } from "@/lib/modules/organization/appointment.service";

/**
 * POST /api/organization/department-assignments — appoint a group department
 * head, or a company branch's manager (E-06 §37, §38, §90).
 */
export async function POST(request: Request) {
  return withContext(async (context) => {
    const input = appointSchema.parse(await readJson(request));
    return apiOk({ data: await appoint(context, input) }, { status: 201 });
  });
}
