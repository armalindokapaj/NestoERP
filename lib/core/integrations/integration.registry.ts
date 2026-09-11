import type { IntegrationMode } from "@prisma/client";

/**
 * The integration registry (PRD #23 §14-§16).
 *
 * Every cross-module handoff NESTO supports is declared once, here. There is no
 * rule builder and no scripting: "workflow orchestration" in V0.1 means these
 * explicit, product-defined handoffs and nothing else (PRD #23 §199, §200).
 */

export const IntegrationType = {
  SALES_LEAD_CLIENT: "SALES_LEAD_CLIENT",
  SALES_OPPORTUNITY_PROJECT: "SALES_OPPORTUNITY_PROJECT",
  SALES_PROPOSAL_FINANCE_INVOICE: "SALES_PROPOSAL_FINANCE_INVOICE",
  SALES_PROPOSAL_LEGAL_CONTRACT: "SALES_PROPOSAL_LEGAL_CONTRACT",
  PROCUREMENT_PO_FINANCE_COMMITMENT: "PROCUREMENT_PO_FINANCE_COMMITMENT",
  PROCUREMENT_GOODS_RECEIPT_QA: "PROCUREMENT_GOODS_RECEIPT_QA",
  QA_RELEASE_INVENTORY_RECEIPT: "QA_RELEASE_INVENTORY_RECEIPT",
  PROCUREMENT_RECEIPT_INVENTORY_RECEIPT: "PROCUREMENT_RECEIPT_INVENTORY_RECEIPT",
  QA_ACTION_TASK: "QA_ACTION_TASK",
  HSE_ACTION_TASK: "HSE_ACTION_TASK",
} as const;

export type IntegrationTypeKey = (typeof IntegrationType)[keyof typeof IntegrationType];

export type IntegrationDefinition = {
  id: IntegrationTypeKey;
  mode: IntegrationMode;
  sourceModule: string;
  sourceEntityType: string;
  targetModule: string;
  targetEntityType: string;
  /** The permission the actor needs on the source record. */
  requiredSourcePermission: string;
  /** The permission the actor needs to create the target, when user-triggered. */
  requiredTargetPermission?: string;
  /** When true the target module must be enabled or the handoff is refused. */
  targetModuleRequired: boolean;
  /** Automatic handoffs run inside the source transition, not on a button. */
  automatic: boolean;
};

const DEFINITIONS: IntegrationDefinition[] = [
  {
    id: IntegrationType.SALES_LEAD_CLIENT,
    mode: "CREATE_FROM",
    sourceModule: "sales",
    sourceEntityType: "lead",
    targetModule: "clients",
    targetEntityType: "client",
    requiredSourcePermission: "sales.lead.convert",
    requiredTargetPermission: "client.create",
    targetModuleRequired: true,
    automatic: false,
  },
  {
    id: IntegrationType.SALES_OPPORTUNITY_PROJECT,
    mode: "CREATE_FROM",
    sourceModule: "sales",
    sourceEntityType: "opportunity",
    targetModule: "projects",
    targetEntityType: "project",
    requiredSourcePermission: "sales.opportunity.view",
    requiredTargetPermission: "project.create",
    targetModuleRequired: true,
    automatic: false,
  },
  {
    id: IntegrationType.SALES_PROPOSAL_FINANCE_INVOICE,
    mode: "CREATE_FROM",
    sourceModule: "sales",
    sourceEntityType: "proposal",
    targetModule: "finance",
    targetEntityType: "invoice",
    requiredSourcePermission: "sales.proposal.view",
    requiredTargetPermission: "finance.invoice.create",
    targetModuleRequired: true,
    automatic: false,
  },
  {
    id: IntegrationType.SALES_PROPOSAL_LEGAL_CONTRACT,
    mode: "CREATE_FROM",
    sourceModule: "sales",
    sourceEntityType: "proposal",
    targetModule: "contracts",
    targetEntityType: "contract",
    requiredSourcePermission: "sales.proposal.view",
    requiredTargetPermission: "contract.create",
    targetModuleRequired: true,
    automatic: false,
  },
  {
    // The one mandatory automatic handoff: approving a purchase order opens the
    // commitment, atomically, or the approval itself fails (PRD #23 §88, §271).
    id: IntegrationType.PROCUREMENT_PO_FINANCE_COMMITMENT,
    mode: "SYNCHRONIZE",
    sourceModule: "procurement",
    sourceEntityType: "purchase_order",
    targetModule: "finance",
    targetEntityType: "commitment",
    requiredSourcePermission: "procurement.order.approve",
    targetModuleRequired: false,
    automatic: true,
  },
  {
    id: IntegrationType.PROCUREMENT_GOODS_RECEIPT_QA,
    mode: "CREATE_FROM",
    sourceModule: "procurement",
    sourceEntityType: "goods_receipt",
    targetModule: "qaqc",
    targetEntityType: "inspection",
    requiredSourcePermission: "procurement.receipt.view",
    requiredTargetPermission: "qaqc.inspection.create",
    targetModuleRequired: true,
    automatic: false,
  },
  {
    id: IntegrationType.QA_RELEASE_INVENTORY_RECEIPT,
    mode: "CREATE_FROM",
    sourceModule: "qaqc",
    sourceEntityType: "material_release",
    targetModule: "inventory",
    targetEntityType: "inventory_receipt",
    requiredSourcePermission: "qaqc.release.view",
    requiredTargetPermission: "inventory.receipt.create",
    targetModuleRequired: true,
    automatic: false,
  },
  {
    id: IntegrationType.PROCUREMENT_RECEIPT_INVENTORY_RECEIPT,
    mode: "CREATE_FROM",
    sourceModule: "procurement",
    sourceEntityType: "goods_receipt",
    targetModule: "inventory",
    targetEntityType: "inventory_receipt",
    requiredSourcePermission: "procurement.receipt.view",
    requiredTargetPermission: "inventory.receipt.create",
    targetModuleRequired: true,
    automatic: false,
  },
  {
    id: IntegrationType.QA_ACTION_TASK,
    mode: "CREATE_FROM",
    sourceModule: "qaqc",
    sourceEntityType: "corrective_action",
    targetModule: "tasks",
    targetEntityType: "task",
    requiredSourcePermission: "qaqc.action.view",
    requiredTargetPermission: "task.create",
    targetModuleRequired: true,
    automatic: false,
  },
  {
    id: IntegrationType.HSE_ACTION_TASK,
    mode: "CREATE_FROM",
    sourceModule: "hse",
    sourceEntityType: "action",
    targetModule: "tasks",
    targetEntityType: "task",
    requiredSourcePermission: "hse.action.view",
    requiredTargetPermission: "task.create",
    targetModuleRequired: true,
    automatic: false,
  },
];

const BY_ID = new Map<string, IntegrationDefinition>();
for (const definition of DEFINITIONS) {
  if (BY_ID.has(definition.id)) throw new Error(`Duplicate integration: ${definition.id}`);
  BY_ID.set(definition.id, definition);
}

export function findIntegration(id: string): IntegrationDefinition | undefined {
  return BY_ID.get(id);
}

export function integrationDefinitions(): IntegrationDefinition[] {
  return [...DEFINITIONS];
}

/** `{companyId}:{integrationType}:{sourceEntityId}` (PRD #23 §233). */
export function buildIdempotencyKey(
  companyId: string,
  integrationType: string,
  sourceEntityId: string,
): string {
  return `${companyId}:${integrationType}:${sourceEntityId}`;
}
