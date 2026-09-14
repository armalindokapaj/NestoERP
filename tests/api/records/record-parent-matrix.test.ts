import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { UserContext } from "@/lib/context/types";
import { threadQuerySchema } from "@/lib/core/collaboration/collaboration.schema";
import { createComment, getThread, setWatching } from "@/lib/core/collaboration/collaboration.service";
import { openNotification } from "@/lib/core/notifications/notification.service";
import { loadRecord, recordDefinitions } from "@/lib/core/records/record.registry";
import type { RecordType } from "@/lib/core/records/record.types";
import { canAttachToDocumentParent } from "@/lib/modules/documents/document.parent-access";
import { cleanupSessions, loginAs, loginAsEmail, prisma } from "../../helpers";

/**
 * Parent matrices generated from the registry (PRD #38 §129, §145, §146).
 *
 * One seeded record per registered type, asked the same questions by three
 * readers: the Owner of the company it belongs to, the Owner of another
 * company, and the Viewer. Adding a record type to the registry adds it here —
 * which is the point: read and write rules can no longer drift apart per type.
 */

const COMPANY_A = "company_demo_a";

/** The Prisma model behind each registry type, and the column its id lives in. */
const SOURCE: Record<RecordType, { model: string; idField?: string }> = {
  project: { model: "project" },
  client: { model: "client" },
  task: { model: "task" },
  document: { model: "document" },
  invoice: { model: "invoice" },
  expense: { model: "expense" },
  budget: { model: "projectBudget" },
  commitment: { model: "commitment" },
  employee: { model: "employeeProfile", idField: "companyMemberId" },
  leave_request: { model: "leaveRequest" },
  lead: { model: "lead" },
  opportunity: { model: "opportunity" },
  proposal: { model: "proposal" },
  contract: { model: "contract" },
  amendment: { model: "contractAmendment" },
  obligation: { model: "contractObligation" },
  purchase_request: { model: "purchaseRequest" },
  rfq: { model: "rFQ" },
  purchase_order: { model: "purchaseOrder" },
  goods_receipt: { model: "goodsReceipt" },
  supplier: { model: "supplier" },
  inventory_item: { model: "inventoryItem" },
  warehouse: { model: "warehouse" },
  inventory_receipt: { model: "inventoryReceipt" },
  stock_issue: { model: "stockIssue" },
  stock_adjustment: { model: "stockAdjustment" },
  quality_inspection: { model: "qualityInspection" },
  quality_defect: { model: "qualityDefect" },
  non_conformance_report: { model: "nonConformanceReport" },
  corrective_action: { model: "correctiveAction" },
  hse_inspection: { model: "hseInspection" },
  hazard: { model: "hseHazard" },
  incident: { model: "hseIncident" },
  risk_assessment: { model: "hseRiskAssessment" },
  hse_action: { model: "hseAction" },
  toolbox_talk: { model: "toolboxTalk" },
  work_permit: { model: "hseWorkPermit" },
  environmental_observation: { model: "environmentalObservation" },
  stop_work: { model: "stopWorkRecord" },
  calendar_event: { model: "calendarEvent" },
  meeting: { model: "meeting" },
  timesheet: { model: "timesheet" },
  daily_log: { model: "dailyLog" },
  project_milestone: { model: "projectMilestone" },
  announcement: { model: "announcement" },
  approval_delegation: { model: "approvalDelegation" },
  contractor: { model: "contractorProfile" },
  work_package: { model: "workPackage" },
  contractor_compliance: { model: "contractorComplianceItem" },
  engineering_document: { model: "engineeringDocument" },
  rfi: { model: "rfi" },
  technical_submittal: { model: "technicalSubmittal" },
  transmittal: { model: "documentTransmittal" },
};

let owner: UserContext;
let ownerB: UserContext;
let viewer: UserContext;
/** A live (not archived) record per type, as the Owner reads it. */
const sample = new Map<RecordType, string>();

beforeAll(async () => {
  [owner, ownerB, viewer] = await Promise.all([loginAs("OWNER"), loginAsEmail("owner-b@nesto.test"), loginAs("VIEWER")]);

  for (const definition of recordDefinitions()) {
    const source = SOURCE[definition.type];
    const idField = source.idField ?? "id";
    const delegate = (prisma as unknown as Record<string, { findMany(args: unknown): Promise<Record<string, string>[]> }>)[source.model];
    const rows = await delegate.findMany({ where: { companyId: COMPANY_A }, select: { [idField]: true }, take: 25 });
    for (const row of rows) {
      const record = await loadRecord(owner, definition.type, row[idField]);
      if (record && !record.archived && !record.filesClosed) {
        sample.set(definition.type, row[idField]);
        break;
      }
    }
  }
});

afterAll(async () => {
  await cleanupSessions();
  await prisma.$disconnect();
});

describe("registry parent matrix", () => {
  it("has a live seeded record for every registered type", () => {
    const missing = recordDefinitions().map((row) => row.type).filter((type) => !sample.has(type));
    expect(missing).toEqual([]);
  });

  it("lets another company open none of them, and the Viewer none it has no module for", async () => {
    const leaks: string[] = [];
    for (const [type, id] of sample) {
      if (await loadRecord(ownerB, type, id)) leaks.push(`owner-b:${type}`);
      const definition = recordDefinitions().find((row) => row.type === type)!;
      const viewerModule = viewer.moduleAccess[definition.moduleKey];
      if (!viewerModule?.enabled || viewerModule.accessLevel === "NONE") {
        if (await loadRecord(viewer, type, id)) leaks.push(`viewer:${type}`);
      }
    }
    expect(leaks).toEqual([]);
  });
});

describe("collaboration parent matrix (PRD #38 §146)", () => {
  const collaborative = () => recordDefinitions().filter((row) => row.collaboration !== null);

  it("opens the thread for the owning company's Owner on every collaborative type", async () => {
    const failures: string[] = [];
    for (const definition of collaborative()) {
      const id = sample.get(definition.type)!;
      try {
        const thread = await getThread(owner, definition.type, id, threadQuerySchema.parse({}));
        expect(thread.parent.id).toBe(id);
      } catch (error) {
        failures.push(`${definition.type}: ${(error as Error).message}`);
      }
    }
    expect(failures).toEqual([]);
  });

  it("refuses another company's reader, commenter and watcher on every collaborative type, as not found", async () => {
    const opened: string[] = [];
    for (const definition of collaborative()) {
      const id = sample.get(definition.type)!;
      const attempts = [
        () => getThread(ownerB, definition.type, id, threadQuerySchema.parse({})),
        () => createComment(ownerB, definition.type, id, { body: "cross-company probe" }),
        () => setWatching(ownerB, definition.type, id, true),
      ];
      for (const [index, attempt] of attempts.entries()) {
        const outcome = await attempt().then(
          () => "allowed",
          (error: { code?: string }) => error.code ?? "error",
        );
        if (outcome !== "NOT_FOUND") opened.push(`${definition.type}#${index}:${outcome}`);
      }
    }
    expect(opened).toEqual([]);
  });

  it("has no discussion at all on types the registry closes", async () => {
    for (const definition of recordDefinitions().filter((row) => row.collaboration === null)) {
      const id = sample.get(definition.type)!;
      await expect(getThread(owner, definition.type, id, threadQuerySchema.parse({}))).rejects.toMatchObject({ code: "NOT_FOUND" });
    }
  });
});

describe("document parent matrix (PRD #38 §145)", () => {
  it("lets the Owner attach to every type that takes uploads, and nobody else's company or the Viewer", async () => {
    const wrong: string[] = [];
    for (const definition of recordDefinitions()) {
      if (!definition.documents || definition.type === "document") continue;
      const id = sample.get(definition.type)!;
      const ref = { projectId: null, clientId: null, module: definition.moduleKey, entityType: definition.type, entityId: id };
      const takesUploads = definition.documents.upload !== null;
      if ((await canAttachToDocumentParent(owner, ref)) !== takesUploads) wrong.push(`owner:${definition.type}`);
      if (await canAttachToDocumentParent(ownerB, ref)) wrong.push(`owner-b:${definition.type}`);
      if (await canAttachToDocumentParent(viewer, ref)) wrong.push(`viewer:${definition.type}`);
    }
    expect(wrong).toEqual([]);
  });
});

describe("notifications across companies (PRD #38 §129, §149)", () => {
  it("does not open, or even acknowledge, another company's notification", async () => {
    const row = await prisma.notification.create({
      data: {
        companyId: COMPANY_A,
        recipientMemberId: owner.membershipId,
        eventType: "TASK_ASSIGNED",
        category: "tasks",
        moduleKey: "tasks",
        title: "Cross-company probe",
        priority: "NORMAL",
        entityType: "task",
        entityId: sample.get("task")!,
        dedupeKey: `probe:${Date.now()}`,
      },
    });
    try {
      await expect(openNotification(ownerB, row.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
      expect((await prisma.notification.findUnique({ where: { id: row.id } }))!.readState).toBe("UNREAD");
    } finally {
      await prisma.notification.delete({ where: { id: row.id } });
    }
  });
});
