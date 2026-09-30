import { devModeFor } from "@/lib/auth/dev-mode";
import { logger } from "@/lib/core/observability/logger";
import type { AndroidChannel } from "./push.policy";

/**
 * The seam between NESTO and a push network (MOB-10 §33). Business code never
 * sees it; only the push sender does. One implementation per platform family:
 * APNs for iOS, FCM for Android.
 */
export type PushMessage = {
  notificationId: string;
  eventType: string;
  /** The in-app path a tap opens: always the re-authorising notification route. */
  path: string;
  title: string;
  body: string | null;
  /** The person's canonical unread count, so the icon badge never drifts (MOB-10 §27, §28). */
  badge: number;
  /** One task, one approval: related notifications collapse on the lock screen (§96). */
  threadKey: string | null;
  urgent: boolean;
  channel: AndroidChannel;
};

export type PushOutcome =
  | { kind: "accepted"; providerMessageId: string | null }
  /** The token is dead for good: switch the device off. */
  | { kind: "invalid-token"; code: string }
  /** Worth trying again after a delay. */
  | { kind: "transient"; code: string }
  /** Will never work for this message: give up without retrying. */
  | { kind: "permanent"; code: string };

export interface PushProvider {
  readonly name: string;
  send(token: string, message: PushMessage): Promise<PushOutcome>;
}

/** Development provider: records that a push would have gone out, with no content and no network. */
export const logPushProvider: PushProvider = {
  name: "log",
  async send(_token, message) {
    logger.info("push.log_provider", { notificationId: message.notificationId, eventType: message.eventType, urgent: message.urgent });
    return { kind: "accepted", providerMessageId: null };
  },
};

/**
 * `live` in a process where demo conveniences exist (the account picker, the user switcher) is
 * downgraded to `log`: an impersonated demo user must never reach a real phone (MOB-10 §39). A
 * deployment that really wants live push with demo accounts says so with `PUSH_ALLOW_DEMO=true`.
 */
export function effectivePushMode(env: Record<string, string | undefined> = process.env): "off" | "log" | "live" {
  const mode = env.PUSH_PROVIDER === "log" || env.PUSH_PROVIDER === "live" ? env.PUSH_PROVIDER : "off";
  if (mode === "live" && devModeFor(env) && env.PUSH_ALLOW_DEMO !== "true") return "log";
  return mode;
}

let override: { ios?: PushProvider | null; android?: PushProvider | null } | null = null;

/** Tests substitute providers; pass null to restore the environment's. */
export function setPushProvidersForTests(providers: typeof override): void {
  override = providers;
}

/**
 * The provider for a platform, or null when push is not configured here. With
 * none, no delivery rows are written at all: an unconfigured environment does
 * not fill a queue nobody drains. `PUSH_PROVIDER` is `off` (default), `log`
 * (development) or `live` (APNs/FCM credentials from the environment).
 */
export async function pushProviderFor(platform: "IOS" | "ANDROID", env: NodeJS.ProcessEnv = process.env): Promise<PushProvider | null> {
  if (override) return (platform === "IOS" ? override.ios : override.android) ?? null;
  const mode = effectivePushMode(env);
  if (mode === "log") return logPushProvider;
  if (mode !== "live") return null;
  if (platform === "IOS") {
    const { apnsProviderFromEnv } = await import("./push.apns");
    return apnsProviderFromEnv(env);
  }
  const { fcmProviderFromEnv } = await import("./push.fcm");
  return fcmProviderFromEnv(env);
}

export async function pushEnabledFor(env: NodeJS.ProcessEnv = process.env): Promise<boolean> {
  if (override) return Boolean(override.ios || override.android);
  return effectivePushMode(env) !== "off";
}
