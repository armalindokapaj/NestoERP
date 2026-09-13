import { Prisma } from "@prisma/client";

import { prisma } from "@/lib/database/prisma";
import { logger } from "@/lib/core/observability/logger";
import { incrementCounter, Metric } from "@/lib/core/observability/metrics";
import type { MailMessage, MailOutcome, MailProvider } from "./mail.types";
import {
  ConsoleMailProvider,
  MemoryMailProvider,
  PostmarkMailProvider,
  ResendMailProvider,
  UnconfiguredMailProvider,
} from "./providers";
import { renderMailTemplate } from "./templates";

/**
 * Sending mail (PRD #38 §10-§16).
 *
 * Every message leaves a `MailDelivery` row recording where it got to, so a
 * failed invitation is something an operator can see rather than something a
 * user reports a week later (PRD #38 §21). The row holds metadata only.
 *
 * Sending is synchronous and bounded. The two messages that matter most — an
 * invitation and a password reset — carry a credential in their link, which is
 * exactly what must not sit in a queue table waiting for a worker. A transient
 * provider failure is retried here, a few times, quickly; a lasting one is
 * recorded as FAILED and recovered by issuing a new message, never by replaying
 * the old one.
 */

const MAX_ATTEMPTS = 3;
const BACKOFF_MS = [250, 1000];

type Environment = "development" | "staging" | "production";

/**
 * The deployment environment, read directly rather than through the validated
 * schema. A local production build (`pnpm test:e2e:prod`) sets NODE_ENV but
 * not APP_ENV, and must keep working on the memory provider — so only an
 * explicit APP_ENV makes this strict.
 */
function deploymentEnvironment(): Environment {
  const value = process.env.APP_ENV;
  return value === "staging" || value === "production" ? value : "development";
}

let override: MailProvider | null = null;
let cached: MailProvider | null = null;

export function mailProvider(): MailProvider {
  if (override) return override;
  if (cached) return cached;
  cached = buildProvider();
  return cached;
}

function buildProvider(): MailProvider {
  const configured = (process.env.MAIL_PROVIDER ?? "memory").toLowerCase();
  const environment = deploymentEnvironment();

  if (configured === "memory" || configured === "console") {
    // A production deployment that would silently swallow its invitations is a
    // configuration fault, and it is reported as one on every delivery.
    if (environment === "production") {
      return new UnconfiguredMailProvider(configured, "MAIL_PROVIDER_NOT_CONFIGURED");
    }
    return configured === "console" ? new ConsoleMailProvider() : new MemoryMailProvider();
  }

  const apiKey = process.env.MAIL_API_KEY;
  if (!apiKey || !process.env.MAIL_FROM) {
    return new UnconfiguredMailProvider(configured, "MAIL_CREDENTIALS_MISSING");
  }

  if (configured === "resend") {
    return new ResendMailProvider({ apiKey, baseUrl: process.env.MAIL_API_URL });
  }
  if (configured === "postmark") {
    return new PostmarkMailProvider({
      apiKey,
      baseUrl: process.env.MAIL_API_URL,
      messageStream: process.env.MAIL_POSTMARK_STREAM,
    });
  }

  return new UnconfiguredMailProvider(configured, "MAIL_PROVIDER_UNKNOWN");
}

/** Test seam. `null` restores configuration-driven selection. */
export function setMailProvider(provider: MailProvider | null): void {
  override = provider;
  cached = null;
}

function fromAddress(): string {
  return process.env.MAIL_FROM ?? "NESTO <no-reply@nesto.local>";
}

/**
 * Staging never mails a real customer (PRD #38 §12). Outside production an
 * allowlist, when configured, is authoritative; staging without one sends to
 * nobody. Entries are exact addresses or `@domain`.
 */
export function recipientAllowed(recipient: string): boolean {
  const environment = deploymentEnvironment();
  if (environment === "production") return true;

  const raw = process.env.MAIL_ALLOWED_RECIPIENTS;
  if (!raw || raw.trim() === "") return environment !== "staging";

  const address = recipient.trim().toLowerCase();
  return raw
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean)
    .some((entry) => (entry.startsWith("@") ? address.endsWith(entry) : address === entry));
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Finds the delivery an earlier send with the same key already made. */
async function existingDelivery(idempotencyKey: string | undefined) {
  if (!idempotencyKey) return null;
  return prisma.mailDelivery.findUnique({ where: { idempotencyKey } });
}

/**
 * Sends one templated message and records the outcome. Never throws for a
 * delivery failure — the caller has usually committed something already (an
 * invitation) and needs to know, not to be unwound.
 */
export async function sendMail(message: MailMessage): Promise<MailOutcome> {
  const provider = mailProvider();
  const recipient = message.to.trim().toLowerCase();

  // Rendering first: a template fault is a programming error, and it should
  // fail loudly in a test rather than record a delivery that never had a body.
  const rendered = renderMailTemplate(message.templateKey, message.variables);

  const prior = await existingDelivery(message.idempotencyKey);
  if (prior && (prior.status === "SENT" || prior.status === "SUPPRESSED")) {
    return { deliveryId: prior.id, status: prior.status };
  }

  let deliveryId: string;
  if (prior) {
    deliveryId = prior.id;
  } else {
    try {
      const created = await prisma.mailDelivery.create({
        data: {
          companyId: message.companyId ?? null,
          recipient,
          templateKey: message.templateKey,
          provider: provider.name,
          idempotencyKey: message.idempotencyKey ?? null,
          entityType: message.entity?.type ?? null,
          entityId: message.entity?.id ?? null,
        },
        select: { id: true },
      });
      deliveryId = created.id;
    } catch (error) {
      // Two concurrent sends with one key: the loser returns the winner's row.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        const winner = await existingDelivery(message.idempotencyKey);
        // QUEUED here means the other request is mid-send: it owns the outcome.
        if (winner) return { deliveryId: winner.id, status: winner.status === "QUEUED" ? "SENT" : winner.status };
      }
      throw error;
    }
  }

  if (!recipientAllowed(recipient)) {
    await prisma.mailDelivery.update({
      where: { id: deliveryId },
      data: { status: "SUPPRESSED", errorCode: "RECIPIENT_NOT_ALLOWLISTED", lastAttemptAt: new Date() },
    });
    incrementCounter(Metric.MAIL_SUPPRESSED, { template: message.templateKey });
    logger.info("mail.suppressed", { deliveryId, templateKey: message.templateKey });
    return { deliveryId, status: "SUPPRESSED", errorCode: "RECIPIENT_NOT_ALLOWLISTED" };
  }

  let lastErrorCode = "UNKNOWN";
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    if (attempt > 1) {
      incrementCounter(Metric.MAIL_RETRY, { template: message.templateKey });
      await sleep(BACKOFF_MS[attempt - 2] ?? 1000);
    }

    let result;
    try {
      result = await provider.send({
        ...rendered,
        to: recipient,
        from: fromAddress(),
        idempotencyKey: message.idempotencyKey,
      });
    } catch {
      result = { status: "FAILED" as const, errorCode: "PROVIDER_THREW", retryable: true };
    }

    if (result.status === "SENT") {
      await prisma.mailDelivery.update({
        where: { id: deliveryId },
        data: {
          status: "SENT",
          providerMessageId: result.providerMessageId ?? null,
          errorCode: null,
          attempts: { increment: 1 },
          lastAttemptAt: new Date(),
          sentAt: new Date(),
          provider: provider.name,
        },
      });
      incrementCounter(Metric.MAIL_SEND_SUCCESS, { template: message.templateKey, provider: provider.name });
      return { deliveryId, status: "SENT" };
    }

    lastErrorCode = result.errorCode ?? "UNKNOWN";
    await prisma.mailDelivery.update({
      where: { id: deliveryId },
      data: { attempts: { increment: 1 }, lastAttemptAt: new Date(), errorCode: lastErrorCode },
    });
    if (!result.retryable) break;
  }

  await prisma.mailDelivery.update({
    where: { id: deliveryId },
    data: { status: "FAILED", errorCode: lastErrorCode },
  });
  incrementCounter(Metric.MAIL_SEND_FAILURE, { template: message.templateKey, provider: provider.name });
  // The recipient and the link stay out of the log (PRD #38 §18).
  logger.error("mail.send.failed", {
    deliveryId,
    templateKey: message.templateKey,
    provider: provider.name,
    errorCode: lastErrorCode,
  });
  return { deliveryId, status: "FAILED", errorCode: lastErrorCode };
}

/** The most recent delivery recorded for a record — what an invitation list shows. */
export async function latestDeliveryFor(entityType: string, entityId: string) {
  return prisma.mailDelivery.findFirst({
    where: { entityType, entityId },
    orderBy: { createdAt: "desc" },
    select: { id: true, status: true, errorCode: true, createdAt: true, sentAt: true },
  });
}
