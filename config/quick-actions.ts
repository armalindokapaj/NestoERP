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
  /** Further grants the destination checks, so the tile is never a door that refuses (AUD-05 §4). */
  alsoRequires?: Permission[];
};

/**
 * A dashboard tile for a create action takes its route, module and permission
 * from the Quick Create registry, so the two surfaces cannot drift apart (Quick
 * Create §126-§128). Only the tile's wording and icon are its own, and the
 * wording is the module page's own button: "New <noun>", except Documents'
 * established "Add document" (AUD-05 §4, UX-07; docs/ux/glossary.md).
 */
function fromQuickCreate(key: string, actionKey: string, label: string, icon: string): QuickActionDefinition {
  const action = QUICK_CREATE_BY_KEY.get(actionKey);
  if (!action) throw new Error(`Quick Create action ${actionKey} is not registered`);
  return { key, label, href: action.route, icon, module: action.moduleKey, permission: action.permission };
}

export const quickActions: Record<string, QuickActionDefinition> = {
  newProject: fromQuickCreate("newProject", "projects.project.create", "New project", "FolderKanban"),
  newTask: fromQuickCreate("newTask", "tasks.task.create", "New task", "ListChecks"),
  newClient: fromQuickCreate("newClient", "clients.client.create", "New client", "Users"),
  uploadDocument: fromQuickCreate("uploadDocument", "documents.document.create", "Add document", "Upload"),
  newInvoice: fromQuickCreate("newInvoice", "finance.invoice.create", "New invoice", "ReceiptText"),
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
    // The canonical create page is /contracts/new; /contracts/contracts/new never existed (AUD-05 §4, UX-09).
    href: "/contracts/new",
    icon: "Scale",
    module: "contracts",
    permission: "legal.contract.create",
  },
  newPurchaseRequest: fromQuickCreate("newPurchaseRequest", "procurement.purchase_request.create", "New purchase request", "ShoppingCart"),
  /*
   * Movements are a ledger written by receipts, issues, returns, transfers and
   * adjustments; /inventory/movements/new never existed, so the tile led
   * nowhere. Stock arriving is the everyday start (AUD-05 §4, UX-09).
   */
  newReceipt: {
    key: "newReceipt",
    label: "New receipt",
    href: "/inventory/receipts/new",
    icon: "PackageCheck",
    module: "inventory",
    permission: "inventory.receipt.create",
  },
  newQualityRecord: {
    key: "newQualityRecord",
    label: "New inspection",
    href: "/qaqc/inspections/new",
    icon: "ClipboardCheck",
    module: "qaqc",
    permission: "qaqc.inspection.create",
  },
  reportIncident: fromQuickCreate("reportIncident", "hse.incident.create", "Report an incident", "TriangleAlert"),
  /*
   * Reporting a hazard is one tap from wherever somebody is standing, on
   * purpose: a critical report form buried three levels down is a report that
   * gets made after the shift instead of during it (PRD #22 §336, §338).
   */
  reportHazard: {
    key: "reportHazard",
    label: "Report a hazard",
    href: "/hse/hazards/new",
    icon: "ShieldAlert",
    module: "hse",
    permission: "hse.hazard.create",
  },
  /*
   * The Team page's own "Invite member" at /team/invite, which needs both
   * grants; /team/new never existed (AUD-05 §4, UX-09). There is no support
   * request form in V0.1, so no tile offers one.
   */
  inviteUser: {
    key: "inviteUser",
    label: "Invite member",
    href: "/team/invite",
    icon: "UserPlus",
    module: "team",
    permission: "team.member.invite",
    alsoRequires: ["team.member.role.assign"],
  },
};

export const quickActionList: QuickActionDefinition[] = Object.values(quickActions);
