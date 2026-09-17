import type { UserContext } from "@/lib/context/types";
import { approvalError, type ApprovalProvider } from "./approvals.provider";
import { PROVIDER_KEYS, type ApprovalProviderKey } from "./approvals.types";
import { documentReviewProvider } from "./providers/documents.provider";
import { financeApprovalProvider } from "./providers/finance.provider";
import { hrApprovalProvider } from "./providers/hr.provider";
import { hseApprovalProvider } from "./providers/hse.provider";
import { legalApprovalProvider } from "./providers/legal.provider";
import { procurementApprovalProvider } from "./providers/procurement.provider";
import { qaqcApprovalProvider } from "./providers/qaqc.provider";
import { salesApprovalProvider } from "./providers/sales.provider";
import { timesheetApprovalProvider } from "./providers/timesheets.provider";
import { projectsApprovalProvider } from "./providers/projects.provider";

/**
 * The approval provider registry (PRD #41 §10, §240).
 *
 * The allowlist of sources the Center reads. A provider key in a URL or a
 * request body is looked up here and nowhere else, so an unknown or disabled
 * key can never reach a module's table.
 */
export class ApprovalProviderRegistry {
  readonly #providers = new Map<ApprovalProviderKey, ApprovalProvider>();

  register(provider: ApprovalProvider): this {
    if (this.#providers.has(provider.key)) throw new Error(`Duplicate approval provider: ${provider.key}`);
    this.#providers.set(provider.key, provider);
    return this;
  }

  all(): ApprovalProvider[] {
    return [...this.#providers.values()];
  }

  /** A registered provider, or a not-found refusal for anything else (§240). */
  getProvider(key: string): ApprovalProvider {
    const provider = (PROVIDER_KEYS as readonly string[]).includes(key) ? this.#providers.get(key as ApprovalProviderKey) : undefined;
    if (!provider) throw approvalError("APPROVAL_PROVIDER_UNKNOWN", "There is no such approval source.", "NOT_FOUND");
    return provider;
  }

  /** Providers whose module is on for the company and open to this reader (§232). */
  getEnabledProviders(context: UserContext): ApprovalProvider[] {
    return this.all().filter((provider) => provider.available(context));
  }
}

export function createApprovalRegistry(providers: ApprovalProvider[]): ApprovalProviderRegistry {
  const registry = new ApprovalProviderRegistry();
  for (const provider of providers) registry.register(provider);
  return registry;
}

/** V0.1 sources (§8): the six required, plus QA/QC and HSE, which own explicit approval records, and Timesheets (PRD #42 §70). */
export const approvalProviders = createApprovalRegistry([
  financeApprovalProvider,
  procurementApprovalProvider,
  hrApprovalProvider,
  salesApprovalProvider,
  legalApprovalProvider,
  documentReviewProvider,
  qaqcApprovalProvider,
  hseApprovalProvider,
  timesheetApprovalProvider,
  // Unit publishing (E-05D §21, §47).
  projectsApprovalProvider,
]);
