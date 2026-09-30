import { createPrivateKey, sign } from "node:crypto";
import { connect, type ClientHttp2Session } from "node:http2";

import type { PushMessage, PushOutcome, PushProvider } from "./push.provider";

/**
 * Apple Push Notification service over HTTP/2 with a token-based key (MOB-10
 * §31). The .p8 key, key id and team id are server secrets in the environment;
 * nothing here is committed. The JWT is cached for 40 minutes (Apple wants
 * 20-60).
 */
export type ApnsConfig = { keyId: string; teamId: string; privateKey: string; bundleId: string; production: boolean };

type ApnsRequest = (host: string, path: string, headers: Record<string, string>, body: string) => Promise<{ status: number; body: string }>;

function base64url(input: Buffer | string): string {
  return Buffer.from(input).toString("base64url");
}

export function apnsJwt(config: Pick<ApnsConfig, "keyId" | "teamId" | "privateKey">, now = Date.now()): string {
  const header = base64url(JSON.stringify({ alg: "ES256", kid: config.keyId }));
  const claims = base64url(JSON.stringify({ iss: config.teamId, iat: Math.floor(now / 1000) }));
  const signature = sign("sha256", Buffer.from(`${header}.${claims}`), { key: createPrivateKey(config.privateKey), dsaEncoding: "ieee-p1363" });
  return `${header}.${claims}.${base64url(signature)}`;
}

/** The APNs JSON body. `path` and the notification id are the only data; nothing confidential. */
export function apnsPayload(message: PushMessage): string {
  return JSON.stringify({
    aps: {
      alert: message.body ? { title: message.title, body: message.body } : { title: message.title },
      badge: message.badge,
      sound: message.urgent ? "default" : undefined,
      "thread-id": message.threadKey ?? undefined,
      "interruption-level": message.urgent ? "time-sensitive" : "active",
    },
    path: message.path,
    notificationId: message.notificationId,
    eventType: message.eventType,
  });
}

const INVALID_TOKEN_REASONS = new Set(["BadDeviceToken", "Unregistered", "DeviceTokenNotForTopic"]);

export function classifyApns(status: number, body: string): PushOutcome {
  if (status === 200) return { kind: "accepted", providerMessageId: null };
  let reason = "UNKNOWN";
  try {
    reason = (JSON.parse(body) as { reason?: string }).reason ?? reason;
  } catch {
    /* an empty or non-JSON body keeps UNKNOWN */
  }
  if (status === 410 || INVALID_TOKEN_REASONS.has(reason)) return { kind: "invalid-token", code: `APNS_${reason}` };
  if (status === 429 || status >= 500 || reason === "ExpiredProviderToken") return { kind: "transient", code: `APNS_${reason}` };
  return { kind: "permanent", code: `APNS_${reason}` };
}

function http2Request(): ApnsRequest {
  const sessions = new Map<string, ClientHttp2Session>();
  return (host, path, headers, body) =>
    new Promise((resolve, reject) => {
      let session = sessions.get(host);
      if (!session || session.closed || session.destroyed) {
        session = connect(`https://${host}`);
        session.on("error", () => sessions.delete(host));
        session.unref();
        sessions.set(host, session);
      }
      const request = session.request({ ":method": "POST", ":path": path, ...headers });
      const chunks: Buffer[] = [];
      let status = 0;
      request.setTimeout(10_000, () => request.close());
      request.on("response", (response) => {
        status = Number(response[":status"] ?? 0);
      });
      request.on("data", (chunk: Buffer) => chunks.push(chunk));
      request.on("end", () => resolve({ status, body: Buffer.concat(chunks).toString("utf8") }));
      request.on("error", reject);
      request.end(body);
    });
}

export function createApnsProvider(config: ApnsConfig, request: ApnsRequest = http2Request(), clock: () => number = Date.now): PushProvider {
  let cached: { jwt: string; at: number } | null = null;
  const token = () => {
    const now = clock();
    if (!cached || now - cached.at > 40 * 60_000) cached = { jwt: apnsJwt(config, now), at: now };
    return cached.jwt;
  };
  const host = config.production ? "api.push.apple.com" : "api.sandbox.push.apple.com";
  return {
    name: "apns",
    async send(deviceToken, message) {
      try {
        const headers: Record<string, string> = {
          authorization: `bearer ${token()}`,
          "apns-topic": config.bundleId,
          "apns-push-type": "alert",
          "apns-priority": message.urgent ? "10" : "5",
          "content-type": "application/json",
        };
        if (message.threadKey) headers["apns-collapse-id"] = message.threadKey.slice(0, 64);
        const response = await request(host, `/3/device/${deviceToken}`, headers, apnsPayload(message));
        return classifyApns(response.status, response.body);
      } catch {
        return { kind: "transient", code: "APNS_NETWORK" };
      }
    },
  };
}

export function apnsProviderFromEnv(env: NodeJS.ProcessEnv): PushProvider | null {
  const { APNS_KEY_ID: keyId, APNS_TEAM_ID: teamId, APNS_PRIVATE_KEY: key, APNS_BUNDLE_ID: bundleId } = env;
  if (!keyId || !teamId || !key || !bundleId) return null;
  return createApnsProvider({ keyId, teamId, bundleId, privateKey: key.replace(/\\n/g, "\n"), production: env.APNS_ENVIRONMENT !== "sandbox" });
}
