import { apiOk, readJson, withPlatformContext } from "@/lib/api/respond";
import { platformActor } from "@/lib/modules/organization/departments/department.actor";
import { appointGroupHead } from "@/lib/modules/organization/departments/department.assignment.service";
import { appointPersonSchema } from "@/lib/modules/organization/departments/department.schema";

type Params = { params: Promise<{ groupId: string; departmentId: string }> };

/** POST …/departments/:departmentId/group-head — the initial head (E-13 §50, §94). */
export async function POST(request: Request, { params }: Params) {
  const { groupId, departmentId } = await params;
  return withPlatformContext(async (context) => {
    const input = appointPersonSchema.parse(await readJson(request));
    return apiOk({ data: await appointGroupHead(platformActor(context, groupId), decodeURIComponent(departmentId), input) }, { status: 201 });
  });
}
