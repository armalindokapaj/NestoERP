import type { Prisma } from "@prisma/client";

import { AccessError } from "@/lib/access/guards";
import { canPlatform, type PlatformContext } from "@/lib/context/platform-context";
import { prisma } from "@/lib/database/prisma";

import { calculatePricing, hasRozarisProjects } from "./pricing.engine";
import {
  createPricingVersionSchema,
  pricingConfigSchema,
  pricingPromotionConfigSchema,
  type PricingLeadInput,
} from "./pricing.schema";
import type { PricingConfig, PricingPromotionConfig, PricingQuote, PricingRequest, PublicPricingConfig } from "./pricing.types";

const toJson = (value: unknown) => value as Prisma.InputJsonValue;

// Price books and promotions belong to the platform control plane, not a tenant.
// Saved public quotes are likewise global and are addressed by an opaque UUID;
// their public mutation path is separately origin-checked and rate-limited.

function assertPricingPermission(context: PlatformContext, permission: "platform.pricing.view" | "platform.pricing.manage") {
  if (!canPlatform(context, permission)) throw new AccessError("FORBIDDEN");
}

function activeAt(now: Date) {
  return {
    status: "ACTIVE" as const,
    AND: [
      { OR: [{ startsAt: null }, { startsAt: { lte: now } }] },
      { OR: [{ endsAt: null }, { endsAt: { gt: now } }] },
    ],
  };
}

export async function resolvePublicPricing(now = new Date()): Promise<{
  versionId: string;
  config: PricingConfig;
  promotions: PricingPromotionConfig[];
}> {
  const version = await prisma.pricingVersion.findFirst({
    where: {
      status: "ACTIVE",
      effectiveFrom: { lte: now },
      OR: [{ effectiveUntil: null }, { effectiveUntil: { gt: now } }],
    },
    orderBy: [{ effectiveFrom: "desc" }, { publishedAt: "desc" }],
  });
  if (!version) throw new AccessError("INTERNAL_ERROR", "Pricing is temporarily unavailable.");

  const parsed = pricingConfigSchema.parse(version.configJson);
  const config: PricingConfig = { ...parsed, version: version.versionCode, currency: "EUR" };
  const promotionRows = await prisma.pricingPromotion.findMany({ where: activeAt(now), orderBy: { code: "asc" } });
  const promotions = promotionRows.flatMap((row) => {
    const result = pricingPromotionConfigSchema.safeParse(row.configJson);
    return result.success && result.data.enabled ? [{ ...result.data, displayName: row.name }] : [];
  });
  return { versionId: version.id, config, promotions };
}

export async function getPublicPricingConfig(now = new Date()): Promise<PublicPricingConfig> {
  const bundle = await resolvePublicPricing(now);
  return {
    pricingVersion: bundle.config.version,
    currency: bundle.config.currency,
    publicRules: bundle.config,
    promotions: bundle.promotions,
  };
}

function requestedPromotion(input: PricingRequest, promotions: PricingPromotionConfig[]) {
  return promotions.find((promotion) => promotion.code === input.promotionCode) ?? null;
}

function makeQuoteIdentity() {
  const id = crypto.randomUUID();
  return { id, reference: `NESTO-${id.replaceAll("-", "").slice(0, 8).toUpperCase()}` };
}

export async function calculateAuthoritativePricing(
  input: PricingRequest,
  options: { persistQuote?: boolean; now?: Date } = {},
): Promise<PricingQuote> {
  const now = options.now ?? new Date();
  const bundle = await resolvePublicPricing(now);
  const promotion = requestedPromotion(input, bundle.promotions);

  if (!options.persistQuote) return calculatePricing(input, bundle.config, promotion);

  if (input.productMode === "ROZARIS_ONLY" && !hasRozarisProjects(input)) {
    throw new AccessError("VALIDATION_ERROR", "Add at least one ROZARIS project before saving a quote.", {
      rozaris: ["At least one ROZARIS project is required."],
    });
  }

  const identity = makeQuoteIdentity();
  const quote = calculatePricing(input, bundle.config, promotion, {
    quoteId: identity.id,
    quoteReference: identity.reference,
  });

  await prisma.$transaction(async (tx) => {
    await tx.pricingQuote.create({
      data: {
        id: identity.id,
        reference: identity.reference,
        pricingVersionId: bundle.versionId,
        pricingVersionCode: quote.pricingVersion,
        productMode: input.productMode,
        configurationJson: toJson(input),
        calculatedResultJson: toJson(quote),
        currency: quote.currency,
        standardMonthlyCents: BigInt(Math.round(quote.standardMonthly * 100)),
        contractMonths: quote.contract.months,
        preIndexationValueCents: BigInt(Math.round(quote.contract.preIndexationValue * 100)),
        promotionCode: quote.promotion.appliedCode,
        expiresAt: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1_000),
      },
    });
    await tx.pricingAuditLog.create({
      data: {
        action: "QUOTE_CALCULATED",
        entityType: "PricingQuote",
        entityId: identity.id,
        pricingVersion: quote.pricingVersion,
        afterJson: toJson({
          reference: identity.reference,
          productMode: input.productMode,
          standardMonthly: quote.standardMonthly,
          contractMonths: quote.contract.months,
          preIndexationValue: quote.contract.preIndexationValue,
        }),
      },
    });
  });

  return quote;
}

export async function submitPricingLead(input: PricingLeadInput, now = new Date()) {
  const quote = await prisma.pricingQuote.findUnique({ where: { id: input.quoteId } });
  if (!quote || quote.expiresAt <= now || quote.status === "EXPIRED") {
    throw new AccessError("NOT_FOUND", "This pricing quote is unavailable or has expired.");
  }

  const quoteConfiguration = quote.configurationJson as Record<string, unknown>;
  if (input.requestType === "THREE_D_PRODUCTION") {
    const rozaris = quoteConfiguration.rozaris as Record<string, unknown> | undefined;
    const projectCount = Number(rozaris?.basicProjects ?? 0) + Number(rozaris?.largeProjects ?? 0) + Number(rozaris?.villageProjects ?? 0);
    if (projectCount < 1) throw new AccessError("VALIDATION_ERROR", "A 3D production request requires a ROZARIS project.");
  }

  const result = await prisma.$transaction(async (tx) => {
    const lead = await tx.pricingLead.create({
      data: {
        quoteId: quote.id,
        requestType: input.requestType,
        fullName: input.fullName,
        companyName: input.companyName,
        businessEmail: input.businessEmail,
        phone: input.phone || null,
        message: input.message || null,
        consentAt: now,
      },
    });
    const status = input.requestType === "FORMAL_PROPOSAL" ? "PROPOSAL_REQUESTED" : "LEAD_SUBMITTED";
    await tx.pricingQuote.update({ where: { id: quote.id }, data: { status } });
    await tx.pricingAuditLog.create({
      data: {
        action: "QUOTE_LEAD_SUBMITTED",
        entityType: "PricingQuote",
        entityId: quote.id,
        pricingVersion: quote.pricingVersionCode,
        afterJson: toJson({ requestType: input.requestType, leadId: lead.id, status }),
      },
    });
    return lead;
  });

  return { id: result.id, quoteId: quote.id, reference: quote.reference, requestType: result.requestType };
}

export async function getPricingAdministration(context: PlatformContext) {
  assertPricingPermission(context, "platform.pricing.view");
  const [versions, promotions, recentQuotes] = await Promise.all([
    prisma.pricingVersion.findMany({ orderBy: [{ createdAt: "desc" }], take: 50 }),
    prisma.pricingPromotion.findMany({ orderBy: [{ createdAt: "desc" }] }),
    prisma.pricingQuote.findMany({
      orderBy: [{ createdAt: "desc" }],
      take: 20,
      select: { id: true, reference: true, productMode: true, status: true, standardMonthlyCents: true, contractMonths: true, pricingVersionCode: true, createdAt: true, _count: { select: { leads: true } } },
    }),
  ]);
  return {
    versions: versions.map((version) => ({ ...version, configJson: pricingConfigSchema.parse(version.configJson), effectiveFrom: version.effectiveFrom.toISOString(), effectiveUntil: version.effectiveUntil?.toISOString() ?? null, createdAt: version.createdAt.toISOString(), updatedAt: version.updatedAt.toISOString(), publishedAt: version.publishedAt?.toISOString() ?? null })),
    promotions: promotions.map((promotion) => ({ ...promotion, configJson: pricingPromotionConfigSchema.parse(promotion.configJson), startsAt: promotion.startsAt?.toISOString() ?? null, endsAt: promotion.endsAt?.toISOString() ?? null, createdAt: promotion.createdAt.toISOString(), updatedAt: promotion.updatedAt.toISOString() })),
    recentQuotes: recentQuotes.map((quote) => ({ ...quote, standardMonthly: Number(quote.standardMonthlyCents) / 100, createdAt: quote.createdAt.toISOString(), leads: quote._count.leads, standardMonthlyCents: undefined, _count: undefined })),
  };
}

export async function createPricingDraft(context: PlatformContext, raw: { versionCode: string }) {
  assertPricingPermission(context, "platform.pricing.manage");
  const input = createPricingVersionSchema.parse(raw);
  const current = await prisma.pricingVersion.findFirst({ where: { status: "ACTIVE" }, orderBy: { effectiveFrom: "desc" } });
  if (!current) throw new AccessError("CONFLICT", "Publish an initial pricing version first.");
  const source = pricingConfigSchema.parse(current.configJson);
  const nextConfig = { ...source, version: input.versionCode };
  return prisma.$transaction(async (tx) => {
    const created = await tx.pricingVersion.create({
      data: { versionCode: input.versionCode, currency: "EUR", status: "DRAFT", configJson: toJson(nextConfig), effectiveFrom: new Date(), createdByUserId: context.userId },
    });
    await tx.pricingAuditLog.create({ data: { actorUserId: context.userId, action: "PRICE_VERSION_CREATED", entityType: "PricingVersion", entityId: created.id, pricingVersion: created.versionCode, afterJson: toJson({ versionCode: created.versionCode, status: created.status }) } });
    return { id: created.id, versionCode: created.versionCode, status: created.status };
  });
}

export async function updatePricingDraft(context: PlatformContext, id: string, config: PricingConfig, effectiveFrom: Date) {
  assertPricingPermission(context, "platform.pricing.manage");
  const existing = await prisma.pricingVersion.findUnique({ where: { id } });
  if (!existing) throw new AccessError("NOT_FOUND");
  if (existing.status !== "DRAFT") throw new AccessError("CONFLICT", "Published pricing versions are immutable.");
  const parsed = pricingConfigSchema.parse({ ...config, version: existing.versionCode, currency: "EUR" });
  return prisma.$transaction(async (tx) => {
    const updated = await tx.pricingVersion.update({ where: { id }, data: { configJson: toJson(parsed), effectiveFrom } });
    await tx.pricingAuditLog.create({ data: { actorUserId: context.userId, action: "PRICE_VERSION_UPDATED", entityType: "PricingVersion", entityId: id, pricingVersion: existing.versionCode, beforeJson: existing.configJson as Prisma.InputJsonValue, afterJson: toJson(parsed) } });
    return { id: updated.id, versionCode: updated.versionCode, status: updated.status };
  });
}

export async function publishPricingVersion(context: PlatformContext, id: string, reason: string, now = new Date()) {
  assertPricingPermission(context, "platform.pricing.manage");
  return prisma.$transaction(async (tx) => {
    const currentTarget = await tx.pricingVersion.findUnique({ where: { id } });
    if (!currentTarget) throw new AccessError("NOT_FOUND");
    if (currentTarget.status !== "DRAFT") throw new AccessError("CONFLICT", "Only a draft pricing version can be published.");
    pricingConfigSchema.parse(currentTarget.configJson);
    const retired = await tx.pricingVersion.findMany({ where: { status: "ACTIVE" }, select: { id: true, versionCode: true } });
    await tx.pricingVersion.updateMany({ where: { status: "ACTIVE" }, data: { status: "RETIRED", effectiveUntil: now } });
    for (const version of retired) {
      await tx.pricingAuditLog.create({ data: { actorUserId: context.userId, action: "PRICE_VERSION_RETIRED", entityType: "PricingVersion", entityId: version.id, pricingVersion: version.versionCode, afterJson: toJson({ reason }) } });
    }
    const published = await tx.pricingVersion.update({ where: { id }, data: { status: "ACTIVE", effectiveFrom: now, effectiveUntil: null, publishedAt: now, publishedByUserId: context.userId } });
    await tx.pricingAuditLog.create({ data: { actorUserId: context.userId, action: "PRICE_VERSION_PUBLISHED", entityType: "PricingVersion", entityId: id, pricingVersion: currentTarget.versionCode, afterJson: toJson({ reason }) } });
    return { id: published.id, versionCode: published.versionCode, status: published.status };
  }, { isolationLevel: "Serializable" });
}

export async function updatePricingPromotion(context: PlatformContext, id: string, input: { name: string; status: "ACTIVE" | "INACTIVE"; config: PricingPromotionConfig; startsAt: Date | null; endsAt: Date | null }) {
  assertPricingPermission(context, "platform.pricing.manage");
  const existing = await prisma.pricingPromotion.findUnique({ where: { id } });
  if (!existing) throw new AccessError("NOT_FOUND");
  if (input.endsAt && input.startsAt && input.endsAt <= input.startsAt) throw new AccessError("VALIDATION_ERROR", "Promotion end must be after its start.");
  const promotionConfig = { ...input.config };
  delete promotionConfig.displayName;
  const config = pricingPromotionConfigSchema.parse({ ...promotionConfig, code: existing.code });
  return prisma.$transaction(async (tx) => {
    const updated = await tx.pricingPromotion.update({ where: { id }, data: { name: input.name, status: input.status, configJson: toJson(config), startsAt: input.startsAt, endsAt: input.endsAt, updatedByUserId: context.userId } });
    await tx.pricingAuditLog.create({ data: { actorUserId: context.userId, action: "PROMOTION_UPDATED", entityType: "PricingPromotion", entityId: id, pricingVersion: null, beforeJson: existing.configJson as Prisma.InputJsonValue, afterJson: toJson(config) } });
    return { id: updated.id, code: updated.code, status: updated.status };
  });
}
