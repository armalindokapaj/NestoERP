import { z } from "zod";

import { apiError, apiOk, readJson, withContext } from "@/lib/api/respond";
import { renameOwnDevice } from "@/lib/auth/device.service";
import { actOnOwnDevice, restoreOwnDevice } from "@/lib/modules/security/security.service";

type Params = { params: Promise<{ deviceId: string }> };

const renameSchema = z.object({ name: z.string().trim().min(1).max(80) });
const actionSchema = z.object({ action: z.enum(["SIGN_OUT", "REVOKE", "LOST", "RESTORE"]) });

/** Renames one of the caller's own devices. Anybody else's id is NOT_FOUND. */
export async function PATCH(request: Request, { params }: Params) {
  return withContext(
    async (context) => {
      const parsed = renameSchema.safeParse(await readJson(request));
      if (!parsed.success) return apiError("VALIDATION_ERROR", "Enter a name for this device.");
      await renameOwnDevice(context, (await params).deviceId, parsed.data.name);
      return apiOk({ data: { renamed: true } });
    },
    { group: "any" },
  );
}

/**
 * Ends access for one of the caller's own devices (MOB-11 §16-§21): sign it out,
 * revoke it, report it lost, or restore one they revoked. Needs a recent sign-in.
 */
export async function POST(request: Request, { params }: Params) {
  return withContext(
    async (context) => {
      const parsed = actionSchema.safeParse(await readJson(request));
      if (!parsed.success) return apiError("VALIDATION_ERROR", "Choose what to do with this device.");
      const { deviceId } = await params;
      if (parsed.data.action === "RESTORE") {
        await restoreOwnDevice(context, deviceId);
        return apiOk({ data: { restored: true } });
      }
      return apiOk({ data: await actOnOwnDevice(context, deviceId, parsed.data.action) });
    },
    { group: "any" },
  );
}
