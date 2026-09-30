import { apiError, apiOk, readJson, withContext } from "@/lib/api/respond";
import { listOwnDevices, registerDevice, registerDeviceSchema, unregisterDevice, unregisterDeviceSchema } from "@/lib/auth/device.service";

/** The signed-in person's own devices (MOB-11 §15). */
export async function GET() {
  return withContext(async (context) => apiOk({ data: await listOwnDevices(context) }), { group: "any" });
}

/** Registers the calling app install for push (MOB-08 §34). The person's own device, in any workspace. */
export async function POST(request: Request) {
  return withContext(async (context) => {
    const parsed = registerDeviceSchema.safeParse(await readJson(request));
    if (!parsed.success) return apiError("VALIDATION_ERROR", "Invalid device registration.");
    return apiOk({ data: await registerDevice(context, parsed.data) });
  }, { group: "any" });
}

/** Removes this device's registration — called on sign-out. */
export async function DELETE(request: Request) {
  return withContext(async (context) => {
    const parsed = unregisterDeviceSchema.safeParse(await readJson(request));
    if (!parsed.success) return apiError("VALIDATION_ERROR", "Invalid device registration.");
    await unregisterDevice(context, parsed.data.pushToken);
    return apiOk({ data: { removed: true } });
  }, { group: "any" });
}
