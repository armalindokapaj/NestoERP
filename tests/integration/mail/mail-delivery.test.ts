import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";

import { clearOutbox, readOutbox, recipientAllowed, sendMail, setMailProvider } from "@/lib/mail";
import type { MailProvider, ProviderMessage } from "@/lib/mail/mail.types";
import { counterValue, Metric, resetMetrics } from "@/lib/core/observability/metrics";
import { prisma } from "../../helpers";

/**
 * Mail delivery records (PRD #38 §13, §21, §155, §164).
 *
 * The provider is replaced where a test needs it to fail; otherwise the memory
 * provider captures the message and nothing leaves the machine.
 */

const RECIPIENT = "mail-delivery-test@nesto.test";
const ENV_KEYS = ["APP_ENV", "MAIL_PROVIDER", "MAIL_ALLOWED_RECIPIENTS"] as const;
const saved = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));

function scripted(results: Array<{ status: "SENT" | "FAILED"; errorCode?: string; retryable?: boolean }>) {
  const sent: ProviderMessage[] = [];
  const provider: MailProvider = {
    name: "scripted",
    sink: false,
    async send(message) {
      sent.push(message);
      return results.shift() ?? { status: "SENT", providerMessageId: "scripted-final" };
    },
  };
  return { provider, sent };
}

const message = (key?: string) => ({
  to: RECIPIENT,
  templateKey: "collaboration.mention" as const,
  variables: { actorName: "Test", recordLabel: "a task", link: "https://nesto.example/tasks/abc" },
  idempotencyKey: key,
  entity: { type: "MailTest", id: "mail-test" },
});

beforeEach(() => {
  clearOutbox();
  resetMetrics();
});

afterEach(async () => {
  setMailProvider(null);
  for (const key of ENV_KEYS) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
  await prisma.mailDelivery.deleteMany({ where: { recipient: RECIPIENT } });
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("sendMail", () => {
  it("records a sent message as metadata, never the body", async () => {
    const outcome = await sendMail(message());
    expect(outcome.status).toBe("SENT");

    const row = await prisma.mailDelivery.findUniqueOrThrow({ where: { id: outcome.deliveryId } });
    expect(row).toMatchObject({ status: "SENT", templateKey: "collaboration.mention", attempts: 1, provider: "memory" });
    expect(row.sentAt).not.toBeNull();
    expect(JSON.stringify(row)).not.toContain("token=abc");
    expect(readOutbox()).toHaveLength(1);
    expect(counterValue(Metric.MAIL_SEND_SUCCESS, { template: "collaboration.mention", provider: "memory" })).toBe(1);
  });

  it("sends once for a repeated idempotency key (PRD #38 §155)", async () => {
    const first = await sendMail(message("mail-test-idempotent"));
    const second = await sendMail(message("mail-test-idempotent"));

    expect(second.deliveryId).toBe(first.deliveryId);
    expect(readOutbox()).toHaveLength(1);
    expect(await prisma.mailDelivery.count({ where: { idempotencyKey: "mail-test-idempotent" } })).toBe(1);
  });

  it("sends once when the same key races itself", async () => {
    const outcomes = await Promise.all([
      sendMail(message("mail-test-race")),
      sendMail(message("mail-test-race")),
      sendMail(message("mail-test-race")),
    ]);
    expect(new Set(outcomes.map((outcome) => outcome.deliveryId)).size).toBe(1);
    expect(await prisma.mailDelivery.count({ where: { idempotencyKey: "mail-test-race" } })).toBe(1);
  });

  it("retries a transient failure and records the attempts", async () => {
    const { provider, sent } = scripted([
      { status: "FAILED", errorCode: "HTTP_503", retryable: true },
      { status: "SENT" },
    ]);
    setMailProvider(provider);

    const outcome = await sendMail(message());
    expect(outcome.status).toBe("SENT");
    expect(sent).toHaveLength(2);
    const row = await prisma.mailDelivery.findUniqueOrThrow({ where: { id: outcome.deliveryId } });
    expect(row.attempts).toBe(2);
    expect(counterValue(Metric.MAIL_RETRY, { template: "collaboration.mention" })).toBe(1);
  });

  it("gives up after bounded attempts and leaves a visible FAILED delivery", async () => {
    const failure = { status: "FAILED" as const, errorCode: "HTTP_503", retryable: true };
    const { provider, sent } = scripted([failure, failure, failure, failure]);
    setMailProvider(provider);

    const outcome = await sendMail(message());
    expect(outcome).toMatchObject({ status: "FAILED", errorCode: "HTTP_503" });
    expect(sent).toHaveLength(3);
    const row = await prisma.mailDelivery.findUniqueOrThrow({ where: { id: outcome.deliveryId } });
    expect(row).toMatchObject({ status: "FAILED", attempts: 3, errorCode: "HTTP_503" });
    expect(counterValue(Metric.MAIL_SEND_FAILURE, { template: "collaboration.mention", provider: "scripted" })).toBe(1);
  });

  it("does not retry a failure the provider says is final", async () => {
    const { provider, sent } = scripted([{ status: "FAILED", errorCode: "POSTMARK_406", retryable: false }]);
    setMailProvider(provider);

    const outcome = await sendMail(message());
    expect(outcome.status).toBe("FAILED");
    expect(sent).toHaveLength(1);
  });

  it("refuses to swallow mail in production when no real provider is configured", async () => {
    process.env.APP_ENV = "production";
    process.env.MAIL_PROVIDER = "memory";
    setMailProvider(null);

    const outcome = await sendMail(message());
    expect(outcome).toMatchObject({ status: "FAILED", errorCode: "MAIL_PROVIDER_NOT_CONFIGURED" });
    expect(readOutbox()).toHaveLength(0);
  });
});

describe("staging recipients (PRD #38 §12)", () => {
  it("suppresses an address outside the allowlist", async () => {
    process.env.APP_ENV = "staging";
    process.env.MAIL_ALLOWED_RECIPIENTS = "qa@nesto.example, @allowed.example";

    expect(recipientAllowed("qa@nesto.example")).toBe(true);
    expect(recipientAllowed("anyone@allowed.example")).toBe(true);
    expect(recipientAllowed("customer@real-company.com")).toBe(false);

    const outcome = await sendMail(message());
    expect(outcome).toMatchObject({ status: "SUPPRESSED", errorCode: "RECIPIENT_NOT_ALLOWLISTED" });
    expect(readOutbox()).toHaveLength(0);
  });

  it("sends to nobody from staging when no allowlist is configured", () => {
    process.env.APP_ENV = "staging";
    delete process.env.MAIL_ALLOWED_RECIPIENTS;
    expect(recipientAllowed("qa@nesto.example")).toBe(false);
  });

  it("ignores the allowlist in production", () => {
    process.env.APP_ENV = "production";
    process.env.MAIL_ALLOWED_RECIPIENTS = "qa@nesto.example";
    expect(recipientAllowed("customer@real-company.com")).toBe(true);
  });
});
