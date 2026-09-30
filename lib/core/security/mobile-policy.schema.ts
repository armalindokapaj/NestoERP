import { z } from "zod";

import { compareVersions } from "./app-version";

/**
 * The mobile security policy contract (MOB-11 §73-§82, §179, §180).
 *
 * Each level — Platform, Parent Group, Company — stores only the values it
 * sets; absent means "inherit". `resolveMobilePolicy` merges the levels with
 * one rule: **the strictest value wins**, so a lower level can tighten but can
 * never weaken what a higher level requires (§74). Nothing in the application
 * reads a level's settings directly — it reads `EffectiveMobilePolicy`.
 *
 * Pure: no database, so the resolver is tested exhaustively without one and
 * the same file can be used by an edge or client bundle if ever needed.
 */

/** Modules whose screens count as sensitive surfaces (MOB-11 §88). HR — people, salary — is the default; Legal and Finance are the organization's choice. */
export const PROTECTABLE_MODULES = ["hr", "contracts", "finance"] as const;
export type ProtectableModule = (typeof PROTECTABLE_MODULES)[number];

export const DEVICE_RISK_POLICIES = ["ALLOW", "WARN", "BLOCK"] as const;
export type DeviceRiskPolicy = (typeof DEVICE_RISK_POLICIES)[number];

export const NOTIFICATION_PREVIEW_POLICIES = ["FULL", "LIMITED", "HIDDEN"] as const;
export type NotificationPreviewPolicy = (typeof NOTIFICATION_PREVIEW_POLICIES)[number];

/** Lock delays the UI offers; `0` is "immediately". The schema accepts any value in range. */
export const APP_LOCK_TIMEOUT_OPTIONS = [0, 60, 300, 900] as const;

const VERSION = /^\d+\.\d+\.\d+$/;
const OS_VERSION = /^\d+(\.\d+){0,2}$/;
/** "1.4.2" blocks every build of that version; "1.4.2+142" blocks one build. */
const BLOCKED_BUILD = /^\d+\.\d+\.\d+(\+\d{1,9})?$/;

const version = z.string().regex(VERSION, "Use a version such as 1.4.0");

export const mobilePolicySettingsSchema = z
  .object({
    /** The app asks for biometrics or the device credential when it returns from the background. */
    appLockRequired: z.boolean(),
    /** Require a biometric where the device has one; the device passcode alone is not enough. */
    biometricRequired: z.boolean(),
    /** Seconds in the background before the lock returns. 0 = immediately. */
    appLockTimeoutSeconds: z.number().int().min(0).max(3600),
    offlineAllowed: z.boolean(),
    /** How long the server's last confirmation keeps offline content open. */
    offlineAuthorizationHours: z.number().int().min(1).max(336),
    documentExportAllowed: z.boolean(),
    nativeShareAllowed: z.boolean(),
    externalOpenAllowed: z.boolean(),
    /** Below this the app can no longer read or change company data. */
    minimumAppVersion: version,
    /** Below this the app is told a security update is required (a stricter floor than "supported"). */
    minimumSecureVersion: version,
    recommendedAppVersion: version,
    blockedBuilds: z.array(z.string().regex(BLOCKED_BUILD)).max(200),
    minimumOsVersion: z.object({ ios: z.string().regex(OS_VERSION).optional(), android: z.string().regex(OS_VERSION).optional() }),
    deviceRiskPolicy: z.enum(DEVICE_RISK_POLICIES),
    notificationPreviewPolicy: z.enum(NOTIFICATION_PREVIEW_POLICIES),
    /** Sensitive surfaces (HR, salary, sensitive Legal/Finance) ask for a recent sign-in and refuse screen capture where the OS can. */
    sensitiveScreenProtection: z.boolean(),
    /** Which modules' screens are sensitive surfaces when the protection is on. */
    protectedModules: z.array(z.enum(PROTECTABLE_MODULES)).max(PROTECTABLE_MODULES.length),
    /** Minutes a sign-in counts as "recent" for a sensitive action. */
    recentAuthMinutes: z.number().int().min(1).max(240),
    /** Group level only: may Companies in the group set their own stricter values? */
    allowCompanyOverride: z.boolean(),
  })
  .partial()
  .strict();

export type MobilePolicySettings = z.infer<typeof mobilePolicySettingsSchema>;

/** The fully-resolved values a device is held to. */
export type EffectiveMobilePolicy = {
  policyVersion: string;
  appLockRequired: boolean;
  biometricRequired: boolean;
  appLockTimeoutSeconds: number;
  offlineAllowed: boolean;
  offlineAuthorizationHours: number;
  documentExportAllowed: boolean;
  nativeShareAllowed: boolean;
  externalOpenAllowed: boolean;
  minimumAppVersion: string;
  minimumSecureVersion: string;
  recommendedAppVersion: string;
  blockedBuilds: string[];
  minimumOsVersion: { ios: string | null; android: string | null };
  deviceRiskPolicy: DeviceRiskPolicy;
  notificationPreviewPolicy: NotificationPreviewPolicy;
  sensitiveScreenProtection: boolean;
  protectedModules: ProtectableModule[];
  recentAuthMinutes: number;
};

export type PolicyLevel = {
  scope: "PLATFORM" | "PARENT_GROUP" | "COMPANY";
  id: string | null;
  /** The group a Company level belongs to, so a Group can close its Companies' overrides. */
  parentGroupId?: string | null;
  version: number;
  settings: MobilePolicySettings;
};

/**
 * What applies when nobody has said anything. A product/security decision the
 * owner confirms (docs/security/mobile-policy.md): app lock is offered, not
 * forced; a modified device gets a warning, not a block; export and share stay
 * available because construction work needs them; 72 h offline matches MOB-09.
 */
export const DEFAULT_MOBILE_POLICY: Omit<EffectiveMobilePolicy, "policyVersion"> = {
  appLockRequired: false,
  biometricRequired: false,
  appLockTimeoutSeconds: 60,
  offlineAllowed: true,
  offlineAuthorizationHours: 72,
  documentExportAllowed: true,
  nativeShareAllowed: true,
  externalOpenAllowed: true,
  minimumAppVersion: "1.0.0",
  minimumSecureVersion: "1.0.0",
  recommendedAppVersion: "1.0.0",
  blockedBuilds: [],
  minimumOsVersion: { ios: null, android: null },
  deviceRiskPolicy: "WARN",
  notificationPreviewPolicy: "LIMITED",
  sensitiveScreenProtection: true,
  protectedModules: ["hr"],
  recentAuthMinutes: 15,
};

const RISK_ORDER: Record<DeviceRiskPolicy, number> = { ALLOW: 0, WARN: 1, BLOCK: 2 };
const PREVIEW_ORDER: Record<NotificationPreviewPolicy, number> = { FULL: 0, LIMITED: 1, HIDDEN: 2 };

const maxVersion = (a: string, b: string) => (compareVersions(a, b) >= 0 ? a : b);

function strictest<T extends string>(values: readonly T[], order: Record<T, number>, fallback: T): T {
  return values.length ? values.reduce((a, b) => (order[b] > order[a] ? b : a)) : fallback;
}

/** Stable short hash (FNV-1a) so a policy version is comparable without storing another column. */
function hash(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(36);
}

/**
 * The deterministic merge (MOB-11 §75). Order of `levels` does not matter:
 * every field is a min, max, OR or AND over the levels that set it, so the same
 * set always resolves to the same answer and no level can win by coming last.
 *
 * `allowCompanyOverride: false` on a Group level drops that Group's Company
 * levels entirely — the Group has chosen to manage policy centrally.
 */
export function resolveMobilePolicy(levels: readonly PolicyLevel[]): EffectiveMobilePolicy {
  const closedGroups = new Set(levels.filter((l) => l.scope === "PARENT_GROUP" && l.settings.allowCompanyOverride === false).map((l) => l.id));
  const usable = levels.filter((l) => !(l.scope === "COMPANY" && l.parentGroupId && closedGroups.has(l.parentGroupId)));
  const base = DEFAULT_MOBILE_POLICY;
  const pick = <K extends keyof MobilePolicySettings>(key: K): NonNullable<MobilePolicySettings[K]>[] =>
    usable.map((l) => l.settings[key]).filter((v): v is NonNullable<MobilePolicySettings[K]> => v !== undefined && v !== null);

  const bools = (key: "appLockRequired" | "biometricRequired" | "sensitiveScreenProtection", fallback: boolean) => {
    const values = pick(key);
    return values.length ? values.some(Boolean) : fallback;
  };
  const allow = (key: "offlineAllowed" | "documentExportAllowed" | "nativeShareAllowed" | "externalOpenAllowed", fallback: boolean) => {
    const values = pick(key);
    return values.length ? values.every(Boolean) : fallback;
  };
  // The default applies only when no level says anything: it is "nobody asked", not a floor or a ceiling a level must respect.
  const minNum = (key: "appLockTimeoutSeconds" | "offlineAuthorizationHours" | "recentAuthMinutes", fallback: number) => {
    const values = pick(key);
    return values.length ? Math.min(...values) : fallback;
  };
  const maxVer = (key: "minimumAppVersion" | "minimumSecureVersion" | "recommendedAppVersion", fallback: string) => pick(key).reduce(maxVersion, fallback);
  const osFloor = (platform: "ios" | "android") => {
    const values = usable.map((l) => l.settings.minimumOsVersion?.[platform]).filter((v): v is string => Boolean(v));
    return values.length ? values.reduce((a, b) => (compareVersions(pad(a), pad(b)) >= 0 ? a : b)) : null;
  };

  const minimumAppVersion = maxVer("minimumAppVersion", base.minimumAppVersion);
  const minimumSecureVersion = maxVersion(maxVer("minimumSecureVersion", base.minimumSecureVersion), minimumAppVersion);
  const recommendedAppVersion = maxVersion(maxVer("recommendedAppVersion", base.recommendedAppVersion), minimumSecureVersion);

  const effective = {
    appLockRequired: bools("appLockRequired", base.appLockRequired),
    biometricRequired: bools("biometricRequired", base.biometricRequired),
    appLockTimeoutSeconds: minNum("appLockTimeoutSeconds", base.appLockTimeoutSeconds),
    offlineAllowed: allow("offlineAllowed", base.offlineAllowed),
    offlineAuthorizationHours: minNum("offlineAuthorizationHours", base.offlineAuthorizationHours),
    documentExportAllowed: allow("documentExportAllowed", base.documentExportAllowed),
    nativeShareAllowed: allow("nativeShareAllowed", base.nativeShareAllowed),
    externalOpenAllowed: allow("externalOpenAllowed", base.externalOpenAllowed),
    minimumAppVersion,
    minimumSecureVersion,
    recommendedAppVersion,
    blockedBuilds: [...new Set(pick("blockedBuilds").flat())].sort(),
    minimumOsVersion: { ios: osFloor("ios"), android: osFloor("android") },
    deviceRiskPolicy: strictest(pick("deviceRiskPolicy"), RISK_ORDER, base.deviceRiskPolicy),
    notificationPreviewPolicy: strictest(pick("notificationPreviewPolicy"), PREVIEW_ORDER, base.notificationPreviewPolicy),
    sensitiveScreenProtection: bools("sensitiveScreenProtection", base.sensitiveScreenProtection),
    protectedModules: (pick("protectedModules").length ? [...new Set(pick("protectedModules").flat())] : [...base.protectedModules]).sort() as ProtectableModule[],
    recentAuthMinutes: minNum("recentAuthMinutes", base.recentAuthMinutes),
  } satisfies Omit<EffectiveMobilePolicy, "policyVersion">;

  const stamp = usable.map((l) => `${l.scope}:${l.id ?? ""}:${l.version}`).sort().join("|");
  return { ...effective, policyVersion: hash(`${stamp}#${JSON.stringify(effective)}`) };
}

function pad(value: string): string {
  const parts = value.split(".");
  while (parts.length < 3) parts.push("0");
  return parts.join(".");
}

/** An offline-access window expressed the way the sync snapshot expects it. */
export function offlineWindowMs(policy: Pick<EffectiveMobilePolicy, "offlineAuthorizationHours">): number {
  return policy.offlineAuthorizationHours * 3_600_000;
}
