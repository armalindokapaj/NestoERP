/**
 * QA/QC fixtures (PRD #21 §342 and the DoD).
 *
 * The point of this seed is that **every state the module can be in is on
 * screen somewhere**: an inspection at each stage, a defect that has been
 * resolved but not yet closed, an NCR that cannot close because its corrective
 * action is unverified, and one that can.
 *
 *   templates    3, one per inspection type, with real checklists (§49)
 *   requests     6 across open, assigned, in progress and completed (§39)
 *   inspections  9 covering draft, in progress, pending approval, approved,
 *                rejected, closed — with results that match their checklists
 *   materials    a decision whose accepted + rejected + conditional balances
 *                exactly, and a release against it (§91, §98)
 *   defects      5 across the lifecycle, including one escalated to an NCR
 *   ncrs         4, one closed properly and one deliberately blocked (§136)
 *   actions      6, including one verified and one awaiting verification
 *
 * The seed is idempotent: everything is addressed by a deterministic id and
 * upserted, so re-running it converges rather than duplicating.
 */
import { Prisma, type PrismaClient } from "@prisma/client";

import { COMPANY_A, COMPANY_B, PROJECT_IDS, daysFromNow } from "./constants";
import { seedStoredDocument } from "./document-objects";

type Members = Map<string, string>;

const qty = (value: number) => new Prisma.Decimal(value.toFixed(4));

export async function seedQaqcRecords(prisma: PrismaClient, members: Members) {
  const qaqc = members.get("user_qaqc")!;
  const pm = members.get("user_pm")!;
  const engineer = members.get("user_engineer")!;
  const owner = members.get("user_owner")!;

  const templates = await seedTemplates(prisma, qaqc);
  const requests = await seedRequests(prisma, { qaqc, pm, engineer });
  const inspections = await seedInspections(prisma, { qaqc, pm, engineer, owner }, templates);
  await seedMaterialQuality(prisma, qaqc);
  const defects = await seedDefects(prisma, { qaqc, pm, engineer });
  const ncrs = await seedNcrs(prisma, { qaqc, pm, owner });
  const actions = await seedCorrectiveActions(prisma, { qaqc, pm, engineer });
  await seedApprovals(prisma, { qaqc, pm, owner });
  await seedQaqcDocuments(prisma);
  await seedCompanyBQaqc(prisma, members);

  return { templates, requests, inspections, defects, ncrs, actions };
}

/* -------------------------------------------------------------------------- */
/* Templates                                                                   */
/* -------------------------------------------------------------------------- */

type TemplateFixture = {
  id: string;
  code: string;
  name: string;
  type: "MATERIAL" | "WORK" | "GENERAL";
  items: {
    label: string;
    responseType: "PASS_FAIL" | "PASS_FAIL_NA" | "TEXT" | "NUMBER" | "BOOLEAN";
    required?: boolean;
    evidence?: boolean;
    criteria?: string;
  }[];
};

const TEMPLATES: TemplateFixture[] = [
  {
    id: "tpl_material",
    code: "MAT-IN",
    name: "Material goods-inwards check",
    type: "MATERIAL",
    items: [
      { label: "Delivery note matches the order", responseType: "PASS_FAIL" },
      { label: "Packaging undamaged", responseType: "PASS_FAIL", evidence: true },
      { label: "Batch or heat number recorded", responseType: "TEXT" },
      {
        label: "Test certificate supplied",
        responseType: "PASS_FAIL_NA",
        criteria: "EN 10204 3.1 or better where the specification calls for one",
      },
      { label: "Quantity counted", responseType: "NUMBER" },
      { label: "Stored in the right conditions", responseType: "PASS_FAIL" },
    ],
  },
  {
    id: "tpl_concrete",
    code: "WRK-CONC",
    name: "Concrete pour readiness",
    type: "WORK",
    items: [
      { label: "Formwork aligned and braced", responseType: "PASS_FAIL", evidence: true },
      { label: "Reinforcement as drawing", responseType: "PASS_FAIL", evidence: true },
      { label: "Cover to reinforcement", responseType: "NUMBER", criteria: "35mm minimum" },
      { label: "Shutters clean and oiled", responseType: "PASS_FAIL" },
      { label: "Embedded items in place", responseType: "PASS_FAIL_NA" },
      { label: "Access and safety clear", responseType: "PASS_FAIL" },
      { label: "Weather suitable to pour", responseType: "BOOLEAN" },
    ],
  },
  {
    id: "tpl_handover",
    code: "GEN-HAND",
    name: "Area handover check",
    type: "GENERAL",
    items: [
      { label: "Area clean and clear", responseType: "PASS_FAIL" },
      { label: "Finishes to specification", responseType: "PASS_FAIL", evidence: true },
      { label: "Services tested and commissioned", responseType: "PASS_FAIL_NA" },
      { label: "Outstanding snags listed", responseType: "TEXT" },
    ],
  },
];

async function seedTemplates(prisma: PrismaClient, createdBy: string): Promise<number> {
  for (const template of TEMPLATES) {
    await prisma.inspectionTemplate.upsert({
      where: { id: template.id },
      update: {},
      create: {
        id: template.id,
        companyId: COMPANY_A,
        code: template.code,
        name: template.name,
        inspectionType: template.type,
        status: "ACTIVE",
        version: 1,
        createdByMemberId: createdBy,
      },
    });

    for (const [index, item] of template.items.entries()) {
      await prisma.inspectionTemplateItem.upsert({
        where: { id: `${template.id}_item_${index + 1}` },
        update: {},
        create: {
          id: `${template.id}_item_${index + 1}`,
          inspectionTemplateId: template.id,
          label: item.label,
          responseType: item.responseType,
          required: item.required ?? true,
          sortOrder: index,
          passCriteriaText: item.criteria ?? null,
          requiresEvidenceOnFail: item.evidence ?? false,
        },
      });
    }
  }

  // An archived template, so the archive filter has something in it.
  await prisma.inspectionTemplate.upsert({
    where: { id: "tpl_retired" },
    update: {},
    create: {
      id: "tpl_retired",
      companyId: COMPANY_A,
      code: "WRK-OLD",
      name: "Superseded blockwork check",
      inspectionType: "WORK",
      status: "ARCHIVED",
      version: 1,
      archivedAt: daysFromNow(-40),
      createdByMemberId: createdBy,
    },
  });

  await prisma.inspectionTemplateItem.upsert({
    where: { id: "tpl_retired_item_1" },
    update: {},
    create: {
      id: "tpl_retired_item_1",
      inspectionTemplateId: "tpl_retired",
      label: "Blockwork courses level",
      responseType: "PASS_FAIL",
      sortOrder: 0,
    },
  });

  return TEMPLATES.length + 1;
}

/* -------------------------------------------------------------------------- */
/* Requests                                                                    */
/* -------------------------------------------------------------------------- */

async function seedRequests(
  prisma: PrismaClient,
  people: { qaqc: string; pm: string; engineer: string },
): Promise<number> {
  const fixtures: {
    id: string;
    number: string;
    title: string;
    type: "MATERIAL" | "WORK" | "GENERAL";
    project?: string;
    receipt?: string;
    status: "OPEN" | "ASSIGNED" | "IN_PROGRESS" | "COMPLETED" | "CANCELLED";
    priority: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
    inspector?: string;
    daysAgo: number;
    dueIn?: number;
    location?: string;
  }[] = [
    {
      id: "ir_001",
      number: "IR-2026-0001",
      title: "Rebar delivery for the raft",
      type: "MATERIAL",
      receipt: "receipt_001",
      status: "COMPLETED",
      priority: "HIGH",
      inspector: people.qaqc,
      daysAgo: 30,
      dueIn: -28,
    },
    {
      id: "ir_002",
      number: "IR-2026-0002",
      title: "Ground floor slab pour — east bay",
      type: "WORK",
      project: PROJECT_IDS.a,
      status: "COMPLETED",
      priority: "CRITICAL",
      inspector: people.qaqc,
      daysAgo: 22,
      dueIn: -21,
      location: "Block A, east bay",
    },
    {
      id: "ir_003",
      number: "IR-2026-0003",
      title: "Cement delivery check",
      type: "MATERIAL",
      receipt: "receipt_002",
      status: "IN_PROGRESS",
      priority: "MEDIUM",
      inspector: people.qaqc,
      daysAgo: 9,
      dueIn: 2,
    },
    {
      id: "ir_004",
      number: "IR-2026-0004",
      title: "Level 2 blockwork",
      type: "WORK",
      project: PROJECT_IDS.b,
      status: "ASSIGNED",
      priority: "MEDIUM",
      inspector: people.qaqc,
      daysAgo: 5,
      dueIn: 4,
      location: "Level 2, grid C–F",
    },
    {
      id: "ir_005",
      number: "IR-2026-0005",
      title: "Marina apartments — unit 12 handover",
      type: "GENERAL",
      project: PROJECT_IDS.c,
      status: "OPEN",
      priority: "LOW",
      daysAgo: 3,
      dueIn: 10,
      location: "Unit 12",
    },
    {
      id: "ir_006",
      number: "IR-2026-0006",
      title: "Waterproofing to the podium deck",
      type: "WORK",
      project: PROJECT_IDS.a,
      status: "OPEN",
      priority: "HIGH",
      daysAgo: 1,
      dueIn: -1,
      location: "Podium deck",
    },
  ];

  for (const fixture of fixtures) {
    await prisma.inspectionRequest.upsert({
      where: { id: fixture.id },
      update: {},
      create: {
        id: fixture.id,
        companyId: COMPANY_A,
        requestNumber: fixture.number,
        title: fixture.title,
        inspectionType: fixture.type,
        projectId: fixture.project ?? null,
        goodsReceiptId: fixture.receipt ?? null,
        requestedByMemberId: fixture.type === "MATERIAL" ? people.pm : people.engineer,
        assignedInspectorMemberId: fixture.inspector ?? null,
        requestedDate: daysFromNow(-fixture.daysAgo),
        requiredByDate: fixture.dueIn === undefined ? null : daysFromNow(fixture.dueIn),
        priority: fixture.priority,
        status: fixture.status,
        locationText: fixture.location ?? null,
        createdByMemberId: fixture.type === "MATERIAL" ? people.pm : people.engineer,
      },
    });
  }

  return fixtures.length;
}

/* -------------------------------------------------------------------------- */
/* Inspections                                                                 */
/* -------------------------------------------------------------------------- */

type InspectionFixture = {
  id: string;
  number: string;
  type: "MATERIAL" | "WORK" | "GENERAL";
  template: string;
  request?: string;
  project?: string;
  receipt?: string;
  status:
    | "DRAFT"
    | "IN_PROGRESS"
    | "PENDING_APPROVAL"
    | "APPROVED"
    | "REJECTED"
    | "CLOSED"
    | "CANCELLED";
  result: "NOT_SET" | "PASS" | "FAIL" | "CONDITIONAL";
  daysAgo: number;
  location?: string;
  summary?: string;
  decisionNote?: string;
  parent?: string;
  sequence?: number;
  /** Which checklist rows failed, by index. Everything else passes. */
  failures?: number[];
};

const INSPECTIONS: InspectionFixture[] = [
  {
    id: "ins_001",
    number: "INS-2026-0001",
    type: "MATERIAL",
    template: "tpl_material",
    request: "ir_001",
    receipt: "receipt_001",
    status: "CLOSED",
    result: "PASS",
    daysAgo: 29,
    summary: "Rebar delivery checked against the order and certificates.",
  },
  {
    id: "ins_002",
    number: "INS-2026-0002",
    type: "WORK",
    template: "tpl_concrete",
    request: "ir_002",
    project: PROJECT_IDS.a,
    status: "CLOSED",
    result: "FAIL",
    daysAgo: 21,
    location: "Block A, east bay",
    summary: "Cover to reinforcement short across the east bay.",
    decisionNote: "Failed. Defect raised against the rebar fixing.",
    failures: [1, 2],
  },
  {
    id: "ins_003",
    number: "INS-2026-0003",
    type: "WORK",
    template: "tpl_concrete",
    parent: "ins_002",
    sequence: 1,
    project: PROJECT_IDS.a,
    status: "CLOSED",
    result: "PASS",
    daysAgo: 17,
    location: "Block A, east bay",
    summary: "Re-checked after the fixing was corrected. Cover now compliant.",
  },
  {
    id: "ins_004",
    number: "INS-2026-0004",
    type: "MATERIAL",
    template: "tpl_material",
    request: "ir_003",
    receipt: "receipt_002",
    status: "APPROVED",
    result: "CONDITIONAL",
    daysAgo: 8,
    summary: "Cement delivery: two pallets damp-marked.",
    decisionNote:
      "Accepted on condition the damp-marked pallets are used within two weeks and not for structural pours.",
    failures: [1],
  },
  {
    id: "ins_005",
    number: "INS-2026-0005",
    type: "WORK",
    template: "tpl_concrete",
    project: PROJECT_IDS.b,
    status: "PENDING_APPROVAL",
    result: "FAIL",
    daysAgo: 4,
    location: "Level 2, grid C–F",
    summary: "Reinforcement spacing wrong at grid D.",
    failures: [1],
  },
  {
    id: "ins_006",
    number: "INS-2026-0006",
    type: "GENERAL",
    template: "tpl_handover",
    project: PROJECT_IDS.c,
    status: "PENDING_APPROVAL",
    result: "PASS",
    daysAgo: 3,
    location: "Unit 8",
    summary: "Unit 8 ready for handover.",
  },
  {
    id: "ins_007",
    number: "INS-2026-0007",
    type: "WORK",
    template: "tpl_concrete",
    project: PROJECT_IDS.a,
    status: "REJECTED",
    result: "PASS",
    daysAgo: 6,
    location: "Core walls, level 1",
    summary: "Core wall pour readiness.",
  },
  {
    id: "ins_008",
    number: "INS-2026-0008",
    type: "WORK",
    template: "tpl_concrete",
    request: "ir_004",
    project: PROJECT_IDS.b,
    status: "IN_PROGRESS",
    result: "NOT_SET",
    daysAgo: 1,
    location: "Level 2, grid C–F",
  },
  {
    id: "ins_009",
    number: "INS-2026-0009",
    type: "GENERAL",
    template: "tpl_handover",
    project: PROJECT_IDS.c,
    status: "DRAFT",
    result: "NOT_SET",
    daysAgo: 0,
    location: "Unit 12",
  },
];

async function seedInspections(
  prisma: PrismaClient,
  people: { qaqc: string; pm: string; engineer: string; owner: string },
  _templates: number,
): Promise<number> {
  for (const fixture of INSPECTIONS) {
    const template = TEMPLATES.find((row) => row.id === fixture.template)!;
    const decided = fixture.status === "APPROVED" || fixture.status === "CLOSED";

    await prisma.qualityInspection.upsert({
      where: { id: fixture.id },
      update: {},
      create: {
        id: fixture.id,
        companyId: COMPANY_A,
        inspectionNumber: fixture.number,
        inspectionType: fixture.type,
        requestId: fixture.request ?? null,
        templateId: fixture.template,
        templateVersion: 1,
        parentInspectionId: fixture.parent ?? null,
        reinspectionSequence: fixture.sequence ?? null,
        projectId: fixture.project ?? null,
        goodsReceiptId: fixture.receipt ?? null,
        assignedInspectorMemberId: people.qaqc,
        executedByMemberId: fixture.status === "DRAFT" ? null : people.qaqc,
        status: fixture.status,
        result: fixture.result,
        inspectionDate: fixture.status === "DRAFT" ? null : daysFromNow(-fixture.daysAgo),
        submittedAt:
          fixture.status === "DRAFT" || fixture.status === "IN_PROGRESS"
            ? null
            : daysFromNow(-fixture.daysAgo),
        approvedAt: decided ? daysFromNow(-fixture.daysAgo + 1) : null,
        approvedByMemberId: decided ? people.owner : null,
        rejectedAt: fixture.status === "REJECTED" ? daysFromNow(-fixture.daysAgo + 1) : null,
        rejectedByMemberId: fixture.status === "REJECTED" ? people.owner : null,
        closedAt: fixture.status === "CLOSED" ? daysFromNow(-fixture.daysAgo + 2) : null,
        closedByMemberId: fixture.status === "CLOSED" ? people.qaqc : null,
        locationText: fixture.location ?? null,
        summary: fixture.summary ?? null,
        decisionNote: fixture.decisionNote ?? null,
        createdByMemberId: people.qaqc,
      },
    });

    /*
     * The checklist is a snapshot of the template, and its answers agree with
     * the recorded result: an inspection that says FAIL has a failed row behind
     * it (PRD #21 §69, §77).
     */
    for (const [index, item] of template.items.entries()) {
      const answered = fixture.status !== "DRAFT";
      const failed = (fixture.failures ?? []).includes(index);
      const verdict = item.responseType === "PASS_FAIL" || item.responseType === "PASS_FAIL_NA";

      await prisma.inspectionChecklistItem.upsert({
        where: { id: `${fixture.id}_chk_${index + 1}` },
        update: {},
        create: {
          id: `${fixture.id}_chk_${index + 1}`,
          inspectionId: fixture.id,
          templateItemId: `${fixture.template}_item_${index + 1}`,
          label: item.label,
          responseType: item.responseType,
          required: item.required ?? true,
          sortOrder: index,
          passCriteriaText: item.criteria ?? null,
          requiresEvidenceOnFail: item.evidence ?? false,
          result: answered && verdict ? (failed ? "FAIL" : "PASS") : null,
          responseValue:
            answered && !verdict
              ? item.responseType === "NUMBER"
                ? failed
                  ? "28"
                  : "38"
                : item.responseType === "BOOLEAN"
                  ? "true"
                  : "Recorded on the delivery note"
              : null,
          note: failed ? "Below the stated criterion; see the summary." : null,
        },
      });
    }
  }

  return INSPECTIONS.length;
}

/* -------------------------------------------------------------------------- */
/* Material quality                                                            */
/* -------------------------------------------------------------------------- */

async function seedMaterialQuality(prisma: PrismaClient, qaqc: string) {
  // Addressed to whatever delivery lines the Procurement seed produced, so the
  // two seeds cannot drift apart.
  const lines = await prisma.goodsReceiptItem.findMany({
    where: { goodsReceipt: { is: { id: { in: ["receipt_001", "receipt_002"] } } } },
    select: { id: true, goodsReceiptId: true, receivedQuantity: true, purchaseOrderItem: { select: { unit: true } } },
    orderBy: { createdAt: "asc" },
  });

  const first = lines.find((row) => row.goodsReceiptId === "receipt_001");
  const second = lines.find((row) => row.goodsReceiptId === "receipt_002");

  if (first) {
    // A clean pass: everything inspected was accepted.
    const inspected = first.receivedQuantity;
    await prisma.materialInspectionDecision.upsert({
      where: {
        inspectionId_goodsReceiptItemId: {
          inspectionId: "ins_001",
          goodsReceiptItemId: first.id,
        },
      },
      update: {},
      create: {
        companyId: COMPANY_A,
        inspectionId: "ins_001",
        goodsReceiptItemId: first.id,
        inspectedQuantity: inspected,
        acceptedQuantity: inspected,
        rejectedQuantity: qty(0),
        conditionalQuantity: qty(0),
        unit: first.purchaseOrderItem.unit,
        notes: "Certificates checked against the heat numbers.",
      },
    });

    await prisma.qualityMaterialRelease.upsert({
      where: {
        inspectionId_goodsReceiptItemId: {
          inspectionId: "ins_001",
          goodsReceiptItemId: first.id,
        },
      },
      update: {},
      create: {
        companyId: COMPANY_A,
        inspectionId: "ins_001",
        goodsReceiptItemId: first.id,
        releasedQuantity: inspected,
        rejectedQuantity: qty(0),
        heldQuantity: qty(0),
        unit: first.purchaseOrderItem.unit,
        status: "RELEASED",
        releasedByMemberId: qaqc,
        releasedAt: daysFromNow(-28),
      },
    });
  }

  if (second) {
    /*
     * A conditional acceptance, split three ways. The three add back to the
     * inspected quantity exactly — which is the invariant the service enforces
     * and the tests assert (PRD #21 §91).
     */
    const inspected = second.receivedQuantity;
    const rejected = inspected.mul(new Prisma.Decimal("0.1")).toDecimalPlaces(4);
    const conditional = inspected.mul(new Prisma.Decimal("0.2")).toDecimalPlaces(4);
    const accepted = inspected.minus(rejected).minus(conditional);

    await prisma.materialInspectionDecision.upsert({
      where: {
        inspectionId_goodsReceiptItemId: {
          inspectionId: "ins_004",
          goodsReceiptItemId: second.id,
        },
      },
      update: {},
      create: {
        companyId: COMPANY_A,
        inspectionId: "ins_004",
        goodsReceiptItemId: second.id,
        inspectedQuantity: inspected,
        acceptedQuantity: accepted,
        rejectedQuantity: rejected,
        conditionalQuantity: conditional,
        unit: second.purchaseOrderItem.unit,
        notes: "Two pallets damp-marked; one pallet torn and refused.",
      },
    });
  }
}

/* -------------------------------------------------------------------------- */
/* Defects                                                                     */
/* -------------------------------------------------------------------------- */

async function seedDefects(
  prisma: PrismaClient,
  people: { qaqc: string; pm: string; engineer: string },
): Promise<number> {
  const fixtures: {
    id: string;
    number: string;
    title: string;
    description: string;
    project: string;
    inspection?: string;
    severity: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
    status: "OPEN" | "IN_PROGRESS" | "RESOLVED" | "CLOSED" | "REOPENED";
    daysAgo: number;
    dueIn?: number;
    location?: string;
    resolution?: string;
  }[] = [
    {
      id: "def_001",
      number: "DEF-2026-0001",
      title: "Cover to reinforcement short at the east bay",
      description:
        "Measured cover 28mm against a 35mm minimum across roughly six square metres of the east bay slab.",
      project: PROJECT_IDS.a,
      inspection: "ins_002",
      severity: "HIGH",
      status: "CLOSED",
      daysAgo: 21,
      dueIn: -18,
      location: "Block A, east bay",
      resolution: "Chairs replaced and spacing corrected; re-checked on INS-2026-0003.",
    },
    {
      id: "def_002",
      number: "DEF-2026-0002",
      title: "Reinforcement spacing wrong at grid D",
      description: "Bar centres at 250mm where the drawing calls for 200mm.",
      project: PROJECT_IDS.b,
      inspection: "ins_005",
      severity: "CRITICAL",
      status: "IN_PROGRESS",
      daysAgo: 4,
      dueIn: -1,
      location: "Level 2, grid D",
    },
    {
      id: "def_003",
      number: "DEF-2026-0003",
      title: "Paint finish patchy in the stair core",
      description: "Second coat uneven over about twelve square metres.",
      project: PROJECT_IDS.c,
      severity: "LOW",
      status: "RESOLVED",
      daysAgo: 12,
      dueIn: 3,
      location: "Stair core B",
      resolution: "Recoated on the 9th.",
    },
    {
      id: "def_004",
      number: "DEF-2026-0004",
      title: "Door frame out of plumb, unit 12",
      description: "Frame out by 9mm over the height.",
      project: PROJECT_IDS.c,
      severity: "MEDIUM",
      status: "OPEN",
      daysAgo: 2,
      dueIn: 7,
      location: "Unit 12, bedroom 1",
    },
    {
      id: "def_005",
      number: "DEF-2026-0005",
      title: "Waterproofing lap short at the podium upstand",
      description: "Membrane lap measured 45mm against a 100mm minimum.",
      project: PROJECT_IDS.a,
      severity: "HIGH",
      status: "REOPENED",
      daysAgo: 15,
      dueIn: -4,
      location: "Podium deck, north upstand",
      resolution: "First repair failed the water test.",
    },
  ];

  for (const fixture of fixtures) {
    const resolved = fixture.status === "RESOLVED" || fixture.status === "CLOSED";

    await prisma.qualityDefect.upsert({
      where: { id: fixture.id },
      update: {},
      create: {
        id: fixture.id,
        companyId: COMPANY_A,
        defectNumber: fixture.number,
        title: fixture.title,
        description: fixture.description,
        projectId: fixture.project,
        inspectionId: fixture.inspection ?? null,
        severity: fixture.severity,
        status: fixture.status,
        locationText: fixture.location ?? null,
        assignedToMemberId: people.engineer,
        dueDate: fixture.dueIn === undefined ? null : daysFromNow(fixture.dueIn),
        resolutionNote: fixture.resolution ?? null,
        // Resolved by the engineer, closed by somebody else — the two-pair-of-
        // eyes rule the service enforces (PRD #21 §119).
        resolvedAt: resolved || fixture.status === "REOPENED" ? daysFromNow(-fixture.daysAgo + 3) : null,
        resolvedByMemberId:
          resolved || fixture.status === "REOPENED" ? people.engineer : null,
        closedAt: fixture.status === "CLOSED" ? daysFromNow(-fixture.daysAgo + 4) : null,
        closedByMemberId: fixture.status === "CLOSED" ? people.qaqc : null,
        createdByMemberId: people.qaqc,
      },
    });
  }

  return fixtures.length;
}

/* -------------------------------------------------------------------------- */
/* NCRs                                                                        */
/* -------------------------------------------------------------------------- */

async function seedNcrs(
  prisma: PrismaClient,
  people: { qaqc: string; pm: string; owner: string },
): Promise<number> {
  const fixtures: {
    id: string;
    number: string;
    title: string;
    description: string;
    project?: string;
    inspection?: string;
    defect?: string;
    receipt?: string;
    category: "MATERIAL" | "WORKMANSHIP" | "DOCUMENTATION" | "PROCESS" | "SUPPLIER" | "DESIGN" | "OTHER";
    severity: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
    status:
      | "DRAFT"
      | "OPEN"
      | "IN_PROGRESS"
      | "PENDING_APPROVAL"
      | "APPROVED_FOR_CLOSE"
      | "CLOSED";
    daysAgo: number;
    dueIn?: number;
    immediate?: string;
    rootCause?: string;
    summary?: string;
    closure?: string;
  }[] = [
    {
      id: "ncr_001",
      number: "NCR-2026-0001",
      title: "Reinforcement cover not achieved on the east bay slab",
      description:
        "Cover measured 28mm against the specified 35mm minimum over roughly six square metres.",
      project: PROJECT_IDS.a,
      inspection: "ins_002",
      defect: "def_001",
      category: "WORKMANSHIP",
      severity: "HIGH",
      status: "CLOSED",
      daysAgo: 21,
      dueIn: -14,
      immediate: "Pour held. Area cordoned until the fixing was corrected.",
      rootCause:
        "Chairs of the wrong height were issued to the gang, and the fixing was not checked before the pre-pour inspection was requested.",
      summary: "Correct chairs issued and a pre-pour self-check added to the gang's routine.",
      closure:
        "Re-inspected on INS-2026-0003 and passed. Chair stock corrected and the self-check is in the method statement.",
    },
    {
      id: "ncr_002",
      number: "NCR-2026-0002",
      title: "Cement delivered damp-marked",
      description: "Two pallets showed water staining on arrival; one pallet was torn.",
      receipt: "receipt_002",
      inspection: "ins_004",
      category: "SUPPLIER",
      severity: "MEDIUM",
      status: "PENDING_APPROVAL",
      daysAgo: 8,
      dueIn: 4,
      immediate: "Torn pallet refused at the gate. Damp-marked pallets segregated.",
      rootCause:
        "Supplier's flatbed was sheeted late in the yard after loading in the rain.",
      summary: "Supplier to sheet before leaving the yard; checked on the next three deliveries.",
    },
    {
      id: "ncr_003",
      number: "NCR-2026-0003",
      title: "Reinforcement spacing wrong at grid D",
      description: "Bar centres at 250mm against a specified 200mm.",
      project: PROJECT_IDS.b,
      inspection: "ins_005",
      defect: "def_002",
      category: "WORKMANSHIP",
      severity: "CRITICAL",
      status: "IN_PROGRESS",
      daysAgo: 4,
      dueIn: -1,
      immediate: "Pour stopped at grid D.",
    },
    {
      id: "ncr_004",
      number: "NCR-2026-0004",
      title: "Test certificates missing for two steel heats",
      description: "Certificates 3.1 not supplied for heats 44219 and 44223.",
      category: "DOCUMENTATION",
      severity: "MEDIUM",
      status: "OPEN",
      daysAgo: 6,
      dueIn: 8,
    },
  ];

  for (const fixture of fixtures) {
    const decided = fixture.status === "APPROVED_FOR_CLOSE" || fixture.status === "CLOSED";

    await prisma.nonConformanceReport.upsert({
      where: { id: fixture.id },
      update: {},
      create: {
        id: fixture.id,
        companyId: COMPANY_A,
        ncrNumber: fixture.number,
        title: fixture.title,
        description: fixture.description,
        projectId: fixture.project ?? null,
        inspectionId: fixture.inspection ?? null,
        goodsReceiptId: fixture.receipt ?? null,
        sourceDefectId: fixture.defect ?? null,
        category: fixture.category,
        severity: fixture.severity,
        status: fixture.status,
        assignedToMemberId: people.pm,
        ownerMemberId: people.qaqc,
        immediateAction: fixture.immediate ?? null,
        rootCause: fixture.rootCause ?? null,
        correctiveActionSummary: fixture.summary ?? null,
        closureNote: fixture.closure ?? null,
        dueDate: fixture.dueIn === undefined ? null : daysFromNow(fixture.dueIn),
        submittedAt:
          fixture.status === "PENDING_APPROVAL" || decided
            ? daysFromNow(-fixture.daysAgo + 5)
            : null,
        approvedAt: decided ? daysFromNow(-fixture.daysAgo + 6) : null,
        approvedByMemberId: decided ? people.owner : null,
        closedAt: fixture.status === "CLOSED" ? daysFromNow(-fixture.daysAgo + 7) : null,
        closedByMemberId: fixture.status === "CLOSED" ? people.qaqc : null,
        createdByMemberId: people.qaqc,
      },
    });
  }

  return fixtures.length;
}

/* -------------------------------------------------------------------------- */
/* Corrective actions                                                          */
/* -------------------------------------------------------------------------- */

async function seedCorrectiveActions(
  prisma: PrismaClient,
  people: { qaqc: string; pm: string; engineer: string },
): Promise<number> {
  const fixtures: {
    id: string;
    number: string;
    title: string;
    description: string;
    ncr?: string;
    defect?: string;
    inspection?: string;
    project?: string;
    status: "OPEN" | "IN_PROGRESS" | "PENDING_VERIFICATION" | "VERIFIED" | "REJECTED";
    daysAgo: number;
    dueIn?: number;
    completion?: string;
    verification?: string;
  }[] = [
    {
      id: "ca_001",
      number: "CA-2026-0001",
      title: "Correct the chair stock and re-fix the east bay",
      description: "Withdraw the 25mm chairs, issue 35mm, and re-fix the affected area.",
      ncr: "ncr_001",
      project: PROJECT_IDS.a,
      status: "VERIFIED",
      daysAgo: 20,
      dueIn: -16,
      completion: "Chairs exchanged on the 22nd and the bay re-fixed the same day.",
      verification: "Checked against INS-2026-0003, which passed.",
    },
    {
      id: "ca_002",
      number: "CA-2026-0002",
      title: "Add a pre-pour self-check to the method statement",
      description:
        "The fixing gang checks cover before the inspection is requested, and records it.",
      ncr: "ncr_001",
      project: PROJECT_IDS.a,
      status: "VERIFIED",
      daysAgo: 19,
      dueIn: -12,
      completion: "Method statement revised to issue C and briefed to both gangs.",
      verification: "Revision C seen, briefing register signed.",
    },
    {
      id: "ca_003",
      number: "CA-2026-0003",
      title: "Supplier to sheet loads before leaving the yard",
      description: "Raise with the supplier and check the next three deliveries.",
      ncr: "ncr_002",
      status: "PENDING_VERIFICATION",
      daysAgo: 7,
      dueIn: 3,
      completion: "Raised with the supplier's depot manager; confirmed in writing on the 6th.",
    },
    {
      id: "ca_004",
      number: "CA-2026-0004",
      title: "Re-fix reinforcement at grid D to 200mm centres",
      description: "Strip, re-set and re-tie the affected bay.",
      ncr: "ncr_003",
      defect: "def_002",
      project: PROJECT_IDS.b,
      status: "IN_PROGRESS",
      daysAgo: 3,
      dueIn: -1,
    },
    {
      id: "ca_005",
      number: "CA-2026-0005",
      title: "Obtain the missing test certificates",
      description: "Chase the mill certificates for heats 44219 and 44223.",
      ncr: "ncr_004",
      status: "OPEN",
      daysAgo: 5,
      dueIn: 6,
    },
    {
      id: "ca_006",
      number: "CA-2026-0006",
      title: "Re-test the podium waterproofing lap",
      description: "Re-lap the north upstand and water-test the repair.",
      defect: "def_005",
      project: PROJECT_IDS.a,
      status: "REJECTED",
      daysAgo: 10,
      dueIn: -3,
      completion: "Repaired on the 4th.",
    },
  ];

  for (const fixture of fixtures) {
    const completed =
      fixture.status === "PENDING_VERIFICATION" ||
      fixture.status === "VERIFIED" ||
      fixture.status === "REJECTED";

    await prisma.correctiveAction.upsert({
      where: { id: fixture.id },
      update: {},
      create: {
        id: fixture.id,
        companyId: COMPANY_A,
        actionNumber: fixture.number,
        title: fixture.title,
        description: fixture.description,
        ncrId: fixture.ncr ?? null,
        defectId: fixture.defect ?? null,
        inspectionId: fixture.inspection ?? null,
        projectId: fixture.project ?? null,
        assignedToMemberId: people.engineer,
        dueDate: fixture.dueIn === undefined ? null : daysFromNow(fixture.dueIn),
        status: fixture.status,
        completionNote: fixture.completion ?? null,
        // Completed by the engineer, verified by somebody else — the rule the
        // service enforces (PRD #21 §147).
        completedAt: completed ? daysFromNow(-fixture.daysAgo + 2) : null,
        completedByMemberId: completed ? people.engineer : null,
        verificationNote: fixture.verification ?? null,
        verifiedAt: fixture.status === "VERIFIED" ? daysFromNow(-fixture.daysAgo + 3) : null,
        verifiedByMemberId: fixture.status === "VERIFIED" ? people.qaqc : null,
        createdByMemberId: people.qaqc,
      },
    });
  }

  return fixtures.length;
}

/* -------------------------------------------------------------------------- */
/* Approvals                                                                   */
/* -------------------------------------------------------------------------- */

async function seedApprovals(
  prisma: PrismaClient,
  people: { qaqc: string; pm: string; owner: string },
) {
  const fixtures: {
    id: string;
    type: "INSPECTION" | "NCR";
    record: string;
    status: "PENDING" | "APPROVED" | "REJECTED";
    submittedBy: string;
    daysAgo: number;
    note?: string;
  }[] = [
    // Pending, submitted by QA/QC — so the QA/QC account sees them in the queue
    // without a decision button, and the Owner sees them with one (§165).
    { id: "qa_appr_001", type: "INSPECTION", record: "ins_005", status: "PENDING", submittedBy: people.qaqc, daysAgo: 4 },
    { id: "qa_appr_002", type: "INSPECTION", record: "ins_006", status: "PENDING", submittedBy: people.qaqc, daysAgo: 3 },
    { id: "qa_appr_003", type: "NCR", record: "ncr_002", status: "PENDING", submittedBy: people.qaqc, daysAgo: 3 },
    { id: "qa_appr_004", type: "INSPECTION", record: "ins_002", status: "APPROVED", submittedBy: people.qaqc, daysAgo: 21 },
    { id: "qa_appr_005", type: "INSPECTION", record: "ins_004", status: "APPROVED", submittedBy: people.qaqc, daysAgo: 8 },
    {
      id: "qa_appr_006",
      type: "INSPECTION",
      record: "ins_007",
      status: "REJECTED",
      submittedBy: people.qaqc,
      daysAgo: 6,
      note: "Cover measurements not recorded. Re-check and resubmit.",
    },
    { id: "qa_appr_007", type: "NCR", record: "ncr_001", status: "APPROVED", submittedBy: people.qaqc, daysAgo: 15 },
  ];

  for (const fixture of fixtures) {
    await prisma.qualityApproval.upsert({
      where: { id: fixture.id },
      update: {},
      create: {
        id: fixture.id,
        companyId: COMPANY_A,
        recordType: fixture.type,
        recordId: fixture.record,
        status: fixture.status,
        submittedByMemberId: fixture.submittedBy,
        submittedAt: daysFromNow(-fixture.daysAgo),
        decidedByMemberId: fixture.status === "PENDING" ? null : people.owner,
        decidedAt: fixture.status === "PENDING" ? null : daysFromNow(-fixture.daysAgo + 1),
        decisionNote: fixture.note ?? null,
      },
    });
  }
}

/* -------------------------------------------------------------------------- */
/* Documents                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Evidence filed against quality records (PRD #21 §175–§182).
 *
 * Canonical Documents under `module: "qaqc"`, so the parent-access resolver is
 * exercised by real data: a reader who cannot open the inspection cannot open
 * the photograph of the failed check either.
 */
async function seedQaqcDocuments(prisma: PrismaClient) {
  const fixtures: { name: string; entityType: string; entityId: string }[] = [
    { name: "Cover survey — east bay.pdf", entityType: "quality_inspection", entityId: "ins_002" },
    { name: "Mill certificates heats 44210-44218.pdf", entityType: "quality_inspection", entityId: "ins_001" },
    { name: "Damp-marked pallets.jpg", entityType: "quality_inspection", entityId: "ins_004" },
    { name: "Cover measurements — east bay.pdf", entityType: "quality_defect", entityId: "def_001" },
    { name: "NCR-2026-0001 closure pack.pdf", entityType: "non_conformance_report", entityId: "ncr_001" },
    { name: "Supplier confirmation — sheeting.pdf", entityType: "non_conformance_report", entityId: "ncr_002" },
    { name: "Method statement rev C.pdf", entityType: "corrective_action", entityId: "ca_002" },
  ];

  const uploader = await prisma.companyMember.findFirst({
    where: { companyId: COMPANY_A, user: { email: "qaqc@nesto.test" } },
    select: { id: true },
  });

  for (const [index, document] of fixtures.entries()) {
    await seedStoredDocument(prisma, {
      id: `document_qaqc_${(index + 1).toString().padStart(2, "0")}`,
      companyId: COMPANY_A,
      name: document.name,
      module: "qaqc",
      entityType: document.entityType,
      entityId: document.entityId,
      uploadedByMemberId: uploader?.id ?? null,
      createdBy: "user_qaqc",
    });
  }
}

/* -------------------------------------------------------------------------- */
/* Company B                                                                   */
/* -------------------------------------------------------------------------- */

/** One record per kind, so every isolation test has something to fail against. */
async function seedCompanyBQaqc(prisma: PrismaClient, members: Members) {
  const ownerB = members.get("user_owner_b");
  if (!ownerB) return;

  await prisma.inspectionTemplate.upsert({
    where: { id: "tpl_b_001" },
    update: {},
    create: {
      id: "tpl_b_001",
      companyId: COMPANY_B,
      code: "B-GEN",
      name: "Company B template. Must never appear in a Company A result.",
      inspectionType: "GENERAL",
      status: "ACTIVE",
      version: 1,
      createdByMemberId: ownerB,
    },
  });

  await prisma.qualityInspection.upsert({
    where: { id: "ins_b_001" },
    update: {},
    create: {
      id: "ins_b_001",
      companyId: COMPANY_B,
      inspectionNumber: "INS-2026-B001",
      inspectionType: "GENERAL",
      assignedInspectorMemberId: ownerB,
      status: "CLOSED",
      result: "PASS",
      summary: "Company B inspection. Must never appear in a Company A result.",
      createdByMemberId: ownerB,
    },
  });

  await prisma.nonConformanceReport.upsert({
    where: { id: "ncr_b_001" },
    update: {},
    create: {
      id: "ncr_b_001",
      companyId: COMPANY_B,
      ncrNumber: "NCR-2026-B001",
      title: "Company B NCR. Must never appear in a Company A result.",
      description: "Isolation fixture.",
      category: "OTHER",
      severity: "LOW",
      status: "OPEN",
      createdByMemberId: ownerB,
    },
  });
}
