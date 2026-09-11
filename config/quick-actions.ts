/**
 * Quick actions (PRD #4 §22).
 *
 * Only actions the user may actually perform are offered. A Viewer sees none —
 * not a greyed-out row of them (PRD #4 §22, PRD #5 §32).
 */
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

export const quickActions: Record<string, QuickActionDefinition> = {
  newProject: {
    key: "newProject",
    label: "New project",
    href: "/projects/new",
    icon: "FolderKanban",
    module: "projects",
    permission: "project.create",
  },
  newTask: {
    key: "newTask",
    label: "New task",
    href: "/tasks/new",
    icon: "ListChecks",
    module: "tasks",
    permission: "task.create",
  },
  newClient: {
    key: "newClient",
    label: "Add client",
    href: "/clients/new",
    icon: "Users",
    module: "clients",
    permission: "client.create",
  },
  uploadDocument: {
    key: "uploadDocument",
    label: "Add document",
    href: "/documents/new",
    icon: "Upload",
    module: "documents",
    permission: "document.create",
  },
  newInvoice: {
    key: "newInvoice",
    label: "Create invoice",
    href: "/finance/invoices/new",
    icon: "ReceiptText",
    module: "finance",
    permission: "finance.invoice.create",
  },
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
  newOpportunity: {
    key: "newOpportunity",
    label: "New opportunity",
    href: "/sales/opportunities/new",
    icon: "Target",
    module: "sales",
    permission: "sales.opportunity.create",
  },
  newContract: {
    key: "newContract",
    label: "New contract",
    href: "/contracts/contracts/new",
    icon: "Scale",
    module: "contracts",
    permission: "legal.contract.create",
  },
  newPurchaseRequest: {
    key: "newPurchaseRequest",
    label: "Purchase request",
    href: "/procurement/requests/new",
    icon: "ShoppingCart",
    module: "procurement",
    permission: "procurement.request.create",
  },
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
    label: "New quality record",
    href: "/qaqc/inspections/new",
    icon: "ClipboardCheck",
    module: "qaqc",
    permission: "qaqc.record.create",
  },
  reportIncident: {
    key: "reportIncident",
    label: "Report incident",
    href: "/hse/incidents/new",
    icon: "TriangleAlert",
    module: "hse",
    permission: "hse.record.create",
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
