import { z } from "zod";

import { SESSION_TTL_MS } from "@/lib/auth/constants";
import { AccessError } from "@/lib/access/guards";
import { appLink } from "@/lib/config/app-url";
import { canPlatform, type PlatformContext } from "@/lib/context/platform-context";
import { AuditAction } from "@/lib/core/audit/audit-policy.registry";
import { recordGlobalPlatformAction } from "@/lib/core/audit/audit.service";
import { storageProvider } from "@/lib/core/storage/storage-provider.factory";
import { prisma } from "@/lib/database/prisma";
import { mailProvider, sendMail } from "@/lib/mail";

/**
 * How the NESTO platform is configured (Admin Users & System PRD #6 §45-§60).
 *
 * Read from the deployment and from what the platform can verify — never a
 * secret. A value that is configured shows as "Configured"; its content never
 * leaves the server. Nothing here edits deployment configuration.
 */

function assertSettings(context: PlatformContext) {
  if (!canPlatform(context, "platform.settings.view")) throw new AccessError("FORBIDDEN");
}

export type IntegrationStatus = "Connected" | "Not Connected" | "Configuration Required" | "Error";

export async function systemOverview(context: PlatformContext) {
  assertSettings(context);
  const provider = mailProvider();
  const mailDisabled = process.env.MAIL_DELIVERY === "disabled";
  const [lastTest, failedMail, platformAdmins, failedLogins, storageOk, resetRequests] = await Promise.all([
    prisma.mailDelivery.findFirst({ where: { templateKey: "platform.test_email" }, orderBy: { createdAt: "desc" }, select: { status: true, createdAt: true, errorCode: true } }),
    prisma.mailDelivery.count({ where: { status: "FAILED", createdAt: { gte: new Date(Date.now() - 7 * 86_400_000) } } }),
    prisma.platformAccess.findMany({ where: { status: "ACTIVE" }, select: { user: { select: { id: true, firstName: true, lastName: true, username: true, status: true, recoveryEmailVerifiedAt: true } } } }),
    prisma.authEvent.count({ where: { type: { in: ["LOGIN_FAILED", "LOGIN_RATE_LIMITED", "ACCOUNT_BLOCKED"] }, createdAt: { gte: new Date(Date.now() - 86_400_000) } } }),
    storageProvider().healthCheck().then((result) => result.ok, () => false),
    prisma.authEvent.count({ where: { type: "PASSWORD_RESET_REQUEST", createdAt: { gte: new Date(Date.now() - 7 * 86_400_000) } } }),
  ]);
  // "Configured" means a real transactional provider with its credentials; a sink never delivers.
  const mailReady = !mailDisabled && !provider.sink && provider.constructor.name !== "UnconfiguredMailProvider";
  const commit = process.env.VERCEL_GIT_COMMIT_SHA;
  return {
    general: {
      platformName: "NESTO",
      platformUrl: appLink("/"),
      environment: process.env.APP_ENV ?? process.env.VERCEL_ENV ?? process.env.NODE_ENV ?? "development",
      version: commit ? commit.slice(0, 8) : "local build",
    },
    authentication: {
      sessionHours: Math.round(SESSION_TTL_MS / 3_600_000),
      method: "Username and password",
      passwordReset: mailReady ? "Enabled" : "Email not configured",
      resetRequests7d: resetRequests,
    },
    email: {
      provider: provider.name,
      status: mailDisabled ? "Disabled" : mailReady ? "Configured" : provider.sink ? "Development sink" : "Configuration Required",
      sender: process.env.MAIL_FROM ?? null,
      apiKey: process.env.MAIL_API_KEY ? "Configured" : "Not set",
      lastTest: lastTest ? { status: lastTest.status, at: lastTest.createdAt.toISOString(), errorCode: lastTest.errorCode } : null,
      failed7d: failedMail,
    },
    storage: { driver: process.env.STORAGE_DRIVER ?? "local", status: storageOk ? "Connected" as IntegrationStatus : "Error" as IntegrationStatus },
    integrations: [
      { key: "email", name: "Email delivery", status: (mailReady ? "Connected" : "Configuration Required") as IntegrationStatus, detail: mailReady ? `${provider.name}, verified by the last test send` : "Set MAIL_PROVIDER, MAIL_FROM and MAIL_API_KEY in the deployment." },
      { key: "storage", name: "File storage", status: (storageOk ? "Connected" : "Error") as IntegrationStatus, detail: `${process.env.STORAGE_DRIVER ?? "local"} driver, health check ${storageOk ? "passed" : "failed"}` },
      { key: "m365", name: "Microsoft 365 / OneDrive", status: "Not Connected" as IntegrationStatus, detail: "Not available in this version." },
    ],
    security: {
      platformAdmins: platformAdmins.map((row) => ({ id: row.user.id, name: `${row.user.firstName} ${row.user.lastName}`, username: row.user.username, active: row.user.status === "ACTIVE", canRecover: Boolean(row.user.recoveryEmailVerifiedAt) })),
      failedLogins24h: failedLogins,
    },
  };
}

export const testEmailSchema = z.object({ to: z.string().trim().email().max(200) });

/** Sends one test message through the configured provider and records the outcome (§50). */
export async function sendTestEmail(context: PlatformContext, raw: unknown): Promise<{ status: string; errorCode?: string }> {
  if (!canPlatform(context, "platform.settings.manage")) throw new AccessError("FORBIDDEN");
  const { to } = testEmailSchema.parse(raw);
  const outcome = await sendMail({ to, templateKey: "platform.test_email", variables: { firstName: context.fullName.split(" ")[0] ?? "there", loginUrl: appLink("/login") }, entity: { type: "PlatformTestEmail", id: context.userId } });
  await recordGlobalPlatformAction(context, { actionKey: AuditAction.PLATFORM_TEST_EMAIL_SENT, entity: { type: "PlatformTestEmail", id: outcome.deliveryId, label: "Test email" }, after: { provider: mailProvider().name, status: outcome.status } });
  return { status: outcome.status, errorCode: outcome.errorCode };
}
