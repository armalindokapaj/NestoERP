import { PRICING_EXCLUSIONS } from "./pricing.config";
import type { PricingConfig, PricingPromotionConfig, PricingQuote, PricingRequest } from "./pricing.types";

type QuoteIdentity = { quoteId?: string | null; quoteReference?: string | null };

const euros = (cents: number) => cents / 100;

function discountedCents(amount: number, discountPercent: number): number {
  return Math.round((amount * (100 - discountPercent)) / 100);
}

export function calculatePricing(
  input: PricingRequest,
  priceBook: PricingConfig,
  promotion: PricingPromotionConfig | null,
  identity: QuoteIdentity = {},
): PricingQuote {
  const isERP = input.productMode === "NESTO_ERP";
  const fullCompanies = priceBook.nestoERP.includedCompanies + input.companies.additionalGroup + input.companies.jointVenture;
  const includedUsers = fullCompanies * priceBook.nestoERP.includedUsersPerFullCompany;
  const extraUsers = Math.max(0, input.activeUsers - includedUsers);
  const extraUserPacks = Math.ceil(extraUsers / priceBook.nestoERP.userPackSize);

  const basePlatformMonthlyCents = isERP ? priceBook.nestoERP.baseMonthlyCents : 0;
  const groupCompaniesMonthlyCents = input.companies.additionalGroup * priceBook.nestoERP.additionalGroupCompanyMonthlyCents;
  const jointVentureCompaniesMonthlyCents = input.companies.jointVenture * priceBook.nestoERP.additionalJVCompanyMonthlyCents;
  const documentsOnlyCompaniesMonthlyCents = input.companies.documentsOnly * priceBook.nestoERP.documentsOnlyCompanyMonthlyCents;
  const additionalProjectsMonthlyCents = isERP
    ? Math.max(0, input.activeProjects - priceBook.nestoERP.includedProjects) * priceBook.nestoERP.additionalProjectMonthlyCents
    : 0;
  const additionalUsersMonthlyCents = extraUserPacks * priceBook.nestoERP.userPackMonthlyCents;

  const termKey = input.contractMonths === 24 ? "monthly24Cents" : "monthly12Cents";
  const rozarisMonthlyCents =
    input.rozaris.basicProjects * priceBook.rozaris.projectTypes.basic[termKey]
    + input.rozaris.largeProjects * priceBook.rozaris.projectTypes.large[termKey]
    + input.rozaris.villageProjects * priceBook.rozaris.projectTypes.village[termKey];

  const nestoMonthlyCents = basePlatformMonthlyCents
    + groupCompaniesMonthlyCents
    + jointVentureCompaniesMonthlyCents
    + documentsOnlyCompaniesMonthlyCents
    + additionalProjectsMonthlyCents
    + additionalUsersMonthlyCents;
  const standardMonthlyCents = nestoMonthlyCents + rozarisMonthlyCents;

  const promotionApplies = Boolean(
    promotion
      && promotion.enabled
      && input.promotionCode === promotion.code
      && promotion.product === input.productMode
      && promotion.requiredContractMonths === input.contractMonths,
  );

  const scheduleCents: Array<{
    fromMonth: number;
    toMonth: number;
    nestoMonthlyCents: number;
    rozarisMonthlyCents: number;
    totalMonthlyCents: number;
    discountPercent: number;
  }> = [];

  let nextMonth = 1;
  if (promotionApplies && promotion) {
    for (const period of promotion.periods) {
      if (nextMonth > input.contractMonths) break;
      const toMonth = Math.min(input.contractMonths, nextMonth + period.months - 1);
      const promotionalNesto = discountedCents(nestoMonthlyCents, period.discountPercent);
      const promotionalRozaris = input.productMode === "ROZARIS_ONLY"
        ? discountedCents(rozarisMonthlyCents, period.discountPercent)
        : rozarisMonthlyCents;
      scheduleCents.push({
        fromMonth: nextMonth,
        toMonth,
        nestoMonthlyCents: promotionalNesto,
        rozarisMonthlyCents: promotionalRozaris,
        totalMonthlyCents: promotionalNesto + promotionalRozaris,
        discountPercent: period.discountPercent,
      });
      nextMonth = toMonth + 1;
    }
  }

  if (nextMonth <= input.contractMonths) {
    scheduleCents.push({
      fromMonth: nextMonth,
      toMonth: input.contractMonths,
      nestoMonthlyCents,
      rozarisMonthlyCents,
      totalMonthlyCents: standardMonthlyCents,
      discountPercent: 0,
    });
  }

  const contractValueCents = scheduleCents.reduce(
    (total, period) => total + period.totalMonthlyCents * (period.toMonth - period.fromMonth + 1),
    0,
  );

  return {
    quoteId: identity.quoteId ?? null,
    quoteReference: identity.quoteReference ?? null,
    pricingVersion: priceBook.version,
    currency: priceBook.currency,
    configuration: input,
    included: {
      fullCompanies,
      includedUsers,
      includedProjects: isERP ? priceBook.nestoERP.includedProjects : 0,
    },
    breakdown: {
      basePlatformMonthly: euros(basePlatformMonthlyCents),
      groupCompaniesMonthly: euros(groupCompaniesMonthlyCents),
      jointVentureCompaniesMonthly: euros(jointVentureCompaniesMonthlyCents),
      documentsOnlyCompaniesMonthly: euros(documentsOnlyCompaniesMonthlyCents),
      additionalProjectsMonthly: euros(additionalProjectsMonthlyCents),
      additionalUsersMonthly: euros(additionalUsersMonthlyCents),
      rozarisMonthly: euros(rozarisMonthlyCents),
    },
    users: {
      requested: input.activeUsers,
      included: includedUsers,
      extra: extraUsers,
      packs: extraUserPacks,
      packSize: priceBook.nestoERP.userPackSize,
    },
    nestoMonthly: euros(nestoMonthlyCents),
    standardMonthly: euros(standardMonthlyCents),
    promotionalSchedule: scheduleCents.map((period) => ({
      fromMonth: period.fromMonth,
      toMonth: period.toMonth,
      nestoMonthly: euros(period.nestoMonthlyCents),
      rozarisMonthly: euros(period.rozarisMonthlyCents),
      totalMonthly: euros(period.totalMonthlyCents),
      discountPercent: period.discountPercent,
    })),
    promotion: {
      requestedCode: input.promotionCode ?? null,
      appliedCode: promotionApplies && promotion ? promotion.code : null,
      applied: promotionApplies,
    },
    contract: { months: input.contractMonths, preIndexationValue: euros(contractValueCents) },
    exclusions: [...PRICING_EXCLUSIONS],
    indexation: {
      enabled: priceBook.indexation.enabled,
      appliesFromMonth: priceBook.indexation.firstAdjustmentMonth,
      source: priceBook.indexation.source,
      floorPercent: priceBook.indexation.floorPercent,
      capPercent: priceBook.indexation.capPercent,
      futureAdjustmentIncludedInEstimate: false,
    },
  };
}

export function hasRozarisProjects(input: PricingRequest): boolean {
  return input.rozaris.basicProjects + input.rozaris.largeProjects + input.rozaris.villageProjects > 0;
}
