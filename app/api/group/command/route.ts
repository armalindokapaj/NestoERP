import { z } from "zod";

import { AccessError } from "@/lib/access/guards";
import { apiOk, readJson, withGroupContext } from "@/lib/api/respond";
import { groupActor } from "@/lib/modules/platform/group-actor";
import { addGroupUserAs, removeGroupUserAs } from "@/lib/modules/platform/platform-group-users.service";
import { createGroupCompanyAs } from "@/lib/modules/platform/platform-implementation.service";
import { createGroupCompanySchema } from "@/lib/modules/platform/platform.schema";

/**
 * The group's own commands (Admin PRD #9 §28, §63): a person who belongs to a
 * parent group, and to no company, administers it from here. Every command
 * names the group it acts on and is refused for any group but the one the seat
 * belongs to; what each may do is a capability of the seat's role, checked in
 * the service.
 */
const envelope = z.object({ action: z.string().min(1).max(64) }).passthrough();

export async function POST(request: Request) {
  return withGroupContext(async (context) => {
    const body = envelope.parse(await readJson(request));
    const actor = groupActor(context);
    switch (body.action) {
      case "group.user.add":
        return apiOk({ data: await addGroupUserAs(actor, body) }, { status: 201 });
      case "group.user.remove":
        await removeGroupUserAs(actor, body);
        return apiOk({ data: { ok: true } });
      case "group.company.create": {
        const input = createGroupCompanySchema.parse(body);
        return apiOk({ data: await createGroupCompanyAs(actor, context.groupId, input) }, { status: 201 });
      }
      default:
        throw new AccessError("VALIDATION_ERROR", "Unknown action.");
    }
  });
}
