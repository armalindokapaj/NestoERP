import { createSign } from "node:crypto";

import type { PushMessage, PushOutcome, PushProvider } from "./push.provider";

/**
 * Firebase Cloud Messaging, HTTP v1 (MOB-10 §32). The service-account JSON is a
 * server secret in the environment (`FCM_SERVICE_ACCOUNT`); the access token it
 * mints is cached until shortly before it expires.
 */
export type FcmConfig = { projectId: string; clientEmail: string; privateKey: string };

type Fetch = typeof fetch;

function base64url(input: Buffer | string): string {
  return Buffer.from(input).toString("base64url");
}

export function fcmAssertion(config: FcmConfig, now = Date.now()): string {
  const header = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const iat = Math.floor(now / 1000);
  const claims = base64url(
    JSON.stringify({ iss: config.clientEmail, scope: "https://www.googleapis.com/auth/firebase.messaging", aud: "https://oauth2.googleapis.com/token", iat, exp: iat + 3600 }),
  );
  const signature = createSign("RSA-SHA256").update(`${header}.${claims}`).sign(config.privateKey);
  return `${header}.${claims}.${base64url(signature)}`;
}

/** The FCM message. Data values must be strings; only ids and the path travel. */
export function fcmBody(token: string, message: PushMessage): string {
  return JSON.stringify({
    message: {
      token,
      notification: message.body ? { title: message.title, body: message.body } : { title: message.title },
      data: { path: message.path, notificationId: message.notificationId, eventType: message.eventType, badge: String(message.badge) },
      android: {
        priority: message.urgent ? "HIGH" : "NORMAL",
        collapse_key: message.threadKey ?? undefined,
        notification: { channel_id: message.channel, tag: message.threadKey ?? undefined, notification_count: message.badge },
      },
    },
  });
}

export function classifyFcm(status: number, body: string): PushOutcome {
  if (status === 200) {
    let name: string | null = null;
    try {
      name = (JSON.parse(body) as { name?: string }).name ?? null;
    } catch {
      /* accepted without a parsable id */
    }
    return { kind: "accepted", providerMessageId: name };
  }
  let code = "UNKNOWN";
  try {
    const error = (JSON.parse(body) as { error?: { status?: string; details?: Array<{ errorCode?: string }> } }).error;
    code = error?.details?.find((detail) => detail.errorCode)?.errorCode ?? error?.status ?? code;
  } catch {
    /* keep UNKNOWN */
  }
  if (code === "UNREGISTERED" || status === 404) return { kind: "invalid-token", code: `FCM_${code}` };
  if (code === "INVALID_ARGUMENT" && status === 400) return { kind: "invalid-token", code: `FCM_${code}` };
  if (status === 429 || status >= 500 || code === "UNAVAILABLE" || code === "INTERNAL" || code === "QUOTA_EXCEEDED") return { kind: "transient", code: `FCM_${code}` };
  return { kind: "permanent", code: `FCM_${code}` };
}

export function createFcmProvider(config: FcmConfig, fetcher: Fetch = fetch, clock: () => number = Date.now): PushProvider {
  let access: { token: string; expiresAt: number } | null = null;

  async function accessToken(): Promise<string> {
    const now = clock();
    if (access && access.expiresAt - 60_000 > now) return access.token;
    const response = await fetcher("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: fcmAssertion(config, now) }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) throw new Error(`FCM_AUTH_${response.status}`);
    const json = (await response.json()) as { access_token: string; expires_in: number };
    access = { token: json.access_token, expiresAt: now + json.expires_in * 1000 };
    return access.token;
  }

  return {
    name: "fcm",
    async send(deviceToken, message) {
      try {
        const response = await fetcher(`https://fcm.googleapis.com/v1/projects/${config.projectId}/messages:send`, {
          method: "POST",
          headers: { authorization: `Bearer ${await accessToken()}`, "content-type": "application/json" },
          body: fcmBody(deviceToken, message),
          signal: AbortSignal.timeout(10_000),
        });
        return classifyFcm(response.status, await response.text());
      } catch {
        return { kind: "transient", code: "FCM_NETWORK" };
      }
    },
  };
}

export function fcmProviderFromEnv(env: NodeJS.ProcessEnv): PushProvider | null {
  if (!env.FCM_SERVICE_ACCOUNT) return null;
  try {
    const account = JSON.parse(env.FCM_SERVICE_ACCOUNT) as { project_id?: string; client_email?: string; private_key?: string };
    if (!account.project_id || !account.client_email || !account.private_key) return null;
    return createFcmProvider({ projectId: account.project_id, clientEmail: account.client_email, privateKey: account.private_key });
  } catch {
    return null;
  }
}
