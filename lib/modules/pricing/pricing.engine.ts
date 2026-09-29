import { PRICING_EXCLUSIONS } from "./pricing.config";
import type { Foundation, PricingConfig, PricingModule, PricingPromotionConfig, PricingQuote, PricingRequest } from "./pricing.types";

/*
 * The modular pricing engine (Modular Pricing PRD §11-§28, §39-§41, §55).
 * Pure and integer-cents: the server runs it as the authority, the browser
 * runs the same code only for an optimistic estimate.
 */

type QuoteIdentity = { quoteId?: string | null; quoteReference?: string | null };

export function isIncluded(module: PricingModule, foundation: Foundation): boolean {
  return module.includedInFoundations.includes(foundation);
}

/** Selectable with this foundation: included in it, or given an add-on price by the price book. */
export function isOffered(module: PricingModule, foundation: Foundation): boolean {
  return module.enabled && (isIncluded(module, foundation) || module.monthlyPriceCents > 0);
}

/**
 * The modules the configuration really holds (§12-§14, §36): what the
 * foundation includes, what was chosen and is offered, and what those need.
 * A module absorbed by a larger one it came with is dropped, never charged
 * twice; a conflict keeps the later choice. Notices say what changed.
 */
export function resolveModules(config: PricingConfig, foundation: Foundation, requested: string[]) {
  const byId = new Map(config.modules.map((row) => [row.id, row]));
  const notices: string[] = [];
  const chosen = new Map<string, "FOUNDATION" | "SELECTED" | "DEPENDENCY">();
  for (const row of config.modules) if (row.enabled && isIncluded(row, foundation)) chosen.set(row.id, "FOUNDATION");
  for (const id of [...new Set(requested)]) {
    const row = byId.get(id);
    if (!row || !isOffered(row, foundation) || !row.public) { if (row) notices.push(`${row.name} is not available with this foundation and was removed.`); continue; }
    if (!chosen.has(id)) chosen.set(id, "SELECTED");
  }
  // Dependencies, transitively; a paid one is added visibly with a notice.
  const queue = [...chosen.keys()];
  while (queue.length) {
    const row = byId.get(queue.shift()!);
    for (const dependency of row?.dependencies ?? []) {
      const needed = byId.get(dependency);
      if (!needed || !needed.enabled || chosen.has(dependency)) continue;
      chosen.set(dependency, isIncluded(needed, foundation) ? "FOUNDATION" : "DEPENDENCY");
      if (!isIncluded(needed, foundation) && needed.monthlyPriceCents > 0) notices.push(`${needed.name} was added because ${row!.name} needs it.`);
      queue.push(dependency);
    }
  }
  for (const [id] of chosen) {
    const row = byId.get(id)!;
    for (const lighter of row.absorbs) {
      if (chosen.get(lighter) === "SELECTED" || chosen.get(lighter) === "DEPENDENCY") {
        chosen.delete(lighter);
        notices.push(`${byId.get(lighter)?.name ?? lighter} is included in ${row.name}.`);
      }
    }
    for (const conflict of row.conflicts) {
      if (chosen.has(conflict) && chosen.get(conflict) !== "FOUNDATION" && chosen.get(id) !== "FOUNDATION") {
        chosen.delete(conflict);
        notices.push(`${byId.get(conflict)?.name ?? conflict} cannot be combined with ${row.name} and was removed.`);
      }
    }
  }
  const rows = config.modules
    .filter((row) => chosen.has(row.id))
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((row) => {
      const reason = chosen.get(row.id)!;
      const included = reason === "FOUNDATION";
      return { id: row.id, name: row.name, public: row.public, included, locked: included && row.lockedWhenIncluded, monthlyCents: included ? 0 : row.monthlyPriceCents, reason };
    });
  return { rows, notices };
}

/** Normalises what a request may hold for its foundation (§36): compatible choices kept, the rest removed. */
export function normalizeRequest(input: PricingRequest, config: PricingConfig): PricingRequest {
  const companies = config.companies[input.foundation];
  const isRozaris = input.foundation === "ROZARIS";
  return {
    foundation: input.foundation,
    modules: resolveModules(config, input.foundation, input.modules).rows.filter((row) => row.reason === "SELECTED").map((row) => row.id),
    companies: companies.additionalAvailable ? { ...input.companies } : { fullGroup: 0, jointVenture: 0, documentsOnly: 0 },
    ...(isRozaris ? {} : { nestoProjects: { active: Math.max(config.nestoProjects.included, input.nestoProjects?.active ?? config.nestoProjects.included) } }),
    rozarisProjects: (input.rozarisProjects ?? []).map((project) => ({ tempId: project.tempId, type: project.type })),
    activeUsers: input.activeUsers,
    contractMonths: input.contractMonths,
    promotionCode: input.promotionCode ?? null,
  };
}

function discounted(amount: number, discountPercent: number): number {
  return Math.round((amount * (100 - discountPercent)) / 100);
}

export function calculatePricing(raw: PricingRequest, config: PricingConfig, promotion: PricingPromotionConfig | null, identity: QuoteIdentity = {}): PricingQuote {
  const input = normalizeRequest(raw, config);
  const foundation = config.foundations.find((row) => row.id === input.foundation)!;
  const termKey = input.contractMonths === 24 ? "monthly24Cents" : "monthly12Cents";
  const { rows: moduleRows, notices } = resolveModules(config, input.foundation, raw.modules);

  const companyRules = config.companies[input.foundation];
  const companiesMonthly = input.companies.fullGroup * companyRules.fullGroupMonthlyCents
    + input.companies.jointVenture * companyRules.jointVentureMonthlyCents
    + input.companies.documentsOnly * companyRules.documentsOnlyMonthlyCents;

  const projects: PricingQuote["projects"] = [];
  let nestoProjectsMonthly = 0;
  if (input.nestoProjects) {
    const extra = Math.max(0, input.nestoProjects.active - config.nestoProjects.included);
    nestoProjectsMonthly = extra * config.nestoProjects.additionalMonthlyCents;
    projects.push({ id: "nesto", label: `${input.nestoProjects.active} active ${input.nestoProjects.active === 1 ? "project" : "projects"}`, type: "NESTO", monthlyCents: nestoProjectsMonthly, includedUsers: 0 });
  }
  const rozarisProjects = input.rozarisProjects ?? [];
  rozarisProjects.forEach((project, index) => {
    const rate = config.rozaris.classes[project.type];
    projects.push({ id: project.tempId, label: `Project ${index + 1} · ROZARIS ${rate.name}`, type: project.type, monthlyCents: rate[termKey], includedUsers: rate.includedUsers });
  });
  const rozarisMonthly = rozarisProjects.reduce((sum, project) => sum + config.rozaris.classes[project.type][termKey], 0);

  // Included users: the foundation's, then what its companies add (§23-§25).
  const allowances = rozarisProjects.map((project) => config.rozaris.classes[project.type].includedUsers);
  const rozarisUsers = allowances.length === 0 ? 0
    : config.rozaris.userAllowanceMode === "SUM_PROJECTS" ? allowances.reduce((a, b) => a + b, 0)
    : config.rozaris.userAllowanceMode === "FIRST_PROJECT_ONLY" ? allowances[0]
    : Math.max(...allowances);
  const companyUsers = (input.companies.fullGroup + input.companies.jointVenture) * companyRules.includedUsersPerFullCompany;
  const includedUsers = (input.foundation === "ROZARIS" ? rozarisUsers : config.nestoIncludedUsers) + companyUsers;
  const rule = config.users.find((row) => row.foundation === input.foundation) ?? { packSize: 1, pricePerPackCents: 0 };
  const billable = Math.max(0, input.activeUsers - includedUsers);
  const packs = Math.ceil(billable / rule.packSize);
  const usersMonthly = packs * rule.pricePerPackCents;

  const modulesMonthly = moduleRows.reduce((sum, row) => sum + row.monthlyCents, 0);
  const nestoMonthly = foundation.baseMonthlyCents + modulesMonthly + companiesMonthly + nestoProjectsMonthly + usersMonthly;
  const standardMonthly = nestoMonthly + rozarisMonthly;

  const promotionApplies = Boolean(promotion && promotion.enabled && input.promotionCode === promotion.code && promotion.product === input.foundation && promotion.requiredContractMonths === input.contractMonths && nestoMonthly > 0);
  const schedule: PricingQuote["schedule"] = [];
  let next = 1;
  if (promotionApplies && promotion) {
    for (const period of promotion.periods) {
      if (next > input.contractMonths) break;
      const to = Math.min(input.contractMonths, next + period.months - 1);
      // ROZARIS project fees are billed in full from month 1 (§28).
      schedule.push({ fromMonth: next, toMonth: to, monthlyCents: discounted(nestoMonthly, period.discountPercent) + rozarisMonthly, discountPercent: period.discountPercent, label: period.discountPercent === 100 ? "NESTO charges free" : `${period.discountPercent}% off NESTO charges` });
      next = to + 1;
    }
  }
  if (next <= input.contractMonths) schedule.push({ fromMonth: next, toMonth: input.contractMonths, monthlyCents: standardMonthly, discountPercent: 0, label: "Standard price" });
  const contractValue = schedule.reduce((sum, period) => sum + period.monthlyCents * (period.toMonth - period.fromMonth + 1), 0);

  return {
    quoteId: identity.quoteId ?? null,
    quoteReference: identity.quoteReference ?? null,
    pricingVersion: config.version,
    currency: config.currency,
    normalizedConfiguration: input,
    foundation: { id: foundation.id, monthlyCents: foundation.baseMonthlyCents, label: foundation.name },
    modules: moduleRows.filter((row) => row.public).map(({ id, name, included, locked, monthlyCents, reason }) => ({ id, name, included, locked, monthlyCents, reason })),
    companies: { included: companyRules.included, ...input.companies, monthlyCents: companiesMonthly },
    projects,
    users: { requested: input.activeUsers, included: includedUsers, billable, packSize: rule.packSize, packs, monthlyCents: usersMonthly },
    nestoMonthlyCents: nestoMonthly,
    rozarisMonthlyCents: rozarisMonthly,
    standardMonthlyCents: standardMonthly,
    schedule,
    promotion: { requestedCode: input.promotionCode ?? null, appliedCode: promotionApplies && promotion ? promotion.code : null, applied: promotionApplies },
    contractMonths: input.contractMonths,
    preIndexationContractValueCents: contractValue,
    exclusions: [...PRICING_EXCLUSIONS],
    notices,
    indexation: { enabled: config.indexation.enabled, appliesFromMonth: config.indexation.firstAdjustmentMonth, source: config.indexation.source, floorPercent: config.indexation.floorPercent, capPercent: config.indexation.capPercent },
  };
}

export function hasRozarisProjects(input: Pick<PricingRequest, "rozarisProjects">): boolean {
  return (input.rozarisProjects?.length ?? 0) > 0;
}
