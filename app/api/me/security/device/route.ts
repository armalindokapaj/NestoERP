import { apiError, apiOk, readJson, withContext } from "@/lib/api/respond";
import { deviceReportSchema, syncDevice } from "@/lib/auth/device.service";

/**
 * POST /api/me/security/device — the app's registration and refresh call
 * (MOB-11 §11, §127). The user is the session's; the body cannot name anyone
 * else. It answers a revoked or out-of-date device too (`device: "ignore"`),
 * because that is exactly how the app learns it is revoked, what it must
 * remove, and which policy applies.
 */
export async function POST(request: Request) {
  return withContext(
    async (context) => {
      const parsed = deviceReportSchema.safeParse(await readJson(request));
      if (!parsed.success) return apiError("VALIDATION_ERROR", "Invalid device report.");
      return apiOk({ data: await syncDevice(context, parsed.data) });
    },
    { group: "any", device: "ignore" },
  );
}
