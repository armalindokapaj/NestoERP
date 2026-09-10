/**
 * Activity records (PRD #9 §64, §65).
 *
 * Spread across projects and department modules so that permission-aware
 * activity filtering can actually be tested: an Architect's feed must not carry
 * Finance or Project D activity (PRD #9 §172).
 */
import type { PrismaClient } from "@prisma/client";

import { COMPANY_A, PROJECT_IDS, daysFromNow } from "./constants";

type Members = Map<string, string>;

type ActivitySpec = {
  module: string;
  entityType: string;
  entityId: string;
  action: string;
  message: string;
  actor: string;
  daysAgo: number;
};

const ACTIVITIES: ActivitySpec[] = [
  { module: "projects", entityType: "Project", entityId: PROJECT_IDS.a, action: "PROJECT_CREATED", message: "created the project", actor: "user_pm", daysAgo: 120 },
  { module: "projects", entityType: "Project", entityId: PROJECT_IDS.a, action: "PROJECT_UPDATED", message: "updated the project schedule", actor: "user_pm", daysAgo: 40 },
  { module: "projects", entityType: "Project", entityId: PROJECT_IDS.a, action: "PROJECT_MEMBER_ADDED", message: "added Anna Rossi to the project", actor: "user_pm", daysAgo: 118 },
  { module: "projects", entityType: "Project", entityId: PROJECT_IDS.a, action: "PROJECT_MEMBER_ADDED", message: "added Ethan Cole to the project", actor: "user_pm", daysAgo: 117 },
  { module: "projects", entityType: "Project", entityId: PROJECT_IDS.a, action: "PROJECT_STATUS_CHANGED", message: "moved the project from Draft to Active", actor: "user_pm", daysAgo: 115 },
  { module: "tasks", entityType: "Task", entityId: "task_008", action: "TASK_COMPLETED", message: "completed “Close out concrete pour checklist”", actor: "user_qaqc", daysAgo: 12 },
  { module: "tasks", entityType: "Task", entityId: "task_003", action: "TASK_CREATED", message: "created “Review apartment layouts”", actor: "user_pm", daysAgo: 20 },
  { module: "tasks", entityType: "Task", entityId: "task_005", action: "TASK_UPDATED", message: "marked “Respond to design RFI 014” as blocked", actor: "user_architect", daysAgo: 6 },
  { module: "documents", entityType: "Document", entityId: "document_001", action: "DOCUMENT_UPLOADED", message: "added “Architectural Drawings.pdf”", actor: "user_architect", daysAgo: 18 },
  { module: "documents", entityType: "Document", entityId: "document_004", action: "DOCUMENT_UPLOADED", message: "added “Site Report — Week 32.pdf”", actor: "user_engineer", daysAgo: 4 },

  { module: "projects", entityType: "Project", entityId: PROJECT_IDS.b, action: "PROJECT_CREATED", message: "created the project", actor: "user_pm", daysAgo: 60 },
  { module: "projects", entityType: "Project", entityId: PROJECT_IDS.b, action: "PROJECT_UPDATED", message: "updated the project priority", actor: "user_pm", daysAgo: 22 },
  { module: "tasks", entityType: "Task", entityId: "task_017", action: "TASK_COMPLETED", message: "completed “Complete monthly safety walk”", actor: "user_hse", daysAgo: 5 },
  { module: "documents", entityType: "Document", entityId: "document_007", action: "DOCUMENT_UPLOADED", message: "added “Office Layout.pdf”", actor: "user_architect", daysAgo: 30 },
  { module: "procurement", entityType: "PurchaseRequest", entityId: "request_004", action: "REQUEST_SUBMITTED", message: "submitted “Curtain wall package” for approval", actor: "user_procurement", daysAgo: 3 },

  { module: "projects", entityType: "Project", entityId: PROJECT_IDS.c, action: "PROJECT_CREATED", message: "created the project", actor: "user_owner", daysAgo: 30 },
  { module: "tasks", entityType: "Task", entityId: "task_019", action: "TASK_CREATED", message: "created “Finalise facade package”", actor: "user_architect", daysAgo: 14 },
  { module: "documents", entityType: "Document", entityId: "document_010", action: "DOCUMENT_UPLOADED", message: "added “Marina Concept.pdf”", actor: "user_architect", daysAgo: 11 },
  { module: "projects", entityType: "Project", entityId: PROJECT_IDS.c, action: "PROJECT_MEMBER_ADDED", message: "added Anna Rossi to the project", actor: "user_owner", daysAgo: 29 },

  { module: "projects", entityType: "Project", entityId: PROJECT_IDS.d, action: "PROJECT_STATUS_CHANGED", message: "placed the project on hold", actor: "user_owner", daysAgo: 25 },
  { module: "tasks", entityType: "Task", entityId: "task_024", action: "TASK_UPDATED", message: "blocked “Technical issue response — yard drainage”", actor: "user_engineer", daysAgo: 15 },
  { module: "qaqc", entityType: "QualityRecord", entityId: "quality_010", action: "RECORD_CREATED", message: "raised NCR “Drainage fall out of specification”", actor: "user_qaqc", daysAgo: 9 },
  { module: "hse", entityType: "HseRecord", entityId: "hse_009", action: "RECORD_CREATED", message: "reported “Fuel spill in vehicle yard”", actor: "user_hse", daysAgo: 8 },
  { module: "hse", entityType: "HseRecord", entityId: "hse_005", action: "RECORD_CREATED", message: "raised corrective action “Install edge protection level 5”", actor: "user_hse", daysAgo: 7 },

  { module: "finance", entityType: "Invoice", entityId: "invoice_001", action: "INVOICE_CREATED", message: "raised INV-001", actor: "user_finance", daysAgo: 18 },
  { module: "finance", entityType: "Invoice", entityId: "invoice_002", action: "INVOICE_PAID", message: "recorded payment for INV-002", actor: "user_finance", daysAgo: 20 },
  { module: "finance", entityType: "Invoice", entityId: "invoice_003", action: "INVOICE_OVERDUE", message: "flagged INV-003 as overdue", actor: "user_finance", daysAgo: 14 },
  { module: "finance", entityType: "Invoice", entityId: "invoice_005", action: "INVOICE_APPROVED", message: "approved INV-005", actor: "user_ceo", daysAgo: 6 },
  { module: "finance", entityType: "Invoice", entityId: "invoice_009", action: "INVOICE_APPROVED", message: "approved INV-009", actor: "user_ceo", daysAgo: 2 },

  { module: "hr", entityType: "LeaveRequest", entityId: "leave_001", action: "LEAVE_REQUESTED", message: "requested annual leave", actor: "user_architect", daysAgo: 5 },
  { module: "hr", entityType: "LeaveRequest", entityId: "leave_003", action: "LEAVE_APPROVED", message: "approved sick leave for Ethan Cole", actor: "user_hr", daysAgo: 10 },
  { module: "hr", entityType: "CompanyMember", entityId: "member_engineer", action: "EMPLOYEE_UPDATED", message: "updated an employee record", actor: "user_hr", daysAgo: 16 },

  { module: "clients", entityType: "Client", entityId: "client_horizon", action: "CLIENT_CREATED", message: "added Horizon Estates", actor: "user_sales", daysAgo: 26 },
  { module: "clients", entityType: "Client", entityId: "client_nova", action: "CLIENT_UPDATED", message: "updated Nova Living", actor: "user_sales", daysAgo: 13 },
  { module: "sales", entityType: "Opportunity", entityId: "opportunity_006", action: "OPPORTUNITY_WON", message: "won “Urban Core plaza”", actor: "user_sales", daysAgo: 20 },
  { module: "sales", entityType: "Opportunity", entityId: "opportunity_001", action: "OPPORTUNITY_UPDATED", message: "moved “Riverside phase 2” to negotiation", actor: "user_sales", daysAgo: 4 },

  { module: "contracts", entityType: "Contract", entityId: "contract_003", action: "CONTRACT_SUBMITTED", message: "submitted CTR-003 for approval", actor: "user_legal", daysAgo: 7 },
  { module: "contracts", entityType: "Contract", entityId: "contract_004", action: "CONTRACT_EXPIRING", message: "flagged CTR-004 as expiring", actor: "user_legal", daysAgo: 1 },

  { module: "procurement", entityType: "PurchaseOrder", entityId: "order_002", action: "ORDER_DELIVERED", message: "recorded delivery for PO-002", actor: "user_procurement", daysAgo: 12 },
  { module: "inventory", entityType: "InventoryItem", entityId: "item_005", action: "STOCK_DEPLETED", message: "Interior Paint — White Matt reached zero stock", actor: "user_inventory", daysAgo: 3 },
  { module: "inventory", entityType: "InventoryMovement", entityId: "movement_001", action: "MOVEMENT_RECORDED", message: "recorded a stock movement", actor: "user_inventory", daysAgo: 1 },

  { module: "projects", entityType: "Project", entityId: PROJECT_IDS.archived, action: "RECORD_ARCHIVED", message: "archived the project", actor: "user_owner", daysAgo: 30 },
  { module: "documents", entityType: "Document", entityId: "document_023", action: "RECORD_ARCHIVED", message: "archived “Superseded Drawing Set.pdf”", actor: "user_architect", daysAgo: 35 },
  { module: "support", entityType: "SupportRequest", entityId: "support_001", action: "REQUEST_RESOLVED", message: "resolved “Password reset for site engineer”", actor: "user_it", daysAgo: 9 },
];

export async function seedActivities(prisma: PrismaClient, members: Members) {
  let index = 0;

  for (const activity of ACTIVITIES) {
    index += 1;
    const id = `activity_${index.toString().padStart(3, "0")}`;

    await prisma.activity.upsert({
      where: { id },
      update: {},
      create: {
        id,
        companyId: COMPANY_A,
        module: activity.module,
        entityType: activity.entityType,
        entityId: activity.entityId,
        action: activity.action,
        message: activity.message,
        actorMemberId: members.get(activity.actor) ?? null,
        actorUserId: activity.actor,
        createdAt: daysFromNow(-activity.daysAgo),
      },
    });
  }

  return index;
}
