/**
 * ARMAAR's task list, deepened (D-02 §31, §63, §75).
 *
 * D-01's twenty-eight tasks are the headline ones. D-02 adds the ordinary work
 * that sits behind the records the rest of the seed writes — review a shop
 * drawing, answer an RFI, verify a delivery, inspect the waterproofing, renew
 * an insurance, approve a request — across the working companies, in the
 * product's own states only (TODO, IN_PROGRESS, BLOCKED, COMPLETED; no E-07
 * state). A task raised from a record names it (`module`, `entityType`,
 * `entityId`), as the product records a task opened from a record.
 *
 * Databases seeded before D-02 carry D-01 texts that quote the old three-digit
 * numbers and an RFI that did not exist; those rows are corrected where they
 * still say what D-01 wrote, and nothing a person changed is touched.
 * Every value is synthetic. Stable ids; a rerun adds nothing.
 */
import type { PrismaClient, TaskPriority, TaskStatus } from "@prisma/client";

import { addLocalDays, localDate } from "../../../lib/modules/calendar/calendar.time";
import { memberId } from "./access";
import { companyId } from "./organization";
import { userId } from "./people";
import { projectId } from "./projects";
import type { CompanyCode, ProjectCode } from "./public-facts";
import { ARMAAR_GROUP_ID } from "./records";

const ZONE = "Europe/Tirane";
const BCI = "BUILDING_CONSTRUCTION_INVEST" as const;

type Link = { module: string; entityType: string; entityId: string };
const rfi = (number: string): Link => ({ module: "engineering", entityType: "rfi", entityId: `armaar_rfi_tl_${number}` });
const submittal = (number: string): Link => ({ module: "engineering", entityType: "technical_submittal", entityId: `armaar_sub_tl_${number}` });

const TASKS: Array<{ title: string; project: ProjectCode | null; company: CompanyCode; assignee: string; creator: string; status: TaskStatus; priority: TaskPriority; due: number; description?: string; blocked?: string; link?: Link }> = [
  /* Tirana Lake — engineering and the contractors -------------------------------- */
  { title: "Review façade shop drawing FAC-SD-210 Rev C", project: "TIRANA_LAKE", company: BCI, assignee: "unico.architect", creator: "bci.pm", status: "IN_PROGRESS", priority: "HIGH", due: 3, link: { module: "engineering", entityType: "engineering_document", entityId: "armaar_engdoc_fac_sd_210" } },
  { title: "Resolve MEP clash — riser shaft at Tower A level 7 (RFI-002)", project: "TIRANA_LAKE", company: BCI, assignee: "bci.engineering", creator: "arlis.mep", status: "IN_PROGRESS", priority: "CRITICAL", due: -1, link: rfi("002") },
  { title: "Review contractor submittal SUB-003 — air handling units", project: "TIRANA_LAKE", company: BCI, assignee: "bci.engineering", creator: "bci.pm", status: "IN_PROGRESS", priority: "HIGH", due: 2, link: submittal("003") },
  { title: "Review contractor submittal SUB-011 — tile samples", project: "TIRANA_LAKE", company: BCI, assignee: "bci.architect", creator: "bci.pm", status: "TODO", priority: "MEDIUM", due: 1, link: submittal("011") },
  { title: "Resubmit the fire-stopping data at 120 minutes (SUB-009)", project: "TIRANA_LAKE", company: BCI, assignee: "arlis.mep", creator: "bci.engineering", status: "TODO", priority: "HIGH", due: 5, link: submittal("009") },
  { title: "Agree the lift pit depth with the structural engineer (RFI-010)", project: "TIRANA_LAKE", company: BCI, assignee: "arlis.civil", creator: "arlis.mep", status: "TODO", priority: "MEDIUM", due: 9, link: rfi("010") },
  { title: "Answer the drainage-falls question on the podium terraces (RFI-008)", project: "TIRANA_LAKE", company: BCI, assignee: "bci.architect", creator: "arlis.site-engineer", status: "TODO", priority: "MEDIUM", due: 6, link: rfi("008") },
  { title: "Issue the waterproofing details for construction (TRN-006)", project: "TIRANA_LAKE", company: BCI, assignee: "bci.engineering", creator: "bci.pm", status: "TODO", priority: "MEDIUM", due: 2, link: { module: "engineering", entityType: "transmittal", entityId: "armaar_trn_tl_006" } },
  { title: "Approve concrete supplier — podium infill strips", project: "TIRANA_LAKE", company: BCI, assignee: "bci.procurement", creator: "bci.pm", status: "COMPLETED", priority: "MEDIUM", due: -20 },
  { title: "Verify delivery GRN-2026-0071 — AHUs 1 to 3 against PO-2026-0044", project: "TIRANA_LAKE", company: BCI, assignee: "arlis.inventory", creator: "bci.procurement", status: "TODO", priority: "HIGH", due: 1, link: { module: "procurement", entityType: "goods_receipt", entityId: "armaar_grn_tl_ahu_0071" } },
  { title: "Inspect waterproofing — podium roof flood test", project: "TIRANA_LAKE", company: BCI, assignee: "arlis.qaqc-engineer", creator: "bci.engineering", status: "COMPLETED", priority: "HIGH", due: -50 },
  { title: "Inspect waterproofing — Tower A basement wet areas", project: "TIRANA_LAKE", company: BCI, assignee: "arlis.qaqc-engineer", creator: "bci.engineering", status: "TODO", priority: "MEDIUM", due: 6 },
  { title: "Mobilise the plumbing contractor to Tower B", project: "TIRANA_LAKE", company: BCI, assignee: "arlis.pm", creator: "bci.pm", status: "COMPLETED", priority: "MEDIUM", due: -30 },
  { title: "Renew AquaTek's all-risk insurance before it lapses", project: "TIRANA_LAKE", company: BCI, assignee: "bci.legal", creator: "bci.pm", status: "TODO", priority: "HIGH", due: 12, link: { module: "contractors", entityType: "contractor_compliance", entityId: "armaar_cci_aquatek_1" } },
  { title: "Evaluate the landscaping tender — Gjelbër Landscape", project: "TIRANA_LAKE", company: BCI, assignee: "bci.architect", creator: "bci.pm-lead", status: "IN_PROGRESS", priority: "MEDIUM", due: 20, link: { module: "contractors", entityType: "contractor", entityId: "armaar_ctr_profile_gjelber" } },
  { title: "Re-quote the balcony balustrades in laminated glass (PR-2026-0064)", project: "TIRANA_LAKE", company: BCI, assignee: "bci.procurement", creator: "bci.architect", status: "IN_PROGRESS", priority: "MEDIUM", due: 5, link: { module: "procurement", entityType: "purchase_request", entityId: "armaar_pr_tl_glass" } },
  { title: "Raise the order for the apartment entrance doors", project: "TIRANA_LAKE", company: BCI, assignee: "bci.procurement", creator: "bci.pm", status: "TODO", priority: "MEDIUM", due: 7 },
  { title: "Weekly progress photos — Tower B façade", project: "TIRANA_LAKE", company: BCI, assignee: "arlis.site-engineer", creator: "arlis.pm", status: "TODO", priority: "LOW", due: 0 },
  { title: "Renew the tower crane inspection certificate", project: "TIRANA_LAKE", company: BCI, assignee: "arlis.hse", creator: "arlis.pm", status: "BLOCKED", priority: "HIGH", due: -2, blocked: "Waiting for the lifting inspector's visit, booked for Thursday." },
  { title: "Hand over MEP first fix — Tower A levels 5 to 8 — to finishing", project: "TIRANA_LAKE", company: BCI, assignee: "arlis.mep", creator: "arlis.pm", status: "IN_PROGRESS", priority: "MEDIUM", due: 14 },
  { title: "Snag list — Tower A show floor", project: "TIRANA_LAKE", company: BCI, assignee: "bci.architect", creator: "bci.pm-lead", status: "TODO", priority: "MEDIUM", due: 8 },
  { title: "Prepare the sale contract for the reserved 3+1 on level 7", project: "TIRANA_LAKE", company: BCI, assignee: "bci.legal", creator: "bci.sales", status: "TODO", priority: "MEDIUM", due: 4 },
  { title: "Update unit statuses after the price-list revision", project: "TIRANA_LAKE", company: BCI, assignee: "bci.sales-agent2", creator: "bci.sales", status: "TODO", priority: "LOW", due: 2 },

  /* United Towers ---------------------------------------------------------------- */
  { title: "Issue PO-2026-0045 to the geotechnical consultant", project: "UNITED_TOWERS", company: BCI, assignee: "bci.procurement", creator: "bci.pm-lead", status: "TODO", priority: "HIGH", due: 3, link: { module: "procurement", entityType: "purchase_order", entityId: "armaar_po_ut_geotech" } },
  { title: "Planning application drawings — United Towers", project: "UNITED_TOWERS", company: BCI, assignee: "unico.architect", creator: "bci.pm-lead", status: "IN_PROGRESS", priority: "MEDIUM", due: 30 },

  /* The other working companies ------------------------------------------------- */
  { title: "Approve the lift order PO-2026-0003", project: "GRAN_MELIA", company: "SARANDA_MARINA_INVEST", assignee: "smi.director", creator: "smi.pm", status: "TODO", priority: "HIGH", due: 2, link: { module: "procurement", entityType: "purchase_order", entityId: "armaar_po_gm_lifts" } },
  { title: "Hotel room mock-up review", project: "GRAN_MELIA", company: "SARANDA_MARINA_INVEST", assignee: "smi.architect", creator: "smi.pm", status: "TODO", priority: "MEDIUM", due: 16 },
  { title: "Receive the remaining formwork props (PO-2026-0017)", project: "FARKA_RESIDENCE", company: "IDEAL_CONSTRUCTION", assignee: "ideal.procurement", creator: "ideal.site-engineer", status: "TODO", priority: "MEDIUM", due: 4, link: { module: "procurement", entityType: "purchase_order", entityId: "armaar_po_fr_formwork" } },
  { title: "Block C level 3 slab — pre-pour inspection", project: "FARKA_RESIDENCE", company: "IDEAL_CONSTRUCTION", assignee: "ideal.qaqc", creator: "ideal.pm", status: "TODO", priority: "HIGH", due: 2 },
  { title: "Monthly HSE walk — Block B", project: "FARKA_RESIDENCE", company: "IDEAL_CONSTRUCTION", assignee: "ideal.hse", creator: "ideal.pm", status: "COMPLETED", priority: "MEDIUM", due: -6 },
  { title: "Approve plumbing fittings PR-2026-0016", project: "THE_COURTYARD", company: "ARLIS_NDERTIM", assignee: "arlis.director", creator: "arlis.pm-lead", status: "TODO", priority: "MEDIUM", due: 1, link: { module: "procurement", entityType: "purchase_request", entityId: "armaar_pr_tc_fittings" } },
  { title: "Reconcile the block 3 cement delivery with GRN-2026-0011", project: "THE_COURTYARD", company: "ARLIS_NDERTIM", assignee: "arlis.procurement", creator: "arlis.pm-lead", status: "COMPLETED", priority: "LOW", due: -25 },
  { title: "Environmental permit — marina dredging", project: "POGRADEC_MARINA", company: "KF_POGRADECI", assignee: "kfp.pm", creator: "kfp.director", status: "IN_PROGRESS", priority: "HIGH", due: 21 },
  { title: "Structural concept options for the observation deck", project: "EYES_OF_TIRANA", company: "UNICO_CONSTRUCTION", assignee: "unico.structural", creator: "unico.engineering", status: "TODO", priority: "MEDIUM", due: 25 },
  { title: "Grid connection application — rooftop programme, batch 2", project: null, company: "ARSOL_ENERGY", assignee: "arsol.electrical", creator: "arsol.pm", status: "IN_PROGRESS", priority: "HIGH", due: 12 },
  { title: "Receive PV modules, batch 2 (PO-2026-0006)", project: null, company: "ARSOL_ENERGY", assignee: "arsol.procurement", creator: "arsol.pm", status: "TODO", priority: "MEDIUM", due: 22, link: { module: "procurement", entityType: "purchase_order", entityId: "armaar_po_as_modules" } },
  { title: "Update the PPA pricing model", project: null, company: "ARSOL_ENERGY", assignee: "arsol.finance", creator: "arsol.director", status: "TODO", priority: "MEDIUM", due: 15 },
];

/** D-01 texts that quote numbers D-02 renumbered, corrected only where they still read as seeded. */
const CORRECTIONS: Array<{ model: "task" | "meetingActionItem" | "expense" | "document" | "activity"; id: string; field: "title" | "description" | "name" | "message"; from: string; to: string }> = [
  { model: "task", id: "armaar_task_003", field: "title", from: "Resolve RFI-042 — Tower A core wall openings", to: "Resolve RFI-009 — Tower A core wall openings at level 9" },
  { model: "task", id: "armaar_task_007", field: "title", from: "Close NCR-2026-014 — slab edge cover", to: "Close NCR-2026-0014 — slab edge cover" },
  { model: "task", id: "armaar_task_011", field: "title", from: "Reconcile rebar deliveries with PO-2026-031", to: "Reconcile rebar deliveries with PO-2026-0031" },
  { model: "meetingActionItem", id: "armaar_mtg_tl_coord_past_action_2", field: "title", from: "Chase approval of PR-2026-052 (curtain wall brackets)", to: "Chase approval of PR-2026-0052 (curtain wall brackets)" },
  { model: "expense", id: "armaar_exp_tl_001", field: "description", from: "Ready-mix C35/45 — podium slab (PO-2026-034)", to: "Ready-mix C35/45 — podium slab (PO-2026-0034)" },
  { model: "expense", id: "armaar_exp_tl_002", field: "description", from: "Rebar B500C, first delivery (PO-2026-031)", to: "Rebar B500C, first delivery (PO-2026-0031)" },
  { model: "document", id: "armaar_doc_tl_14", field: "name", from: "Purchase order PO-2026-031.pdf", to: "Purchase order PO-2026-0031.pdf" },
  { model: "activity", id: "armaar_act_pr_brackets", field: "message", from: "submitted PR-2026-052 for approval", to: "submitted PR-2026-0052 for approval" },
  { model: "activity", id: "armaar_act_po_rebar_issued", field: "message", from: "approved PO-2026-031 for Adriatik Steel", to: "approved PO-2026-0031 for Adriatik Steel" },
  { model: "activity", id: "armaar_act_po_switchgear", field: "message", from: "submitted PO-2026-039 for approval", to: "submitted PO-2026-0039 for approval" },
  { model: "activity", id: "armaar_act_grn_concrete", field: "message", from: "recorded the final ready-mix delivery against PO-2026-034", to: "recorded the final ready-mix delivery against PO-2026-0034" },
];

export async function seedArmaarTasks(prisma: PrismaClient) {
  const today = localDate(new Date(), ZONE);
  const day = (offset: number) => new Date(`${addLocalDays(today, offset)}T12:00:00.000Z`);
  const at = (offset: number, hour = 10) => new Date(`${addLocalDays(today, offset)}T${String(hour).padStart(2, "0")}:00:00.000Z`);

  for (const [index, task] of TASKS.entries()) {
    const id = `armaar_task_${String(index + 101).padStart(3, "0")}`;
    const assignee = memberId(task.assignee, task.company);
    await prisma.task.upsert({
      where: { id },
      update: {},
      create: {
        id,
        companyId: companyId(task.company),
        projectId: task.project ? projectId(task.project) : null,
        title: task.title,
        description: task.description ?? null,
        assigneeMemberId: assignee,
        createdByMemberId: memberId(task.creator, task.company),
        status: task.status,
        priority: task.priority,
        startDate: day(Math.min(task.due - 10, -1)),
        dueDate: day(task.due),
        completedAt: task.status === "COMPLETED" ? at(task.due - 1, 16) : null,
        blockedAt: task.status === "BLOCKED" ? at(task.due - 2, 11) : null,
        blockedReason: task.blocked ?? null,
        blockedByMemberId: task.status === "BLOCKED" ? assignee : null,
        module: task.link?.module ?? null,
        entityType: task.link?.entityType ?? null,
        entityId: task.link?.entityId ?? null,
        createdBy: userId(task.creator),
        createdAt: at(Math.min(task.due - 12, -2), 9),
      },
    });
  }

  // D-01's blocked task says why and since when, as a blocked task does (§31).
  await prisma.task.updateMany({ where: { id: "armaar_task_007", status: "BLOCKED", blockedAt: null }, data: { blockedAt: at(-4, 11), blockedReason: "Waiting for the core test results from the laboratory.", blockedByMemberId: memberId("arlis.qaqc-engineer", BCI) } });
  // The RFI it is about now exists.
  await prisma.task.updateMany({ where: { id: "armaar_task_003", entityId: null }, data: { module: "engineering", entityType: "rfi", entityId: "armaar_rfi_tl_009" } });
  for (const correction of CORRECTIONS) {
    const where = { id: correction.id, [correction.field]: correction.from };
    const data = { [correction.field]: correction.to };
    const delegate = prisma[correction.model] as unknown as { updateMany(args: { where: unknown; data: unknown }): Promise<unknown> };
    await delegate.updateMany({ where, data });
  }

  return { tasks: await prisma.task.count({ where: { company: { parentGroupId: ARMAAR_GROUP_ID } } }) };
}
