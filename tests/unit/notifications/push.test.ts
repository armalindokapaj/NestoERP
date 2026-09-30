import { generateKeyPairSync, verify } from "node:crypto";
import { describe, expect, it } from "vitest";

import { notificationEventDefinitions } from "@/lib/core/notifications/notification.events";
import { apnsJwt, apnsPayload, classifyApns, createApnsProvider } from "@/lib/core/notifications/push.apns";
import { classifyFcm, createFcmProvider, fcmBody } from "@/lib/core/notifications/push.fcm";
import { androidChannel, decidePush, isDirectEvent } from "@/lib/core/notifications/push.policy";
import { pushPrivacyClass, renderPushText } from "@/lib/core/notifications/push.privacy";
import { effectivePushMode, type PushMessage } from "@/lib/core/notifications/push.provider";
import { insideQuietHours, quietHoursEnd, type QuietHours } from "@/lib/core/notifications/push.quiet-hours";
import { pushRetryDelaySeconds } from "@/lib/core/notifications/push.service";

const message: PushMessage = {
  notificationId: "n1",
  eventType: "TASK_ASSIGNED",
  path: "/notifications/n1/open",
  title: "You were assigned “Facade Inspection”",
  body: null,
  badge: 3,
  threadKey: "task:t1",
  urgent: false,
  channel: "tasks_mentions",
};

describe("push privacy (MOB-10 §41-§43)", () => {
  it("gives every registered event a class", () => {
    for (const definition of notificationEventDefinitions()) {
      expect(["PUBLIC_PREVIEW", "LIMITED_PREVIEW", "SENSITIVE"]).toContain(pushPrivacyClass(definition.eventType, definition.category));
    }
  });

  it("keeps HR, finance and legal off the lock screen", () => {
    for (const [eventType, category] of [
      ["EMPLOYMENT_CHANGE_EFFECTIVE", "hr"],
      ["UNIT_PAYMENT_RECEIVED", "sales"],
      ["CONTRACT_OBLIGATION_DUE", "contracts"],
      ["UNIT_INSTALLMENT_OVERDUE", "finance"],
    ] as const) {
      const text = renderPushText({ eventType, category, title: "Contract 14 for A-201 was paid €1,250,000", body: "salary details" });
      expect(text.title).toBe("You have a new notification");
      expect(JSON.stringify(text)).not.toMatch(/1,250,000|A-201|salary/);
    }
  });

  it("drops the record name for limited events and the comment words for mentions", () => {
    const approval = renderPushText({ eventType: "APPROVAL_REQUESTED", category: "approvals", title: "PO-204 needs your approval", body: "€500,000" });
    expect(approval.title).toBe("An approval needs your attention");
    expect(JSON.stringify(approval)).not.toMatch(/PO-204|500/);
    const mention = renderPushText({ eventType: "COMMENT_MENTIONED", category: "mentions", title: "Besar mentioned you on Facade Revision", body: "Please review the latest" });
    expect(mention).toEqual({ title: "Besar mentioned you on Facade Revision", body: null });
  });

  it("shows the task title for an ordinary task", () => {
    expect(renderPushText({ eventType: "TASK_ASSIGNED", category: "tasks", title: message.title, body: null }).title).toBe(message.title);
  });
});

describe("push policy (MOB-10 §88-§94)", () => {
  const base = { eventType: "TASK_STATUS_CHANGED", priority: "NORMAL" as const, mandatory: false, categoryPushEnabled: true, projectLevel: "ALL" as const };

  it("pushes an ordinary event and respects the category switch", () => {
    expect(decidePush(base)).toEqual({ push: true, urgent: false });
    expect(decidePush({ ...base, categoryPushEnabled: false })).toEqual({ push: false, reason: "CATEGORY_OFF" });
  });

  it("never pushes low priority", () => {
    expect(decidePush({ ...base, priority: "LOW" })).toEqual({ push: false, reason: "LOW_PRIORITY" });
  });

  it("mutes routine project events but not direct ones", () => {
    expect(decidePush({ ...base, projectLevel: "MUTED" })).toEqual({ push: false, reason: "PROJECT_MUTED" });
    expect(decidePush({ ...base, eventType: "TASK_ASSIGNED", projectLevel: "MUTED" })).toEqual({ push: true, urgent: false });
    expect(decidePush({ ...base, eventType: "COMMENT_MENTIONED", projectLevel: "MUTED" })).toEqual({ push: true, urgent: false });
    expect(isDirectEvent("TASK_STATUS_CHANGED")).toBe(false);
  });

  it("important-only lets HIGH through", () => {
    expect(decidePush({ ...base, projectLevel: "IMPORTANT" })).toEqual({ push: false, reason: "PROJECT_IMPORTANT_ONLY" });
    expect(decidePush({ ...base, projectLevel: "IMPORTANT", priority: "HIGH" })).toEqual({ push: true, urgent: false });
  });

  it("a critical alert ignores category, mute and low-priority rules", () => {
    expect(decidePush({ ...base, eventType: "HSE_CRITICAL_RISK", priority: "CRITICAL", categoryPushEnabled: false, projectLevel: "MUTED" })).toEqual({ push: true, urgent: true });
  });

  it("maps few Android channels", () => {
    expect(androidChannel({ category: "hse", priority: "CRITICAL" })).toBe("critical_hse");
    expect(androidChannel({ category: "hse", priority: "HIGH" })).toBe("general");
    expect(androidChannel({ category: "approvals", priority: "HIGH" })).toBe("approvals");
    expect(androidChannel({ category: "mentions", priority: "NORMAL" })).toBe("tasks_mentions");
  });
});

describe("quiet hours (MOB-10 §91-§93)", () => {
  const overnight: QuietHours = { enabled: true, startMinute: 22 * 60, endMinute: 7 * 60, timezone: "Europe/Tirane", allowCritical: true };

  it("uses the person's zone, not the server's", () => {
    // 21:30 UTC in winter is 22:30 in Tirane (UTC+1): inside. In UTC it would be outside.
    expect(insideQuietHours(overnight, new Date("2026-01-15T21:30:00Z"))).toBe(true);
    expect(insideQuietHours({ ...overnight, timezone: "UTC" }, new Date("2026-01-15T21:30:00Z"))).toBe(false);
  });

  it("handles a window across midnight and reports when it ends", () => {
    const at = new Date("2026-01-15T22:00:00Z"); // 23:00 local
    expect(insideQuietHours(overnight, at)).toBe(true);
    expect(quietHoursEnd(overnight, at)?.toISOString()).toBe("2026-01-16T06:00:00.000Z"); // 07:00 local
    expect(quietHoursEnd(overnight, new Date("2026-01-15T12:00:00Z"))).toBeNull();
  });

  it("is off when disabled, and an unknown zone does not throw", () => {
    expect(insideQuietHours({ ...overnight, enabled: false }, new Date("2026-01-15T22:00:00Z"))).toBe(false);
    expect(() => insideQuietHours({ ...overnight, timezone: "Not/AZone" }, new Date())).not.toThrow();
  });
});

describe("push retry", () => {
  it("grows and is jittered", () => {
    expect(pushRetryDelaySeconds(1, () => 0.5)).toBe(30);
    expect(pushRetryDelaySeconds(3, () => 0.5)).toBe(480);
    expect(pushRetryDelaySeconds(9, () => 0.5)).toBe(1920);
  });
});

describe("APNs", () => {
  const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
  const pem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();

  it("signs a valid ES256 token", () => {
    const jwt = apnsJwt({ keyId: "KID", teamId: "TEAM", privateKey: pem }, 1_700_000_000_000);
    const [header, claims, signature] = jwt.split(".");
    expect(JSON.parse(Buffer.from(header, "base64url").toString())).toEqual({ alg: "ES256", kid: "KID" });
    expect(JSON.parse(Buffer.from(claims, "base64url").toString())).toEqual({ iss: "TEAM", iat: 1_700_000_000 });
    expect(verify("sha256", Buffer.from(`${header}.${claims}`), { key: publicKey, dsaEncoding: "ieee-p1363" }, Buffer.from(signature, "base64url"))).toBe(true);
  });

  it("carries ids and the path only, never a secret", () => {
    const payload = JSON.parse(apnsPayload(message));
    expect(Object.keys(payload).sort()).toEqual(["aps", "eventType", "notificationId", "path"]);
    expect(payload.aps["thread-id"]).toBe("task:t1");
    expect(payload.aps.badge).toBe(3);
    expect(JSON.stringify(payload)).not.toMatch(/token|cookie|password|secret/i);
  });

  it("classifies provider answers", () => {
    expect(classifyApns(200, "").kind).toBe("accepted");
    expect(classifyApns(410, JSON.stringify({ reason: "Unregistered" })).kind).toBe("invalid-token");
    expect(classifyApns(400, JSON.stringify({ reason: "BadDeviceToken" })).kind).toBe("invalid-token");
    expect(classifyApns(503, "").kind).toBe("transient");
    expect(classifyApns(429, JSON.stringify({ reason: "TooManyRequests" })).kind).toBe("transient");
    expect(classifyApns(400, JSON.stringify({ reason: "PayloadTooLarge" })).kind).toBe("permanent");
  });

  it("sends to the sandbox host with a collapse id and turns a network error into a retry", async () => {
    const calls: Array<{ host: string; path: string; headers: Record<string, string> }> = [];
    const provider = createApnsProvider({ keyId: "K", teamId: "T", bundleId: "al.nesto.app", privateKey: pem, production: false }, async (host, path, headers) => {
      calls.push({ host, path, headers });
      return { status: 200, body: "" };
    });
    expect((await provider.send("abc", message)).kind).toBe("accepted");
    expect(calls[0].host).toBe("api.sandbox.push.apple.com");
    expect(calls[0].path).toBe("/3/device/abc");
    expect(calls[0].headers["apns-collapse-id"]).toBe("task:t1");
    const broken = createApnsProvider({ keyId: "K", teamId: "T", bundleId: "b", privateKey: pem, production: true }, async () => {
      throw new Error("socket");
    });
    expect(await broken.send("abc", message)).toEqual({ kind: "transient", code: "APNS_NETWORK" });
  });
});

describe("FCM", () => {
  it("builds string-only data and a channel", () => {
    const body = JSON.parse(fcmBody("tok", message));
    expect(body.message.data).toEqual({ path: "/notifications/n1/open", notificationId: "n1", eventType: "TASK_ASSIGNED", badge: "3" });
    expect(body.message.android.notification.channel_id).toBe("tasks_mentions");
  });

  it("classifies provider answers", () => {
    expect(classifyFcm(200, JSON.stringify({ name: "projects/p/messages/1" }))).toEqual({ kind: "accepted", providerMessageId: "projects/p/messages/1" });
    expect(classifyFcm(404, JSON.stringify({ error: { status: "NOT_FOUND", details: [{ errorCode: "UNREGISTERED" }] } })).kind).toBe("invalid-token");
    expect(classifyFcm(503, JSON.stringify({ error: { status: "UNAVAILABLE" } })).kind).toBe("transient");
    expect(classifyFcm(403, JSON.stringify({ error: { status: "PERMISSION_DENIED" } })).kind).toBe("permanent");
  });

  it("exchanges a service-account assertion once and reuses the token", async () => {
    const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const urls: string[] = [];
    const fetcher = (async (url: string) => {
      urls.push(url);
      if (url.includes("oauth2")) return new Response(JSON.stringify({ access_token: "at", expires_in: 3600 }), { status: 200 });
      return new Response(JSON.stringify({ name: "m1" }), { status: 200 });
    }) as unknown as typeof fetch;
    const provider = createFcmProvider({ projectId: "p", clientEmail: "svc@p.iam", privateKey: privateKey.export({ type: "pkcs8", format: "pem" }).toString() }, fetcher);
    await provider.send("t1", message);
    await provider.send("t2", message);
    expect(urls.filter((url) => url.includes("oauth2"))).toHaveLength(1);
    expect(urls.filter((url) => url.includes("messages:send"))).toHaveLength(2);
  });
});

describe("demo safety (MOB-10 §39)", () => {
  it("never goes live where demo accounts exist, unless explicitly allowed", () => {
    expect(effectivePushMode({ PUSH_PROVIDER: "live", APP_ENV: "demo" })).toBe("log");
    expect(effectivePushMode({ PUSH_PROVIDER: "live", APP_ENV: "development" })).toBe("log");
    expect(effectivePushMode({ PUSH_PROVIDER: "live", APP_ENV: "demo", PUSH_ALLOW_DEMO: "true" })).toBe("live");
    expect(effectivePushMode({ PUSH_PROVIDER: "live", APP_ENV: "production" })).toBe("live");
    expect(effectivePushMode({ PUSH_PROVIDER: "live", APP_ENV: "staging" })).toBe("live");
    expect(effectivePushMode({ APP_ENV: "production" })).toBe("off");
    expect(effectivePushMode({ PUSH_PROVIDER: "bogus", APP_ENV: "production" })).toBe("off");
  });
});
