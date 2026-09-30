import { z } from "zod";

import { apiError, apiOk, readJson, withContext } from "@/lib/api/respond";
import { adminActOnDevice, getDevice } from "@/lib/modules/security/security.service";

type Params = { params: Promise<{ deviceId: string }> };

export async function GET(_request: Request, { params }: Params) {
  return withContext(async (context) => apiOk({ data: await getDevice(context, (await params).deviceId) }), { group: "read" });
}

const actionSchema = z.object({
  action: z.enum(["SIGN_OUT", "REAUTH", "REVOKE", "LOST", "BLOCK", "RESTORE"]),
  reason: z.string().trim().max(200).optional(),
});

/**
 * An administrator acts on a device in their scope (MOB-11 §29, §184, §185).
 * Sessions and devices are separate grants; every action needs a recent sign-in.
 */
export async function POST(request: Request, { params }: Params) {
  return withContext(
    async (context) => {
      const parsed = actionSchema.safeParse(await readJson(request));
      if (!parsed.success) return apiError("VALIDATION_ERROR", "Choose what to do with this device.");
      return apiOk({ data: await adminActOnDevice(context, (await params).deviceId, parsed.data) });
    },
    { group: "any" },
  );
}
