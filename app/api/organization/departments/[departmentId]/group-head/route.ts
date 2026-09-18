import { apiOk, readJson, withContext } from "@/lib/api/respond";
import { memberActor } from "@/lib/modules/organization/departments/department.actor";
import { appointGroupHead } from "@/lib/modules/organization/departments/department.assignment.service";
import { appointPersonSchema } from "@/lib/modules/organization/departments/department.schema";

type Params = { params: Promise<{ departmentId: string }> };

/** POST /api/organization/departments/:departmentId/group-head — appoint the head; `replace` ends the one in office (E-13 §11, §66, §70). */
export async function POST(request: Request, { params }: Params) {
  const departmentId = decodeURIComponent((await params).departmentId);
  return withContext(async (context) => {
    const input = appointPersonSchema.parse(await readJson(request));
    return apiOk({ data: await appointGroupHead(memberActor(context), departmentId, input) }, { status: 201 });
  });
}
