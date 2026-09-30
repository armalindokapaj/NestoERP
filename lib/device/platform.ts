/**
 * The one place that knows which runtime NESTO is in (MOB-08 §18, §19, §77).
 *
 * The native shell injects `window.Capacitor` before the page runs, so this
 * reads it instead of importing Capacitor into every web bundle. Business
 * components never branch on the result: they ask a service
 * (`lib/device/registry.ts`) and the service behaves per platform.
 */
export type PlatformName = "web" | "ios" | "android";

type CapacitorGlobal = { getPlatform?: () => string; isNativePlatform?: () => boolean };

export function getPlatform(): PlatformName {
  if (typeof window === "undefined") return "web";
  const capacitor = (window as unknown as { Capacitor?: CapacitorGlobal }).Capacitor;
  if (!capacitor?.isNativePlatform?.()) return "web";
  const name = capacitor.getPlatform?.();
  return name === "ios" || name === "android" ? name : "web";
}

export const isNativePlatform = (): boolean => getPlatform() !== "web";

/**
 * Native capability flags. One registry, so a feature that exists on only one
 * platform is a documented row here and in docs/mobile/native-capability-matrix.md,
 * never an `isIOS` scattered through a module (§77).
 */
export type NativeCapability = "push" | "biometrics" | "secureStorage" | "nativeShare" | "nativeCamera" | "nativeFilePicker" | "backButton";

const NATIVE_ONLY: readonly NativeCapability[] = ["push", "biometrics", "secureStorage", "nativeShare", "nativeCamera", "nativeFilePicker", "backButton"];

export function hasCapability(capability: NativeCapability, platform: PlatformName = getPlatform()): boolean {
  if (platform === "web") return false;
  // The hardware Back button exists on Android only; iOS uses the edge-swipe, which is browser history.
  if (capability === "backButton") return platform === "android";
  return NATIVE_ONLY.includes(capability);
}
