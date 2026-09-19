import type { PlatformPermission } from "@/config/platform";
import { AccessError } from "@/lib/access/guards";
import { canPlatform, type PlatformContext } from "@/lib/context/platform-context";

export function assertProject3DPlatformPermission(context: PlatformContext, permission: PlatformPermission): void {
  if (!canPlatform(context, permission)) throw new AccessError("FORBIDDEN");
}

