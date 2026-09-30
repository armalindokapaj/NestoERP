/**
 * The active platform services (MOB-08 §18). Web adapters by default; the
 * native shell swaps them in once at startup (`components/platform/native-bootstrap.tsx`).
 */
import { setCaptureService } from "@/lib/field/capture-service";
import type { PlatformServices } from "./types";
import { createWebServices } from "./web";

let active: PlatformServices | null = null;

export function getPlatformServices(): PlatformServices {
  active ??= createWebServices();
  return active;
}

export function installPlatformServices(services: PlatformServices): void {
  active = services;
  setCaptureService(services.capture);
}
