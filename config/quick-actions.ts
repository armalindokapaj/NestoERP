/**
 * Quick actions (PRD #4 §22).
 *
 * Only actions the user may actually perform are offered. A Viewer sees none —
 * not a greyed-out row of them (PRD #4 §22, PRD #5 §32).
 */
import { QUICK_CREATE_BY_KEY } from "./quick-create";
import type { ModuleKey } from "./modules";
import type { Permission } from "./permissions";

export type QuickActionDefinition = {
  key: string;
  label: string;
  href: string;
  /** lucide icon name. */
  icon: string;
  module: ModuleKey;
  permission: Permission;
};

/**
 * A dashboard tile for a create action takes its route, module and permission
 * from the Quick Create registry, so the two surfaces cannot drift apart (Quick
 * Create §126-§128). Only the tile's wording and icon are its own.
 */
function fromQuickCreate(key: string, actionKey: string, label: string, icon: string): QuickActionDefinition {
  const action = QUICK_CREATE_BY_KEY.get(actionKey);
  if (!action) throw new Error(`Quick Create action ${actionKey} is not registered`);
  return { key, label, href: action.route, icon, module: action.moduleKey, permission: action.permission };
}

export const quickActions: Record<string, QuickActionDefinition> = {
  newProject: fromQuickCreate("newProject", "projects.project.create", "New project", "FolderKanban"),
  newTask: fromQuickCreate("newTask", "tasks.task.create", "New task", "ListChecks"),
  newClient: fromQuickCreate("newClient", "clients.client.create", "Add client", "Users"),
  uploadDocument: fromQuickCreate("uploadDocument", "documents.document.create", "Add document", "Upload"),
  newInvoice: fromQuickCreate("newInvoice", "finance.invoice.create", "Create invoice", "ReceiptText"),
  requestLeave: {
    key: "requestLeave",
    label: "Request leave",
    href: "/hr/leave/new",
    icon: "Plane",
    module: "hr",
    permission: "hr.leave.create",
  },
  newLead: {
    key: "newLead",
    label: "New lead",
    href: "/sales/leads/new",
    icon: "UserPlus",
    module: "sales",
    permission: "sales.lead.create",
  },
  newOpportunity: fromQuickCreate("newOpportunity", "sales.opportunity.create", "New opportunity", "Target"),
  newContract: {
    key: "newContract",
    label: "New contract",
    href: "/contracts/contracts/new",
    icon: "Scale",
    module: "contracts",
    permission: "legal.contract.create",
  },
  newPurchaseRequest: fromQuickCreate("newPurchaseRequest", "procurement.purchase_request.create", "Purchase request", "ShoppingCart"),
  newMovement: {
    key: "newMovement",
    label: "Record movement",
    href: "/inventory/movements/new",
    icon: "ArrowLeftRight",
    module: "inventory",
    permission: "inventory.movement.create",
  },
  newQualityRecord: {
    key: "newQualityRecord",
    label: "New inspection",
    href: "/qaqc/inspections/new",
    icon: "ClipboardCheck",
    module: "qaqc",
    permission: "qaqc.inspection.create",
  },
  reportIncident: fromQuickCreate("reportIncident", "hse.incident.create", "Report incident", "TriangleAlert"),
  /*
   * Reporting a hazard is one tap from wherever somebody is standing, on
   * purpose: a critical report form buried three levels down is a report that
   * gets made after the shift instead of during it (PRD #22 §336, §338).
   */
  reportHazard: {
    key: "reportHazard",
    label: "Report hazard",
    href: "/hse/hazards/new",
    icon: "ShieldAlert",
    module: "hse",
    permission: "hse.hazard.create",
  },
  inviteUser: {
    key: "inviteUser",
    label: "Add team member",
    href: "/team/new",
    icon: "UserPlus",
    module: "team",
    permission: "team.manage",
  },
  newSupportRequest: {
    key: "newSupportRequest",
    label: "Raise a request",
    href: "/support/requests/new",
    icon: "LifeBuoy",
    module: "support",
    permission: "support.request.create",
  },
};

export const quickActionList: QuickActionDefinition[] = Object.values(quickActions);
