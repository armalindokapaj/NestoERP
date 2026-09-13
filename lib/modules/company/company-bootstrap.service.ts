import { z } from "zod";

import { MODULE_KEYS, type ModuleKey } from "@/config/modules";
import { appLink } from "@/lib/config/app-url";
import { AuditAction } from "@/lib/core/audit/audit-policy.registry";
import { recordSystemAction } from "@/lib/core/audit/audit.service";
import { NUMBERING_DEFAULTS } from "@/lib/core/numbering/numbering.service";
import { DEFAULT_MAX_FILE_BYTES } from "@/lib/core/storage";
import { prisma } from "@/lib/database/prisma";
import { sendMail, type MailOutcome } from "@/lib/mail";
import { CORE_MODULES, DEPENDENCIES } from "@/lib/modules/settings/module-toggle.service";
import {
  generateInviteToken,
  hashInviteToken,
  inviteExpiry,
  normalizeEmail,
} from "@/lib/modules/team/invitations/invite.token";

/**
 * Production company provisioning (PRD #38 §19).
 *
 * Creates everything a company needs to function — the company, its settings,
 * its module switches, numbering, integration settings, storage quota — and an
 * Owner invitation, without any of the demo seed. Nobody sets the Owner's
 * password here: the Owner receives an invitation and chooses it themselves,
 * so no credential ever passes through the operator running the command.
 *
 * Idempotent by slug. Running it again converges: missing configuration is
 * filled in, nothing existing is changed, and a second Owner invitation is only
 * issued when the first is no longer usable (PRD #38 §135).
 */

export const bootstrapCompanySchema = z.object({
  name: z.string().trim().min(2).max(120),
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/, "slug must be lowercase letters, digits and hyphens"),
  legalName: z.string().trim().max(200).optional(),
  country: z.string().trim().max(80).optional(),
  ownerEmail: z.string().trim().email(),
  disabledModules: z.array(z.enum(MODULE_KEYS)).default([]),
  timezone: z.string().trim().max(64).optional(),
  locale: z.string().trim().max(16).optional(),
  baseCurrency: z.string().trim().length(3).toUpperCase().optional(),
});

export type BootstrapCompanyInput = z.input<typeof bootstrapCompanySchema>;

export type BootstrapCompanyResult = {
  companyId: string;
  slug: string;
  companyCreated: boolean;
  modulesEnabled: ModuleKey[];
  modulesDisabled: ModuleKey[];
  owner:
    | { state: "ALREADY_ACTIVE" }
    | { state: "INVITATION_PENDING"; inviteId: string }
    | { state: "INVITED"; inviteId: string; delivery: MailOutcome["status"]; inviteUrl?: string };
};

/** Refuses a module mix the product cannot run: a core module off, or a dependency missing. */
export function validateModuleSelection(disabled: ModuleKey[]): string[] {
  const off = new Set(disabled);
  const problems: string[] = [];
  for (const key of disabled) {
    if (CORE_MODULES.includes(key)) problems.push(`${key} is a core module and cannot be disabled`);
  }
  for (const [key, needs] of Object.entries(DEPENDENCIES) as Array<[ModuleKey, ModuleKey[]]>) {
    if (off.has(key)) continue;
    for (const dependency of needs) {
      if (off.has(dependency)) problems.push(`${key} needs ${dependency} enabled`);
    }
  }
  return problems;
}

export async function bootstrapCompany(raw: BootstrapCompanyInput): Promise<BootstrapCompanyResult> {
  const input = bootstrapCompanySchema.parse(raw);
  const ownerEmail = normalizeEmail(input.ownerEmail);

  const problems = validateModuleSelection(input.disabledModules);
  if (problems.length > 0) throw new Error(`Invalid module selection: ${problems.join("; ")}`);

  const [ownerRole, moduleRows] = await Promise.all([
    prisma.role.findUnique({ where: { key: "OWNER" }, select: { id: true } }),
    prisma.module.findMany({ select: { id: true, key: true } }),
  ]);
  if (!ownerRole || moduleRows.length < MODULE_KEYS.length) {
    throw new Error("The access configuration is missing. Run `pnpm access:sync` first.");
  }

  const disabled = new Set<string>(input.disabledModules);
  const now = new Date();

  const provisioned = await prisma.$transaction(async (tx) => {
    const existing = await tx.company.findUnique({ where: { slug: input.slug }, select: { id: true } });
    const company =
      existing ??
      (await tx.company.create({
        data: {
          slug: input.slug,
          name: input.name,
          legalName: input.legalName ?? null,
          country: input.country ?? null,
          status: "ACTIVE",
        },
        select: { id: true },
      }));
    const companyId = company.id;

    // Module switches: created where missing, never flipped on a rerun — an
    // administrator may have changed them since.
    await tx.companyModule.createMany({
      data: moduleRows.map((row) => ({ companyId, moduleId: row.id, enabled: !disabled.has(row.key) })),
      skipDuplicates: true,
    });

    await tx.companySettings.upsert({
      where: { companyId },
      update: {},
      create: {
        companyId,
        ...(input.locale ? { locale: input.locale } : {}),
        ...(input.timezone ? { timezone: input.timezone } : {}),
        ...(input.baseCurrency ? { baseCurrency: input.baseCurrency } : {}),
      },
    });
    await tx.companyIntegrationSettings.upsert({ where: { companyId }, update: {}, create: { companyId } });
    await tx.financeSettings.upsert({ where: { companyId }, update: {}, create: { companyId } });
    await tx.companyNumberingScheme.createMany({
      data: NUMBERING_DEFAULTS.map((scheme) => ({
        companyId,
        moduleKey: scheme.moduleKey,
        entityType: scheme.entityType,
        prefix: scheme.prefix,
      })),
      skipDuplicates: true,
    });
    await tx.companyStorageQuota.upsert({
      where: { companyId },
      update: {},
      create: { companyId, maxStorageBytes: null, maxSingleFileBytes: BigInt(DEFAULT_MAX_FILE_BYTES) },
    });

    if (!existing) {
      await recordSystemAction(
        companyId,
        {
          actionKey: AuditAction.COMPANY_CREATED,
          entity: { type: "Company", id: companyId, label: input.name },
          after: {
            name: input.name,
            slug: input.slug,
            ownerEmail,
            modules: moduleRows.filter((row) => !disabled.has(row.key)).map((row) => row.key).join(","),
          },
        },
        { tx },
      );
    }

    // The Owner: nothing to do if they are already in; reuse a live invitation;
    // otherwise issue one.
    const ownerUser = await tx.user.findUnique({ where: { email: ownerEmail }, select: { id: true } });
    const activeOwner = ownerUser
      ? await tx.companyMember.findFirst({
          where: { companyId, userId: ownerUser.id, status: "ACTIVE", role: { key: "OWNER" } },
          select: { id: true },
        })
      : null;
    if (activeOwner) return { companyId, created: !existing, owner: { state: "ALREADY_ACTIVE" as const } };

    const pending = await tx.companyInvite.findFirst({
      where: { companyId, email: ownerEmail, status: "PENDING", expiresAt: { gt: now } },
      select: { id: true },
    });
    if (pending) {
      return { companyId, created: !existing, owner: { state: "INVITATION_PENDING" as const, inviteId: pending.id } };
    }

    const token = generateInviteToken();
    await tx.companyInvite.updateMany({
      where: { companyId, email: ownerEmail, status: "PENDING" },
      data: { status: "EXPIRED" },
    });
    const invite = await tx.companyInvite.create({
      data: {
        companyId,
        email: ownerEmail,
        userId: ownerUser?.id ?? null,
        roleId: ownerRole.id,
        tokenHash: hashInviteToken(token),
        status: "PENDING",
        expiresAt: inviteExpiry(now),
        // No member exists yet to have issued it: the platform did.
        createdByMemberId: "system:bootstrap",
      },
      select: { id: true },
    });
    return { companyId, created: !existing, owner: { state: "ISSUE" as const, inviteId: invite.id, token } };
  });

  const enabledKeys = moduleRows.filter((row) => !disabled.has(row.key)).map((row) => row.key as ModuleKey);
  const base = {
    companyId: provisioned.companyId,
    slug: input.slug,
    companyCreated: provisioned.created,
    modulesEnabled: enabledKeys,
    modulesDisabled: [...input.disabledModules],
  };

  if (provisioned.owner.state !== "ISSUE") return { ...base, owner: provisioned.owner };

  const { inviteId, token } = provisioned.owner;
  const acceptUrl = appLink(`/invite/${token}`);
  const expiresInDays = Math.round((inviteExpiry(now).getTime() - now.getTime()) / 86_400_000);
  const outcome = await sendMail({
    to: ownerEmail,
    templateKey: "company.owner_invitation",
    variables: { companyName: input.name, acceptUrl, expiresInDays: String(expiresInDays) },
    idempotencyKey: `invite:${inviteId}:${hashInviteToken(token).slice(0, 16)}`,
    companyId: provisioned.companyId,
    entity: { type: "CompanyInvite", id: inviteId },
  });

  return {
    ...base,
    owner: {
      state: "INVITED",
      inviteId,
      delivery: outcome.status,
      // An operator without working mail still has a way to hand the link over;
      // never printed in production, where mail is mandatory.
      ...(process.env.APP_ENV !== "production" ? { inviteUrl: acceptUrl } : {}),
    },
  };
}
