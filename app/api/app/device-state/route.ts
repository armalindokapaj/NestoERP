import { NextResponse } from "next/server";
import { z } from "zod";

import { confirmDataRemoval, probeDeviceState } from "@/lib/auth/device.service";
import { clientAddress, hitThrottle } from "@/lib/core/security/throttle";

const headers = { "Cache-Control": "no-store" };

const probeSchema = z.object({
  installId: z.string().min(16).max(64),
  userIds: z.array(z.string().min(1).max(64)).min(1).max(10),
  /** Present when the app reports it finished removing NESTO's data for that user. */
  confirmRemovalFor: z.string().min(1).max(64).optional(),
});

/**
 * POST /api/app/device-state — a signed-out app asks whether its device was
 * revoked and whether it is to remove NESTO's local data (MOB-11 §20, §126).
 *
 * Public because there is no session to present once access is revoked. What
 * makes that safe: it answers only for an (install id, user id) pair the caller
 * already holds — an unguessable random id and a user id that appears nowhere
 * else in the app's storage — returns a status and a removal instruction and
 * nothing else, never a token or a record, and is rate limited per address. A
 * wrong guess and an unknown device look the same: an empty list.
 */
export async function POST(request: Request) {
  const allowance = await hitThrottle("DEVICE_STATE", { ip: clientAddress(request.headers) });
  if (!allowance.allowed) return NextResponse.json({ error: { code: "RATE_LIMITED", message: "Try again shortly." } }, { status: 429, headers: { ...headers, "Retry-After": String(allowance.retryAfterSeconds) } });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: { code: "VALIDATION_ERROR", message: "Invalid request." } }, { status: 422, headers });
  }
  const parsed = probeSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: { code: "VALIDATION_ERROR", message: "Invalid request." } }, { status: 422, headers });

  if (parsed.data.confirmRemovalFor && parsed.data.userIds.includes(parsed.data.confirmRemovalFor)) {
    await confirmDataRemoval(parsed.data.installId, parsed.data.confirmRemovalFor);
  }
  return NextResponse.json({ data: { devices: await probeDeviceState(parsed.data.installId, parsed.data.userIds) }, serverTime: new Date().toISOString() }, { headers });
}
