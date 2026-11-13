/**
 * Quality and the technical record. QA/QC: inspections requested before every
 * pour and on the rebar that came in, inspections with their results, a snag
 * list of defects, NCRs with their corrective actions — and Kodra's warranty
 * defects. Engineering: each project's drawing register with revisions, RFIs
 * and their answers, submittals and the transmittals that sent them out.
 */
import type { EngineeringDiscipline, EngineeringDocumentType, NCRCategory, PrismaClient, QualitySeverity, TechnicalSubmittalType } from "@prisma/client";

import { placeholderPdf, seedStoredDocument } from "../../document-objects";
import { at, businessDay, castOf, Numbers, random, type Cast, type Clock } from "./kit";

const QA_PROJECTS = ["project_b", "project_c", "project_d", "project_e", "project_showcase_promenada", "project_showcase_kodra"];
const ENGINEERING_PROJECTS = ["project_b", "project_c", "project_d", "project_e", "project_showcase_promenada", "project_showcase_rinas"];

const WORK_INSPECTIONS = [
  { title: "Rebar before the pour, level slab", reference: "STR-DWG-210 rev C", location: "Upper slab" },
  { title: "Formwork and props, level slab", reference: "STR-DWG-205 rev B", location: "Upper slab" },
  { title: "Waterproofing to the basement walls", reference: "ARC-SPEC-031", location: "Basement" },
  { title: "Blockwork setting-out", reference: "ARC-DWG-120 rev D", location: "Lower floors" },
  { title: "MEP first fix before plaster", reference: "MEP-DWG-301 rev A", location: "Lower floors" },
  { title: "Window installation, sealant and fixings", reference: "FAC-SD-014 rev B", location: "Façade" },
];

const DEFECTS: Array<{ title: string; description: string; severity: QualitySeverity }> = [
  { title: "Honeycombing at the column base", description: "Visible voids at the base of column C4 after striking.", severity: "HIGH" },
  { title: "Cracked tile in the corridor", description: "Two floor tiles cracked by the delivery trolley.", severity: "LOW" },
  { title: "Window does not close flush", description: "Bedroom window binds at the top hinge.", severity: "MEDIUM" },
  { title: "Plaster crack at the door head", description: "Hairline crack above the apartment door.", severity: "LOW" },
  { title: "Missing fire stopping around the riser", description: "Penetrations through the slab not sealed on level 4.", severity: "HIGH" },
  { title: "Uneven screed", description: "Screed out of level by 8 mm over 2 m in the living room.", severity: "MEDIUM" },
  { title: "Balcony drain blocked", description: "Mortar in the balcony outlet; water pooling after rain.", severity: "MEDIUM" },
  { title: "Paint splashes on the window frames", description: "Frames marked by the painters on the south side.", severity: "LOW" },
];

const WARRANTY_DEFECTS: Array<{ title: string; description: string; severity: QualitySeverity }> = [
  { title: "Damp patch on the basement wall", description: "Owner reports a damp patch after heavy rain; drain behind the wall to be checked.", severity: "MEDIUM" },
  { title: "Garden irrigation valve leaking", description: "Valve box flooded; valve to be replaced under warranty.", severity: "LOW" },
  { title: "Sliding door runner worn", description: "Terrace door hard to slide; runner to be replaced.", severity: "LOW" },
];

const NCRS: Array<{ title: string; description: string; category: NCRCategory; severity: QualitySeverity; cause: string; action: string }> = [
  { title: "Concrete cover below specification", description: "Cover measured at 18–22 mm against 30 mm specified on the slab edge.", category: "WORKMANSHIP", severity: "HIGH", cause: "Spacers missing at the slab edge.", action: "Add spacers at 1 m centres; engineer to check every edge before the pour." },
  { title: "Rebar delivered without mill certificates", description: "A delivery of Ø16 bars arrived without its mill certificates.", category: "SUPPLIER", severity: "MEDIUM", cause: "Supplier's dispatch did not attach the certificates.", action: "Bars quarantined until certificates received; supplier reminded of the agreement." },
];

const DRAWINGS: Array<{ code: string; title: string; type: EngineeringDocumentType; discipline: EngineeringDiscipline }> = [
  { code: "ARC-GA-100", title: "General arrangement — site plan", type: "DRAWING", discipline: "ARCHITECTURE" },
  { code: "ARC-GA-101", title: "General arrangement — typical floor", type: "DRAWING", discipline: "ARCHITECTURE" },
  { code: "ARC-SEC-201", title: "Sections A–A and B–B", type: "DRAWING", discipline: "ARCHITECTURE" },
  { code: "STR-FND-110", title: "Foundation plan and details", type: "DRAWING", discipline: "STRUCTURAL" },
  { code: "STR-SLB-210", title: "Typical slab reinforcement", type: "DRAWING", discipline: "STRUCTURAL" },
  { code: "STR-CALC-001", title: "Structural calculations, frame", type: "CALCULATION", discipline: "STRUCTURAL" },
  { code: "MEP-SCH-301", title: "Plumbing and drainage schematic", type: "DRAWING", discipline: "PLUMBING" },
  { code: "MEP-ELE-401", title: "Electrical distribution, typical floor", type: "DRAWING", discipline: "ELECTRICAL" },
  { code: "FAC-SPEC-010", title: "Façade specification", type: "SPECIFICATION", discipline: "FACADE" },
];

const RFIS: Array<{ subject: string; question: string; answer: string | null; discipline: EngineeringDiscipline }> = [
  { subject: "Slab edge detail at the balconies", question: "STR-SLB-210 shows a 200 mm slab but the architectural section shows 220 mm at the balcony. Which governs?", answer: "200 mm structural slab; the extra 20 mm is the screed and drainage fall. Section to be corrected in rev D.", discipline: "STRUCTURAL" },
  { subject: "Window sill height in the bedrooms", question: "Sill height 900 mm on ARC-GA-101 or 1,100 mm on the façade specification?", answer: "1,100 mm above finished floor to meet the guarding rule.", discipline: "ARCHITECTURE" },
  { subject: "Sprinkler riser clash with the duct", question: "The sprinkler riser clashes with the kitchen extract duct at level 4. Can the riser move 300 mm east?", answer: "Yes; move 300 mm east and keep 50 mm clear of the duct insulation.", discipline: "MECHANICAL" },
  { subject: "Earthing for the façade brackets", question: "Do the aluminium façade brackets need bonding to the earthing system?", answer: null, discipline: "ELECTRICAL" },
  { subject: "Lift pit depth", question: "The lift supplier asks for a 1,400 mm pit; the drawings show 1,200 mm. Please confirm.", answer: null, discipline: "STRUCTURAL" },
];

const SUBMITTALS: Array<{ title: string; type: TechnicalSubmittalType; discipline: EngineeringDiscipline; manufacturer: string | null; status: "APPROVED" | "APPROVED_WITH_COMMENTS" | "REVISION_REQUIRED" | "UNDER_REVIEW" }> = [
  { title: "Rebar B500C mill certificates", type: "MATERIAL_SUBMITTAL", discipline: "STRUCTURAL", manufacturer: "Ferro Adriatik", status: "APPROVED" },
  { title: "Window system shop drawings", type: "SHOP_DRAWING", discipline: "FACADE", manufacturer: "Profil Alu Durrës", status: "APPROVED_WITH_COMMENTS" },
  { title: "Method statement for the slab pours", type: "METHOD_STATEMENT", discipline: "STRUCTURAL", manufacturer: null, status: "REVISION_REQUIRED" },
  { title: "Lift product data", type: "PRODUCT_DATA", discipline: "MECHANICAL", manufacturer: "Ashensor Tech", status: "UNDER_REVIEW" },
];

/** A stored PDF with its version 1, as an upload leaves it, returned with that version's id. */
async function storedPdf(prisma: PrismaClient, input: { id: string; companyId: string; projectId: string; name: string; module: string; entityType: string; entityId: string; cast: Cast; part: "engineer" | "architect" | "qaqc"; when: Date }) {
  await seedStoredDocument(prisma, { id: input.id, companyId: input.companyId, name: input.name, projectId: input.projectId, module: input.module, entityType: input.entityType, entityId: input.entityId, uploadedByMemberId: input.cast.member(input.part), createdBy: input.cast.user(input.part), bytes: placeholderPdf(input.name.replace(/\.pdf$/, "")) });
  const document = await prisma.document.findUniqueOrThrow({ where: { id: input.id } });
  const version = await prisma.documentVersion.create({
    data: { companyId: input.companyId, documentId: document.id, versionNumber: 1, storageProvider: document.storageProvider, storageBucket: document.storageBucket, storageKey: document.storageKey!, originalFileName: document.originalFileName, fileName: document.fileName, extension: document.extension, mimeTypeDeclared: document.mimeType, mimeTypeDetected: document.detectedMimeType, sizeBytes: document.sizeBytes, checksumSha256: document.checksum, storageStatus: "AVAILABLE", previewStatus: document.previewStatus, previewMimeType: document.previewMimeType, uploadedByMemberId: input.cast.member(input.part), createdAt: input.when, availableAt: input.when },
    select: { id: true },
  });
  await prisma.document.update({ where: { id: document.id }, data: { currentVersionId: version.id, latestVersionNumber: 1, createdAt: input.when } });
  return { documentId: document.id, versionId: version.id };
}

export async function seedShowcaseQuality(prisma: PrismaClient, clock: Clock) {
  const numbers = new Numbers(prisma);
  const totals = { requests: 0, inspections: 0, defects: 0, ncrs: 0, actions: 0, drawings: 0, revisions: 0, rfis: 0, submittals: 0, transmittals: 0 };

  for (const projectId of QA_PROJECTS) {
    const project = await prisma.project.findUniqueOrThrow({ where: { id: projectId }, select: { companyId: true } });
    const cast = await castOf(prisma, project.companyId!);
    const rand = random(`qa:${projectId}`);
    const n = (table: string, column: string, prefix: string, offset: number) => numbers.take({ companyId: cast.companyId, table, column, prefix, year: at(clock, offset).getUTCFullYear() });
    const qaqc = cast.member("qaqc");
    const finished = projectId === "project_showcase_kodra";

    let defectSource: string | null = null;
    if (!finished) {
      // Work inspections asked for by the site, and one on a rebar delivery.
      const rebar = await prisma.goodsReceipt.findFirst({ where: { projectId, purchaseOrder: { items: { some: { description: { contains: "Rebar" } } } } }, orderBy: { receiptDate: "desc" }, select: { id: true, receiptDate: true, items: { select: { id: true }, take: 1 } } });
      const plans = [...WORK_INSPECTIONS.slice(0, 5).map((row) => ({ ...row, material: false })), ...(rebar ? [{ title: "Incoming rebar: tags, diameters and certificates", reference: "Supply agreement", location: "Laydown yard", material: true }] : [])];
      for (const [index, plan] of plans.entries()) {
        const requested = -rand.int(1, 45);
        const stage = index === plans.length - 1 && !plan.material ? "OPEN" : index === 0 ? "ASSIGNED" : "COMPLETED";
        const request = await prisma.inspectionRequest.create({
          data: { companyId: cast.companyId, requestNumber: await n("inspection_requests", "requestNumber", "IR", requested), title: plan.title, inspectionType: plan.material ? "MATERIAL" : "WORK", projectId, goodsReceiptId: plan.material ? rebar!.id : null, goodsReceiptItemId: plan.material ? (rebar!.items[0]?.id ?? null) : null, requestedByMemberId: cast.member("engineer"), assignedInspectorMemberId: stage === "OPEN" ? null : qaqc, requestedDate: at(clock, requested), requiredByDate: businessDay(clock, requested + 2), priority: index < 2 ? "HIGH" : "MEDIUM", status: stage, description: `Ready for inspection — ${plan.location.toLowerCase()}.`, locationText: plan.location, createdByMemberId: cast.member("engineer"), createdAt: at(clock, requested) },
          select: { id: true },
        });
        totals.requests += 1;
        if (stage !== "COMPLETED") continue;
        const result = index === 2 ? "FAIL" : index === 3 ? "CONDITIONAL" : "PASS";
        const inspected = requested + 1;
        const inspection = await prisma.qualityInspection.create({
          data: {
            companyId: cast.companyId, inspectionNumber: await n("quality_inspections", "inspectionNumber", "QI", inspected), inspectionType: plan.material ? "MATERIAL" : "WORK", requestId: request.id, projectId, goodsReceiptId: plan.material ? rebar!.id : null,
            assignedInspectorMemberId: qaqc, executedByMemberId: qaqc, status: "CLOSED", result, inspectionDate: at(clock, inspected), submittedAt: at(clock, inspected, 14), approvedAt: at(clock, inspected + 1), approvedByMemberId: cast.member("pm"), closedAt: at(clock, inspected + 1), closedByMemberId: qaqc,
            locationText: plan.location, drawingReference: plan.reference, summary: result === "PASS" ? "Conforms; released for the next activity." : result === "CONDITIONAL" ? "Released with two minor items to correct before close-out." : "Does not conform; NCR raised.", createdByMemberId: qaqc, createdAt: at(clock, inspected),
          },
          select: { id: true },
        });
        totals.inspections += 1;
        if (result === "FAIL") defectSource = inspection.id;
      }
      // One inspection written up and waiting for the PM's approval.
      await prisma.qualityInspection.create({ data: { companyId: cast.companyId, inspectionNumber: await n("quality_inspections", "inspectionNumber", "QI", -1), inspectionType: "WORK", projectId, assignedInspectorMemberId: qaqc, executedByMemberId: qaqc, status: "PENDING_APPROVAL", result: "PASS", inspectionDate: at(clock, -1), submittedAt: at(clock, -1, 15), locationText: "Upper slab", drawingReference: "STR-SLB-210 rev C", summary: "Reinforcement as drawn; cover checked at 20 points.", createdByMemberId: qaqc, createdAt: at(clock, -1) } });
      totals.inspections += 1;
    }

    // The snag list (Kodra: warranty defects reported by owners).
    const defects = finished ? WARRANTY_DEFECTS : DEFECTS.filter(() => rand.chance(0.85));
    for (const [index, defect] of defects.entries()) {
      const raised = -rand.int(2, 40);
      const status = finished ? (index === 0 ? "IN_PROGRESS" : "OPEN") : index % 4 === 0 ? "CLOSED" : index % 4 === 1 ? "RESOLVED" : index % 4 === 2 ? "IN_PROGRESS" : "OPEN";
      await prisma.qualityDefect.create({
        data: { companyId: cast.companyId, defectNumber: await n("quality_defects", "defectNumber", "DEF", raised), title: defect.title, description: defect.description, projectId, inspectionId: index === 0 ? defectSource : null, severity: defect.severity, status, locationText: finished ? `Villa ${rand.pick(["A-03", "B-05", "C-01", "A-07"])}` : rand.pick(["Level 3", "Level 4", "Level 6", "Ground floor"]), assignedToMemberId: cast.member("pm"), dueDate: businessDay(clock, raised + 14), resolvedAt: status === "RESOLVED" || status === "CLOSED" ? at(clock, raised + 6) : null, resolvedByMemberId: status === "RESOLVED" || status === "CLOSED" ? cast.member("pm") : null, resolutionNote: status === "RESOLVED" || status === "CLOSED" ? "Made good; photos on file." : null, closedAt: status === "CLOSED" ? at(clock, raised + 8) : null, closedByMemberId: status === "CLOSED" ? qaqc : null, createdByMemberId: qaqc, createdAt: at(clock, raised) },
      });
      totals.defects += 1;
    }
    if (finished) continue;

    // NCRs and their corrective actions.
    for (const [index, ncr] of NCRS.entries()) {
      const raised = -rand.int(8, 50);
      const closed = index === 1 && raised < -20;
      const record = await prisma.nonConformanceReport.create({
        data: { companyId: cast.companyId, ncrNumber: await n("non_conformance_reports", "ncrNumber", "NCR", raised), title: ncr.title, description: ncr.description, projectId, inspectionId: index === 0 ? defectSource : null, category: ncr.category, severity: ncr.severity, status: closed ? "CLOSED" : index === 0 ? "IN_PROGRESS" : "PENDING_VERIFICATION", assignedToMemberId: cast.member("pm"), ownerMemberId: qaqc, immediateAction: "Work on the affected area stopped.", rootCause: ncr.cause, correctiveActionSummary: ncr.action, dueDate: businessDay(clock, raised + 14), submittedAt: at(clock, raised), closedAt: closed ? at(clock, raised + 12) : null, closedByMemberId: closed ? qaqc : null, closureNote: closed ? "Certificates received and checked." : null, createdByMemberId: qaqc, createdAt: at(clock, raised) },
        select: { id: true },
      });
      totals.ncrs += 1;
      await prisma.correctiveAction.create({
        data: { companyId: cast.companyId, actionNumber: await n("corrective_actions", "actionNumber", "CA", raised), title: ncr.action.split(";")[0]!, description: ncr.action, ncrId: record.id, projectId, assignedToMemberId: cast.member("engineer"), dueDate: businessDay(clock, raised + 10), status: closed ? "VERIFIED" : index === 0 ? "IN_PROGRESS" : "PENDING_VERIFICATION", completedAt: closed || index === 1 ? at(clock, raised + 6) : null, completedByMemberId: closed || index === 1 ? cast.member("engineer") : null, verifiedAt: closed ? at(clock, raised + 8) : null, verifiedByMemberId: closed ? qaqc : null, createdByMemberId: qaqc, createdAt: at(clock, raised) },
      });
      totals.actions += 1;
    }
  }

  for (const projectId of ENGINEERING_PROJECTS) {
    const project = await prisma.project.findUniqueOrThrow({ where: { id: projectId }, select: { companyId: true, code: true, startDate: true } });
    const cast = await castOf(prisma, project.companyId!);
    const rand = random(`eng:${projectId}`);
    const n = (table: string, column: string, prefix: string, offset: number) => numbers.take({ companyId: cast.companyId, table, column, prefix, year: at(clock, offset).getUTCFullYear() });
    const design = projectId === "project_showcase_rinas";
    const started = design ? -70 : Math.max(-300, Math.round((project.startDate!.getTime() - clock.now.getTime()) / 86_400_000));

    // The drawing register: two or three revisions on most, the last one current.
    const register: Array<{ id: string; revisionId: string; documentId: string; versionId: string }> = [];
    for (const [index, drawing] of DRAWINGS.entries()) {
      const id = `eng_${projectId}_${index + 1}`;
      const revisions = design ? (index < 4 ? 1 : 0) : rand.int(1, 3);
      if (revisions === 0) continue;
      await prisma.engineeringDocument.create({ data: { id, companyId: cast.companyId, projectId, documentNumber: `${project.code}-${drawing.code}`, title: drawing.title, documentType: drawing.type, discipline: drawing.discipline, status: "DRAFT", authorText: drawing.discipline === "ARCHITECTURE" ? "Arvela design studio" : "Studio Struktura", responsibleMemberId: cast.member(drawing.discipline === "ARCHITECTURE" ? "architect" : "engineer"), reviewerMemberId: cast.member("pm"), createdByMemberId: cast.member("architect"), createdAt: at(clock, started) } });
      let current = { revisionId: "", documentId: "", versionId: "" };
      for (let revision = 0; revision < revisions; revision += 1) {
        const code = String.fromCharCode(65 + revision);
        const when = Math.min(-2, started + 15 + revision * Math.round(-started / 4) + index);
        const last = revision === revisions - 1;
        const file = await storedPdf(prisma, { id: `doc_${id}_rev_${code.toLowerCase()}`, companyId: cast.companyId, projectId, name: `${project.code}-${drawing.code} rev ${code}.pdf`, module: "engineering", entityType: "engineering_document", entityId: id, cast, part: drawing.discipline === "ARCHITECTURE" ? "architect" : "engineer", when: at(clock, when) });
        const decision = !last ? "APPROVED_WITH_COMMENTS" : design ? null : index % 5 === 4 ? "REVISION_REQUIRED" : "APPROVED";
        const revisionRow = await prisma.engineeringDocumentRevision.create({
          data: { companyId: cast.companyId, engineeringDocumentId: id, revisionCode: code, revisionNumber: revision + 1, documentId: file.documentId, documentVersionId: file.versionId, notes: revision === 0 ? "First issue." : `Revised: ${rand.pick(["comments from the review", "coordination with MEP", "client changes", "RFI answers incorporated"])}.`, status: last ? (decision ? "FINALIZED" : "UNDER_REVIEW") : "SUPERSEDED", submittedAt: at(clock, when), submittedByMemberId: cast.member("architect"), reviewStartedAt: at(clock, when + 1), reviewDecision: decision, reviewedByMemberId: decision ? cast.member("pm") : null, reviewedAt: decision ? at(clock, when + 3) : null, reviewComment: decision === "REVISION_REQUIRED" ? "Dimensions on grid C do not match the structural drawing; please revise." : null, supersededAt: last ? null : at(clock, when + Math.round(-started / 4)), createdByMemberId: cast.member("architect"), createdAt: at(clock, when) },
          select: { id: true },
        });
        current = { revisionId: revisionRow.id, ...file };
        totals.revisions += 1;
      }
      const lastDecision = design ? "UNDER_REVIEW" : index % 5 === 4 ? "REVISION_REQUIRED" : "APPROVED";
      await prisma.engineeringDocument.update({ where: { id }, data: { currentRevisionId: current.revisionId, status: lastDecision } });
      register.push({ id, ...current });
      totals.drawings += 1;
    }

    // RFIs with answers, a few still open.
    const contractor = await prisma.projectContractorAssignment.findFirst({ where: { projectId }, select: { contractorId: true } });
    for (const [index, rfi] of RFIS.entries()) {
      if (design && index > 2) continue;
      const raised = -rand.int(3, 60);
      const answered = rfi.answer !== null && !(design && index === 2);
      const record = await prisma.rfi.create({
        data: { companyId: cast.companyId, projectId, contractorId: index % 2 === 0 ? (contractor?.contractorId ?? null) : null, rfiNumber: await n("rfis", "rfiNumber", "RFI", raised), subject: rfi.subject, question: rfi.question, discipline: rfi.discipline, status: answered ? (index === 0 ? "CLOSED" : "ANSWERED") : index === 4 ? "CLARIFICATION_REQUIRED" : "OPEN", priority: index === 4 ? "HIGH" : "NORMAL", raisedByText: index % 2 === 0 ? "Site team" : null, raisedByMemberId: cast.member("engineer"), assignedToMemberId: cast.member("architect"), dueAt: at(clock, raised + 7), openedAt: at(clock, raised), answeredAt: answered ? at(clock, raised + 4) : null, closedAt: answered && index === 0 ? at(clock, raised + 6) : null, closureNote: answered && index === 0 ? "Answer issued in drawing revision." : null, createdByMemberId: cast.member("engineer"), createdAt: at(clock, raised) },
        select: { id: true },
      });
      if (answered) await prisma.rfiResponse.create({ data: { companyId: cast.companyId, rfiId: record.id, responseText: rfi.answer!, respondedByMemberId: cast.member("architect"), respondedAt: at(clock, raised + 4), finalResponse: true } });
      if (index === 4) await prisma.rfiResponse.create({ data: { companyId: cast.companyId, rfiId: record.id, responseText: "Please send the lift supplier's pit drawing so we can check the slab below.", respondedByMemberId: cast.member("engineer"), respondedAt: at(clock, raised + 2), finalResponse: false, clarificationRequest: true } });
      totals.rfis += 1;
    }
    if (design) continue;

    // Submittals from the trades, each with its revision and file.
    for (const [index, submittal] of SUBMITTALS.entries()) {
      const submitted = -rand.int(5, 70);
      const id = `subm_${projectId}_${index + 1}`;
      await prisma.technicalSubmittal.create({ data: { id, companyId: cast.companyId, projectId, contractorId: contractor?.contractorId ?? null, submittalNumber: await n("technical_submittals", "submittalNumber", "SUB", submitted), title: submittal.title, submittalType: submittal.type, discipline: submittal.discipline, status: submittal.status, assignedReviewerMemberId: cast.member(submittal.discipline === "FACADE" ? "architect" : "engineer"), dueAt: at(clock, submitted + 10), manufacturer: submittal.manufacturer, createdByMemberId: cast.member("engineer"), createdAt: at(clock, submitted) } });
      const file = await storedPdf(prisma, { id: `doc_${id}_r1`, companyId: cast.companyId, projectId, name: `${submittal.title}.pdf`, module: "engineering", entityType: "technical_submittal", entityId: id, cast, part: "engineer", when: at(clock, submitted) });
      const reviewed = submittal.status !== "UNDER_REVIEW";
      const revision = await prisma.technicalSubmittalRevision.create({ data: { companyId: cast.companyId, submittalId: id, revisionCode: "A", revisionNumber: 1, documentId: file.documentId, documentVersionId: file.versionId, status: reviewed ? "FINALIZED" : "UNDER_REVIEW", submittedAt: at(clock, submitted), submittedByMemberId: cast.member("engineer"), reviewStartedAt: at(clock, submitted + 1), reviewDecision: reviewed ? (submittal.status as "APPROVED" | "APPROVED_WITH_COMMENTS" | "REVISION_REQUIRED") : null, reviewedByMemberId: reviewed ? cast.member("pm") : null, reviewedAt: reviewed ? at(clock, submitted + 5) : null, reviewComment: submittal.status === "REVISION_REQUIRED" ? "Add the pour sequence for the transfer slab and the curing method." : submittal.status === "APPROVED_WITH_COMMENTS" ? "Approved; sill flashing to be extended 50 mm." : null, createdByMemberId: cast.member("engineer"), createdAt: at(clock, submitted) }, select: { id: true } });
      await prisma.technicalSubmittal.update({ where: { id }, data: { currentRevisionId: revision.id } });
      totals.submittals += 1;
    }

    // Transmittals: drawings out for construction, shop drawings in for review.
    for (const [index, direction] of (["OUTGOING", "INCOMING"] as const).entries()) {
      const issued = -rand.int(5, 30);
      const items = register.slice(index * 3, index * 3 + 3);
      if (items.length === 0) continue;
      await prisma.documentTransmittal.create({
        data: { companyId: cast.companyId, projectId, transmittalNumber: await n("document_transmittals", "transmittalNumber", "TRN", issued), direction, purpose: direction === "OUTGOING" ? "FOR_CONSTRUCTION" : "FOR_REVIEW", status: "ISSUED", subject: direction === "OUTGOING" ? "Drawings issued for construction" : "Shop drawings for review", contractorId: contractor?.contractorId ?? null, senderText: direction === "OUTGOING" ? "Arvela design team" : "Subcontractor", recipientText: direction === "OUTGOING" ? "Site team and subcontractors" : "Arvela design team", issuedAt: at(clock, issued), issuedByMemberId: cast.member("architect"), createdByMemberId: cast.member("architect"), createdAt: at(clock, issued), items: { create: items.map((item, sort) => ({ companyId: cast.companyId, engineeringDocumentId: item.id, engineeringRevisionId: item.revisionId, documentId: item.documentId, documentVersionId: item.versionId, sortOrder: sort + 1 })) } },
      });
      totals.transmittals += 1;
    }
  }
  return totals;
}
