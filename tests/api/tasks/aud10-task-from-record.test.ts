import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import type { UserContext } from "@/lib/context/types";
import { createTaskForObligation } from "@/lib/modules/contracts/obligations/obligation.service";
import { createTaskFromRecord } from "@/lib/modules/engineering/engineering.links";
import { ENGINEERING_SEED } from "../../../prisma/seed/engineering";
import { cleanupSessions, COMPANY, DEMO_EMAIL, loginAs, loginAsEmail, prisma, PROJECT } from "../../helpers";
import { expectRefusal, locker, orphanTaskHistory, raceBehindRow, removeTasks } from "./aud10-support";

/**
 * AUD-10 §3, §7 (CW-12, CW-13) for tasks raised from a contract obligation
 * and from an engineering record: one transaction, the source rechecked at the
 * commit boundary, forged cross-company ids refused before any write. The
 * obligation is the test's own, on Riverside's contract (prefix `aud10c_`).
 */

const CONTRACT = "contract_001"; // Aurelia, Riverside (PROJECT.a)
const OTHER_COMPANY_RFI = ENGINEERING_SEED.rfis.tower; // Meridian's Central Office Tower
const RFI = ENGINEERING_SEED.rfis.slabEdge; // Aurelia, Riverside

let legal: UserContext;
let engineer: UserContext;
let tenantOwner: UserContext;
let legalElsewhere: UserContext;
const obligations: string[] = [];

beforeAll(async () => {
  [legal, engineer, tenantOwner, legalElsewhere] = await Promise.all([loginAs("LEGAL"), loginAs("ENGINEER"), loginAsEmail(DEMO_EMAIL.tenantOwner), loginAsEmail("legal-manager-e@nesto.test")]);
});

afterEach(async () => {
  const raised = await prisma.task.findMany({ where: { OR: [{ entityType: "obligation", entityId: { in: obligations } }, { entityType: "rfi", entityId: { in: [RFI, OTHER_COMPANY_RFI] }, title: { startsWith: "aud10c" } }] }, select: { id: true } });
  await removeTasks(raised.map((row) => row.id));
  await prisma.activity.deleteMany({ where: { entityId: { in: obligations } } });
  await prisma.contractObligation.deleteMany({ where: { id: { in: obligations } } });
  obligations.length = 0;
});

afterAll(async () => {
  await cleanupSessions();
  await locker.$disconnect();
  await prisma.$disconnect();
});

async function obligation(): Promise<string> {
  const row = await prisma.contractObligation.create({
    data: { companyId: COMPANY.a, contractId: CONTRACT, title: "aud10c deliver the warranty", obligationType: "DELIVERABLE", responsibleMemberId: "member_legal", createdByMemberId: "member_legal", dueDate: new Date(Date.now() + 10 * 86_400_000) },
  });
  obligations.push(row.id);
  return row.id;
}

const raisedFor = (id: string) => prisma.task.count({ where: { entityType: "obligation", entityId: id } });

describe("a task from a contract obligation (CW-12, CW-13)", () => {
  it("raises the task on the contract's project, as a canonical Task", async () => {
    const id = await obligation();
    const { id: taskId } = await createTaskForObligation(legal, id, { title: "aud10c satisfy it" } as Parameters<typeof createTaskForObligation>[2]);
    expect(await prisma.task.findUniqueOrThrow({ where: { id: taskId } })).toMatchObject({ companyId: COMPANY.a, projectId: PROJECT.a, entityType: "obligation", entityId: id, module: "contracts", status: "TODO" });
    expect(await prisma.activity.count({ where: { entityId: taskId, action: "TASK_CREATED" } })).toBe(1);
  });

  it("gives no task to an obligation completed while the request waited for it", async () => {
    const id = await obligation();
    const since = new Date();
    const [outcome] = await raceBehindRow("contract_obligations", id, [() => createTaskForObligation(legal, id, { title: "aud10c too late" } as Parameters<typeof createTaskForObligation>[2])], async (tx) => {
      await tx.contractObligation.update({ where: { id }, data: { status: "COMPLETED", completedAt: new Date() } });
    });
    await expectRefusal(Promise.reject((outcome as { error: unknown }).error), "OBLIGATION_CLOSED");
    expect(await raisedFor(id)).toBe(0);
    expect(await orphanTaskHistory(since)).toBe(0);
    // Asked again afterwards, it is refused before anything is written.
    await expectRefusal(createTaskForObligation(legal, id, { title: "aud10c again" } as Parameters<typeof createTaskForObligation>[2]), "OBLIGATION_CLOSED");
  });

  it("refuses another company's legal team naming this company's obligation", async () => {
    const id = await obligation();
    // Legal in Adriatic (company e): the same grants, another company — the obligation does not exist for them.
    await expectRefusal(createTaskForObligation(legalElsewhere, id, { title: "aud10c foreign" } as Parameters<typeof createTaskForObligation>[2]), "NOT_FOUND");
    // A company without Legal at all is refused at the module.
    await expectRefusal(createTaskForObligation(tenantOwner, id, { title: "aud10c foreign" } as Parameters<typeof createTaskForObligation>[2]), "MODULE_UNAVAILABLE");
    expect(await raisedFor(id)).toBe(0);
  });
});

describe("a task from an engineering record (CW-13)", () => {
  it("files the task on the record's own project, and refuses a record of another company before writing", async () => {
    const since = new Date();
    await expectRefusal(createTaskFromRecord(engineer, "rfi", OTHER_COMPANY_RFI, { title: "aud10c foreign rfi", description: null, assigneeMemberId: engineer.membershipId, dueDate: null, priority: "MEDIUM" }), "RFI_NOT_FOUND");
    expect(await prisma.task.count({ where: { entityType: "rfi", entityId: OTHER_COMPANY_RFI, title: { startsWith: "aud10c" } } })).toBe(0);
    expect(await orphanTaskHistory(since)).toBe(0);

    const { taskId } = await createTaskFromRecord(engineer, "rfi", RFI, { title: "aud10c check on site", description: null, assigneeMemberId: engineer.membershipId, dueDate: null, priority: "MEDIUM" });
    expect(await prisma.task.findUniqueOrThrow({ where: { id: taskId } })).toMatchObject({ entityType: "rfi", entityId: RFI, projectId: PROJECT.a, companyId: COMPANY.a });
  });
});
