import { apiOk, readJson, withContext } from "@/lib/api/respond";
import { updateMemberSchema } from "@/lib/modules/team/team.schema";
import { placeMembership } from "@/lib/modules/organization/departments/placement.door";
import * as team from "@/lib/modules/team/team.service";

type Params = { params: Promise<{ memberId: string }> };

/**
 * A member outside the caller's scope answers 404 rather than 403, so the
 * response cannot be used to discover who works here (PRD #14 §160).
 */
export async function GET(_request: Request, { params }: Params) {
  const { memberId } = await params;
  return withContext(async (context) => apiOk({ data: await team.getMember(context, memberId) }));
}

export async function PATCH(request: Request, { params }: Params) {
  const { memberId } = await params;
  return withContext(async (context) => {
    // Membership fields only: status has dedicated endpoints, and name, phone
    // and avatar belong to the person's own profile (PRD #14 §86, §155).
    const input = updateMemberSchema.parse(await readJson(request));
    return apiOk({ data: await team.updateMember(context, memberId, input, { placement: placeMembership }) });
  });
}
