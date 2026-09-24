/**
 * Quality on Tirana Lake and Farka Residence (D-02 §38, §68, §77).
 *
 * D-01 left one closed inspection (the level 10 slab) and one open NCR (slab
 * edge cover). D-02 adds §38's examples in the product's own states: a
 * concrete cube test, the podium flood test, a façade alignment inspection that
 * failed and raised an NCR, an MEP pressure test waiting for approval, the show
 * apartment's tile inspection under way, the AHUs checked on delivery against
 * their goods receipt, and Block C's pre-pour inspection booked at Farka
 * Residence; NCRs open, in progress and closed, with their corrective actions
 * from open to verified; and the show apartment's snags.
 *
 * Numbers continue D-01's series in the product's shape (INS-2026-0113,
 * NCR-2026-0015). Every value is synthetic. Stable ids; a rerun adds nothing.
 */
import type { ChecklistItemResult, CorrectiveActionStatus, NCRCategory, NCRStatus, PrismaClient, QualityDefectStatus, QualityInspectionResult, QualityInspectionStatus, QualityInspectionType, QualitySeverity } from "@prisma/client";

import { addLocalDays, localDate } from "../../../lib/modules/calendar/calendar.time";
import { memberId } from "./access";
import { companyId } from "./organization";
import { projectId } from "./projects";
import type { CompanyCode, ProjectCode } from "./public-facts";
import { ARMAAR_GROUP_ID } from "./records";

const ZONE = "Europe/Tirane";
const BCI = "BUILDING_CONSTRUCTION_INVEST" as const;

/** Ids other files refer to (the daily log links the cube test). */
export const QUALITY = { cubeTest: "armaar_qa_ins_tl_0113" } as const;

const INSPECTIONS: Array<{ id: string; company: CompanyCode; project: ProjectCode; number: string; type: QualityInspectionType; title: string; inspector: string; approver: string; day: number; status: QualityInspectionStatus; result: QualityInspectionResult; checks: string[]; failed?: number[]; location: string; drawing?: string; spec?: string; goodsReceipt?: string }> = [
  { id: QUALITY.cubeTest, company: BCI, project: "TIRANA_LAKE", number: "INS-2026-0113", type: "WORK", title: "Concrete cube test — Tower A level 11 slab", inspector: "arlis.qaqc-engineer", approver: "bci.engineering", day: -8, status: "CLOSED", result: "PASS", checks: ["7-day cube strength at or above 70% of C35/45", "Slump within the mix design tolerance", "Cube sampling every 50 m³"], location: "Tower A — level 11", spec: "03 30 00 — Cast-in-place concrete" },
  { id: "armaar_qa_ins_tl_0114", company: BCI, project: "TIRANA_LAKE", number: "INS-2026-0114", type: "WORK", title: "Waterproofing inspection — podium roof flood test", inspector: "arlis.qaqc-engineer", approver: "bci.engineering", day: -50, status: "CLOSED", result: "PASS", checks: ["48-hour flood test without leaks", "Upstands at 150 mm and sealed into the reglet", "Outlets clamped and tested"], location: "Podium roof", drawing: "WPR-DET-701 Rev A" },
  { id: "armaar_qa_ins_tl_0115", company: BCI, project: "TIRANA_LAKE", number: "INS-2026-0115", type: "WORK", title: "Façade alignment inspection — Tower B levels 1 to 3", inspector: "arlis.qaqc-engineer", approver: "bci.engineering", day: -10, status: "CLOSED", result: "FAIL", checks: ["Mullion plumb within 2 mm per storey", "Bracket positions within ±5 mm", "Joint widths even along each floor"], failed: [1], location: "Tower B — east elevation, levels 1 to 3", drawing: "FAC-SD-210 Rev B" },
  { id: "armaar_qa_ins_tl_0116", company: BCI, project: "TIRANA_LAKE", number: "INS-2026-0116", type: "WORK", title: "MEP pressure test — Tower A risers, levels 1 to 6", inspector: "arlis.qaqc-engineer", approver: "bci.engineering", day: -2, status: "PENDING_APPROVAL", result: "PASS", checks: ["Hydraulic test at 1.5 × working pressure for two hours", "No visible leaks at joints", "Gauge certificate current"], location: "Tower A — risers R1 and R2", spec: "22 11 16 — Domestic water piping" },
  { id: "armaar_qa_ins_tl_0117", company: BCI, project: "TIRANA_LAKE", number: "INS-2026-0117", type: "WORK", title: "Tile finish inspection — show apartment, level 5", inspector: "arlis.qaqc-engineer", approver: "bci.architect", day: 0, status: "IN_PROGRESS", result: "NOT_SET", checks: ["Lippage within 1 mm", "Grout joints even and filled", "Falls to the shower drains"], location: "Tower A — level 5, show apartment" },
  { id: "armaar_qa_ins_tl_0118", company: BCI, project: "TIRANA_LAKE", number: "INS-2026-0118", type: "MATERIAL", title: "Material inspection — air handling units, first delivery", inspector: "arlis.qaqc-engineer", approver: "bci.engineering", day: -6, status: "CLOSED", result: "PASS", checks: ["Units match the approved submittal SUB-003", "No transport damage", "Data plates and test certificates supplied"], location: "Tirana Lake — goods-in", goodsReceipt: "armaar_grn_tl_ahu_0071" },
  { id: "armaar_qa_ins_fr_0021", company: "ARLIS_NDERTIM", project: "FARKA_RESIDENCE", number: "INS-2026-0021", type: "WORK", title: "Pre-pour inspection — Block C level 3 slab", inspector: "arlis.qaqc", approver: "arlis.engineering", day: 2, status: "DRAFT", result: "NOT_SET", checks: ["Reinforcement as drawn, with cover", "Formwork clean and propped", "Embedded services in place"], location: "Farka Residence — Block C, level 3" },
];

const NCRS: Array<{ id: string; number: string; title: string; description: string; category: NCRCategory; severity: QualitySeverity; status: NCRStatus; day: number; due: number; inspection?: string; owner: string; assignee: string; immediate?: string; rootCause?: string; closure?: string }> = [
  { id: "armaar_qa_ncr_tl_0015", number: "NCR-2026-0015", title: "Curtain-wall brackets out of position — Tower B level 2", description: "Four brackets on level 2 are 9 to 12 mm off their set-out, beyond the ±5 mm tolerance.", category: "WORKMANSHIP", severity: "MEDIUM", status: "IN_PROGRESS", day: -10, due: 4, inspection: "armaar_qa_ins_tl_0115", owner: "arlis.qaqc-engineer", assignee: "arlis.site-engineer", immediate: "No units hung on the four brackets until corrected.", rootCause: "Set-out taken from the slab edge instead of the gridline." },
  { id: "armaar_qa_ncr_tl_0016", number: "NCR-2026-0016", title: "Tile lippage above tolerance — show apartment bathroom", description: "Lippage up to 2.5 mm on the bathroom floor against 1 mm allowed.", category: "WORKMANSHIP", severity: "LOW", status: "OPEN", day: 0, due: 6, owner: "arlis.qaqc-engineer", assignee: "arlis.site-engineer" },
  { id: "armaar_qa_ncr_tl_0011", number: "NCR-2026-0011", title: "Honeycombing at podium column C3", description: "Honeycombing over 300 × 200 mm at the base of column C3 after striking.", category: "WORKMANSHIP", severity: "HIGH", status: "CLOSED", day: -70, due: -60, owner: "arlis.qaqc-engineer", assignee: "arlis.civil", immediate: "Column propped; loads held off until repaired.", rootCause: "Poor compaction at a congested base.", closure: "Repaired with the approved mortar; core test passed." },
];

const ACTIONS: Array<{ id: string; number: string; title: string; description: string; ncr?: string; assignee: string; status: CorrectiveActionStatus; day: number; due: number }> = [
  { id: "armaar_qa_ca_tl_0001", number: "CA-2026-0001", title: "Re-set the four level 2 brackets from the gridline", description: "Remove, re-drill and re-fix the four brackets from the gridline set-out; survey before hanging.", ncr: "armaar_qa_ncr_tl_0015", assignee: "arlis.site-engineer", status: "IN_PROGRESS", day: -9, due: 4 },
  { id: "armaar_qa_ca_tl_0002", number: "CA-2026-0002", title: "Re-survey the set-out on levels 3 to 6", description: "Check every bracket position above level 2 before the next lifts.", ncr: "armaar_qa_ncr_tl_0015", assignee: "arlis.civil", status: "PENDING_VERIFICATION", day: -9, due: -2 },
  { id: "armaar_qa_ca_tl_0003", number: "CA-2026-0003", title: "Repair honeycombing at column C3", description: "Break out, prime and repair with the approved mortar; core test.", ncr: "armaar_qa_ncr_tl_0011", assignee: "arlis.civil", status: "VERIFIED", day: -69, due: -62 },
  { id: "armaar_qa_ca_tl_0004", number: "CA-2026-0004", title: "Re-lay the show apartment bathroom floor", description: "Lift and re-lay the tiles above tolerance before the show apartment opens.", ncr: "armaar_qa_ncr_tl_0016", assignee: "arlis.site-engineer", status: "OPEN", day: 0, due: 6 },
];

const DEFECTS: Array<{ id: string; number: string; title: string; description: string; severity: QualitySeverity; status: QualityDefectStatus; day: number; due: number; location: string; resolution?: string }> = [
  { id: "armaar_qa_def_tl_0001", number: "DEF-2026-0001", title: "Scratched glazing — show apartment living room", description: "A 40 mm scratch on the inner pane of the sliding door.", severity: "LOW", status: "OPEN", day: -1, due: 8, location: "Tower A — level 5, show apartment living room" },
  { id: "armaar_qa_def_tl_0002", number: "DEF-2026-0002", title: "Kitchen worktop joint not sealed", description: "The joint at the corner of the kitchen worktop is open.", severity: "LOW", status: "RESOLVED", day: -4, due: 2, location: "Tower A — level 5, show apartment kitchen", resolution: "Joint sealed with colour-matched silicone." },
];

export async function seedArmaarQuality(prisma: PrismaClient) {
  const today = localDate(new Date(), ZONE);
  const day = (offset: number) => new Date(`${addLocalDays(today, offset)}T12:00:00.000Z`);
  const at = (offset: number, hour = 10) => new Date(`${addLocalDays(today, offset)}T${String(hour).padStart(2, "0")}:00:00.000Z`);
  const m = (username: string, code: CompanyCode = BCI) => memberId(username, code);
  const tl = projectId("TIRANA_LAKE");

  /* Inspections and their checklists (§38) ------------------------------------ */
  for (const inspection of INSPECTIONS) {
    const code = inspection.company;
    const inspector = m(inspection.inspector, code);
    const approver = m(inspection.approver, code);
    const executed = inspection.status !== "DRAFT";
    const decided = inspection.status === "CLOSED";
    const receiptItem = inspection.goodsReceipt ? `${inspection.goodsReceipt}_item_1` : null;
    await prisma.qualityInspection.upsert({
      where: { id: inspection.id },
      update: {},
      create: {
        id: inspection.id,
        companyId: companyId(code),
        inspectionNumber: inspection.number,
        inspectionType: inspection.type,
        projectId: projectId(inspection.project),
        goodsReceiptId: inspection.goodsReceipt ?? null,
        goodsReceiptItemId: receiptItem,
        assignedInspectorMemberId: inspector,
        executedByMemberId: executed ? inspector : null,
        status: inspection.status,
        result: inspection.result,
        inspectionDate: executed ? at(inspection.day, 9) : day(inspection.day),
        submittedAt: inspection.status === "PENDING_APPROVAL" || decided ? at(inspection.day, 14) : null,
        approvedAt: decided && inspection.result !== "FAIL" ? at(inspection.day + 1, 10) : null,
        approvedByMemberId: decided && inspection.result !== "FAIL" ? approver : null,
        rejectedAt: decided && inspection.result === "FAIL" ? at(inspection.day + 1, 10) : null,
        rejectedByMemberId: decided && inspection.result === "FAIL" ? approver : null,
        closedAt: decided ? at(inspection.day + 1, 11) : null,
        closedByMemberId: decided ? approver : null,
        locationText: inspection.location,
        drawingReference: inspection.drawing ?? null,
        specificationReference: inspection.spec ?? null,
        summary: executed ? `${inspection.title}.` : null,
        decisionNote: inspection.result === "FAIL" ? "Rejected: brackets out of tolerance; NCR raised." : null,
        createdByMemberId: inspector,
        createdAt: at(inspection.day - 2, 9),
      },
    });
    if ((await prisma.inspectionChecklistItem.count({ where: { inspectionId: inspection.id } })) === 0) {
      const answered = inspection.status === "CLOSED" || inspection.status === "PENDING_APPROVAL";
      await prisma.inspectionChecklistItem.createMany({
        data: inspection.checks.map((label, index) => {
          const result: ChecklistItemResult | null = answered ? (inspection.failed?.includes(index) ? "FAIL" : "PASS") : inspection.status === "IN_PROGRESS" && index === 0 ? "PASS" : null;
          return { id: `${inspection.id}_item_${index + 1}`, inspectionId: inspection.id, code: `Q${index + 1}`, label, responseType: "PASS_FAIL" as const, required: true, sortOrder: index, responseValue: result, result, note: result === "FAIL" ? "Measured and photographed; see the NCR." : null, requiresEvidenceOnFail: true };
        }),
      });
    }
    if (inspection.status === "PENDING_APPROVAL") {
      await prisma.qualityApproval.upsert({ where: { id: `${inspection.id}_approval` }, update: {}, create: { id: `${inspection.id}_approval`, companyId: companyId(code), recordType: "INSPECTION", recordId: inspection.id, status: "PENDING", submittedByMemberId: inspector, submittedAt: at(inspection.day, 14) } });
    }
  }

  /* Non-conformances (§38) ------------------------------------------------------ */
  for (const ncr of NCRS) {
    const closed = ncr.status === "CLOSED";
    await prisma.nonConformanceReport.upsert({
      where: { id: ncr.id },
      update: {},
      create: { id: ncr.id, companyId: companyId(BCI), ncrNumber: ncr.number, title: ncr.title, description: ncr.description, projectId: tl, inspectionId: ncr.inspection ?? null, category: ncr.category, severity: ncr.severity, status: ncr.status, assignedToMemberId: m(ncr.assignee), ownerMemberId: m(ncr.owner), immediateAction: ncr.immediate ?? null, rootCause: ncr.rootCause ?? null, dueDate: day(ncr.due), submittedAt: at(ncr.day, 15), approvedAt: closed ? at(ncr.due, 10) : null, approvedByMemberId: closed ? m("bci.engineering") : null, closedAt: closed ? at(ncr.due, 11) : null, closedByMemberId: closed ? m("bci.engineering") : null, closureNote: ncr.closure ?? null, createdByMemberId: m(ncr.owner), createdAt: at(ncr.day, 15) },
    });
  }

  /* Corrective actions (§38) ----------------------------------------------------- */
  for (const action of ACTIONS) {
    const done = action.status === "PENDING_VERIFICATION" || action.status === "VERIFIED";
    await prisma.correctiveAction.upsert({
      where: { id: action.id },
      update: {},
      create: { id: action.id, companyId: companyId(BCI), actionNumber: action.number, title: action.title, description: action.description, ncrId: action.ncr ?? null, projectId: tl, assignedToMemberId: m(action.assignee), dueDate: day(action.due), status: action.status, completionNote: done ? "Done; photos and survey filed." : null, completedAt: done ? at(action.due - 1, 16) : null, completedByMemberId: done ? m(action.assignee) : null, verificationNote: action.status === "VERIFIED" ? "Core test passed at 41 MPa." : null, verifiedAt: action.status === "VERIFIED" ? at(action.due, 10) : null, verifiedByMemberId: action.status === "VERIFIED" ? m("arlis.qaqc-engineer") : null, createdByMemberId: m("arlis.qaqc-engineer"), createdAt: at(action.day, 16) },
    });
  }

  /* Snags (§38) --------------------------------------------------------------------- */
  for (const defect of DEFECTS) {
    const resolved = defect.status === "RESOLVED";
    await prisma.qualityDefect.upsert({
      where: { id: defect.id },
      update: {},
      create: { id: defect.id, companyId: companyId(BCI), defectNumber: defect.number, title: defect.title, description: defect.description, projectId: tl, inspectionId: "armaar_qa_ins_tl_0117", severity: defect.severity, status: defect.status, locationText: defect.location, assignedToMemberId: m("arlis.site-engineer"), dueDate: day(defect.due), resolvedAt: resolved ? at(defect.due - 1, 15) : null, resolvedByMemberId: resolved ? m("arlis.site-engineer") : null, resolutionNote: defect.resolution ?? null, createdByMemberId: m("arlis.qaqc-engineer"), createdAt: at(defect.day, 11) },
    });
  }

  const inGroup = { company: { parentGroupId: ARMAAR_GROUP_ID } };
  return {
    inspections: await prisma.qualityInspection.count({ where: inGroup }),
    ncrs: await prisma.nonConformanceReport.count({ where: inGroup }),
    actions: await prisma.correctiveAction.count({ where: inGroup }),
    defects: await prisma.qualityDefect.count({ where: inGroup }),
  };
}
