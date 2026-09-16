import { Prisma, type PrismaClient } from "@prisma/client";

import { addLocalDays, localDate } from "../../lib/modules/calendar/calendar.time";
import { normalizeContractorName } from "../../lib/modules/contractors/contractor.names";
import { seedStoredDocument } from "./document-objects";

/**
 * Contractor and engineering demo data (PRD #46 §308-§313).
 *
 * Company A: Apex Structural Works (also the Alba Concrete supplier) builds
 * Riverside's frame and is lined up for the Central Office Tower basement;
 * Brightline Façades holds the Riverside façade subcontract, with its
 * performance bond expired and its HSE certificate missing; Northgate MEP is
 * being evaluated; Ironbridge Groundworks finished early and was offboarded.
 * Apex's insurance expires in two weeks. Riverside has a drawing that went
 * through revisions A, B and C, a calculation overdue for review, a façade
 * shop drawing under review, RFIs open, overdue, answered, closed and in
 * draft, a material submittal sent back for revision, a crane method
 * statement waiting on safety, approved rebar certificates, and one issued and
 * one draft transmittal. Company B has one contractor, for isolation.
 *
 * Dated relative to the day the seed runs; re-running replaces every
 * contractor and engineering record in the demo companies.
 */
type Members = Map<string, string>;

const COMPANY_A = "company_demo_a";
const COMPANY_B = "company_demo_b";
const RIVERSIDE = "project_a";
const TOWER = "project_b";
const ZONE = "Europe/Tirane";

export const ENGINEERING_SEED = {
  contractors: { apex: "contractor_apex", brightline: "contractor_brightline", northgate: "contractor_northgate", ironbridge: "contractor_ironbridge", companyB: "contractor_b_isar" },
  assignments: { apexRiverside: "assignment_apex_riverside", brightlineRiverside: "assignment_brightline_riverside", apexTower: "assignment_apex_tower", ironbridgeRiverside: "assignment_ironbridge_riverside", companyB: "assignment_b_isar" },
  workPackages: { frame: "wp_riverside_frame", facade: "wp_riverside_facade", groundworks: "wp_riverside_groundworks", towerBasement: "wp_tower_basement" },
  compliance: { apexInsurance: "compliance_apex_insurance", apexLicence: "compliance_apex_licence", brightlineBond: "compliance_brightline_bond", brightlineHse: "compliance_brightline_hse", northgateTax: "compliance_northgate_tax" },
  documents: { floorPlan: "engdoc_arc_sd_023", transferSlab: "engdoc_str_calc_011", curtainWall: "engdoc_fac_sd_004", ventilation: "engdoc_mep_spec_002" },
  rfis: { slabEdge: "rfi_riverside_001", bracket: "rfi_riverside_002", fireStopping: "rfi_riverside_003", parapet: "rfi_riverside_004", tower: "rfi_tower_001" },
  submittals: { curtainWall: "submittal_riverside_001", crane: "submittal_riverside_002", rebar: "submittal_riverside_003", ductwork: "submittal_riverside_004" },
  transmittals: { issued: "transmittal_riverside_001", draft: "transmittal_riverside_002" },
} as const;

const ENTITY_TYPES = ["contractor", "work_package", "contractor_compliance", "engineering_document", "rfi", "technical_submittal", "transmittal"];

async function clear(prisma: PrismaClient) {
  const companies = [COMPANY_A, COMPANY_B];
  const inCompanies = { companyId: { in: companies } };
  const ids = async (rows: Promise<Array<{ id: string }>>) => (await rows).map((row) => row.id);
  const all = [
    ...(await ids(prisma.contractorProfile.findMany({ where: inCompanies, select: { id: true } }))),
    ...(await ids(prisma.workPackage.findMany({ where: inCompanies, select: { id: true } }))),
    ...(await ids(prisma.contractorComplianceItem.findMany({ where: inCompanies, select: { id: true } }))),
    ...(await ids(prisma.engineeringDocument.findMany({ where: inCompanies, select: { id: true } }))),
    ...(await ids(prisma.rfi.findMany({ where: inCompanies, select: { id: true } }))),
    ...(await ids(prisma.technicalSubmittal.findMany({ where: inCompanies, select: { id: true } }))),
    ...(await ids(prisma.documentTransmittal.findMany({ where: inCompanies, select: { id: true } }))),
  ];
  await prisma.attentionItem.deleteMany({ where: { entityType: { in: ENTITY_TYPES }, entityId: { in: all } } });
  await prisma.notification.deleteMany({ where: { entityType: { in: ENTITY_TYPES }, entityId: { in: all } } });
  await prisma.notificationEventOutbox.deleteMany({ where: { entityType: { in: ENTITY_TYPES }, entityId: { in: all } } });
  // The reminders' idempotency ledger too, or a re-seeded record that is due
  // again would never be announced (PRD #51 §15-§19).
  await prisma.jobIdempotencyKey.deleteMany({ where: { ...inCompanies, jobKey: { in: ["contractors.compliance", "engineering.reminders"] } } });
  await prisma.integrationLink.deleteMany({ where: { ...inCompanies, integrationType: "ENGINEERING_RECORD" } });
  await prisma.dailyLogWorkforceEntry.updateMany({ where: { ...inCompanies, contractorId: { not: null } }, data: { contractorId: null, workPackageId: null } });
  await prisma.dailyLogWorkActivity.updateMany({ where: { ...inCompanies, contractorId: { not: null } }, data: { contractorId: null, workPackageId: null } });
  await prisma.documentTransmittalItem.deleteMany({ where: inCompanies });
  await prisma.documentTransmittal.deleteMany({ where: inCompanies });
  await prisma.rfiReference.deleteMany({ where: inCompanies });
  await prisma.rfiResponse.deleteMany({ where: inCompanies });
  await prisma.rfi.deleteMany({ where: inCompanies });
  await prisma.technicalSubmittal.updateMany({ where: inCompanies, data: { currentRevisionId: null } });
  await prisma.technicalSubmittalRevision.deleteMany({ where: inCompanies });
  await prisma.technicalSubmittal.deleteMany({ where: inCompanies });
  await prisma.engineeringDocument.updateMany({ where: inCompanies, data: { currentRevisionId: null } });
  await prisma.engineeringDocumentRevision.deleteMany({ where: inCompanies });
  await prisma.engineeringDocument.deleteMany({ where: inCompanies });
  await prisma.workPackage.deleteMany({ where: inCompanies });
  await prisma.contractorComplianceItem.deleteMany({ where: inCompanies });
  await prisma.projectContractorAssignment.deleteMany({ where: inCompanies });
  await prisma.contractorContact.deleteMany({ where: inCompanies });
  await prisma.contractorProfile.deleteMany({ where: inCompanies });
}

export async function seedContractorEngineeringRecords(prisma: PrismaClient, members: Members) {
  const id = (key: string) => members.get(key)!;
  const owner = id("user_owner");
  const pm = id("user_pm");
  const engineer = id("user_engineer");
  const architect = id("user_architect");
  const qaqc = id("user_qaqc");
  const hse = id("user_hse");
  const legal = id("user_legal");
  const today = localDate(new Date(), ZONE);
  const day = (offset: number) => new Date(`${addLocalDays(today, offset)}T12:00:00.000Z`);
  const at = (offset: number, hour = 10) => {
    const date = new Date(`${addLocalDays(today, offset)}T00:00:00.000Z`);
    date.setUTCHours(hour);
    return date;
  };
  const S = ENGINEERING_SEED;

  await clear(prisma);
  await prisma.engineeringSettings.upsert({ where: { companyId: COMPANY_A }, update: {}, create: { companyId: COMPANY_A } });

  /* Contractors ------------------------------------------------------------ */
  const contractor = (data: Omit<Prisma.ContractorProfileUncheckedCreateInput, "normalizedName">) => prisma.contractorProfile.create({ data: { ...data, normalizedName: normalizeContractorName(data.legalName) } });
  await contractor({
    id: S.contractors.apex, companyId: COMPANY_A, legalName: "Apex Structural Works sh.p.k.", tradingName: "Apex Structural", registrationNumber: "L91234567A", vatNumber: "AL-L91234567A",
    email: "projects@apex-structural.test", phone: "+355 4 222 1100", website: "apex-structural.test", addressLine1: "Rruga e Durrësit 112", city: "Tirana", countryCode: "AL",
    status: "ACTIVE", statusChangedAt: at(-200), supplierId: "supplier_alba", primaryContactName: "Arben Hoxha", primaryContactEmail: "arben.hoxha@apex-structural.test", primaryContactPhone: "+355 69 400 1122",
    notes: "Frame contractor on Riverside. Also supplies ready-mix concrete through Alba Concrete.", createdByMemberId: pm, createdAt: at(-220),
  });
  await contractor({
    id: S.contractors.brightline, companyId: COMPANY_A, legalName: "Brightline Façades Ltd", registrationNumber: "UK-08812345", vatNumber: "GB 881 2345 00",
    email: "delivery@brightline-facades.test", phone: "+44 20 7946 0012", city: "London", countryCode: "GB", status: "ACTIVE", statusChangedAt: at(-150),
    primaryContactName: "James Whitfield", primaryContactEmail: "j.whitfield@brightline-facades.test", createdByMemberId: legal, createdAt: at(-160),
  });
  await contractor({
    id: S.contractors.northgate, companyId: COMPANY_A, legalName: "Northgate MEP Services S.r.l.", tradingName: "Northgate MEP", vatNumber: "IT 02345670981",
    email: "bids@northgate-mep.test", city: "Bari", countryCode: "IT", status: "PROSPECTIVE", statusChangedAt: at(-12), primaryContactName: "Marco Bellini", createdByMemberId: pm, createdAt: at(-12),
  });
  await contractor({
    id: S.contractors.ironbridge, companyId: COMPANY_A, legalName: "Ironbridge Groundworks", registrationNumber: "L81122334B", city: "Durrës", countryCode: "AL",
    status: "OFFBOARDED", statusChangedAt: at(-40), statusReason: "Groundworks completed early; no further scope.", createdByMemberId: pm, createdAt: at(-400),
  });
  await contractor({ id: S.contractors.companyB, companyId: COMPANY_B, legalName: "Isar Bau GmbH", registrationNumber: "HRB 204711", city: "Munich", countryCode: "DE", status: "ACTIVE", createdByMemberId: id("user_owner_b") });

  await prisma.contractorContact.createMany({
    data: [
      { id: "contact_apex_arben", companyId: COMPANY_A, contractorId: S.contractors.apex, name: "Arben Hoxha", roleTitle: "Project manager", contactRole: "PROJECT_MANAGER", email: "arben.hoxha@apex-structural.test", phone: "+355 69 400 1122" },
      { id: "contact_apex_elira", companyId: COMPANY_A, contractorId: S.contractors.apex, name: "Elira Kola", roleTitle: "Document controller", contactRole: "DOCUMENT_CONTROLLER", email: "docs@apex-structural.test" },
      { id: "contact_apex_gent", companyId: COMPANY_A, contractorId: S.contractors.apex, name: "Gent Rama", roleTitle: "HSE lead", contactRole: "HSE", phone: "+355 69 400 3344" },
      { id: "contact_brightline_james", companyId: COMPANY_A, contractorId: S.contractors.brightline, name: "James Whitfield", roleTitle: "Façade engineer", contactRole: "ENGINEER", email: "j.whitfield@brightline-facades.test" },
      { id: "contact_northgate_marco", companyId: COMPANY_A, contractorId: S.contractors.northgate, name: "Marco Bellini", roleTitle: "Commercial director", contactRole: "COMMERCIAL", email: "m.bellini@northgate-mep.test" },
    ],
  });

  /* Assignments and work packages ------------------------------------------ */
  await prisma.projectContractorAssignment.createMany({
    data: [
      { id: S.assignments.apexRiverside, companyId: COMPANY_A, projectId: RIVERSIDE, contractorId: S.contractors.apex, status: "ACTIVE", scopeSummary: "Structural concrete frame, slabs and cores for Blocks A and B.", internalManagerMemberId: pm, primaryContractorContactId: "contact_apex_arben", startDate: day(-150), endDate: day(160), createdByMemberId: pm, createdAt: at(-160) },
      { id: S.assignments.brightlineRiverside, companyId: COMPANY_A, projectId: RIVERSIDE, contractorId: S.contractors.brightline, status: "ACTIVE", scopeSummary: "Curtain wall and rainscreen cladding — design, supply and installation.", contractId: "contract_009", internalManagerMemberId: pm, primaryContractorContactId: "contact_brightline_james", startDate: day(-60), endDate: day(210), createdByMemberId: pm, createdAt: at(-70) },
      { id: S.assignments.apexTower, companyId: COMPANY_A, projectId: TOWER, contractorId: S.contractors.apex, status: "PLANNED", scopeSummary: "Basement retaining walls and ground-bearing slab.", internalManagerMemberId: pm, startDate: day(45), createdByMemberId: pm, createdAt: at(-10) },
      { id: S.assignments.ironbridgeRiverside, companyId: COMPANY_A, projectId: RIVERSIDE, contractorId: S.contractors.ironbridge, status: "TERMINATED", scopeSummary: "Bulk excavation and bored piling.", internalManagerMemberId: pm, startDate: day(-320), endDate: day(-45), terminatedAt: at(-45), terminationReason: "Groundworks completed early; the remaining landscaping scope moved to the main contractor.", terminatedByMemberId: pm, createdByMemberId: pm, createdAt: at(-330) },
      { id: S.assignments.companyB, companyId: COMPANY_B, projectId: "project_b_one", contractorId: S.contractors.companyB, status: "ACTIVE", scopeSummary: "Dry lining and partitions.", createdByMemberId: id("user_owner_b") },
    ],
  });

  await prisma.workPackage.createMany({
    data: [
      { id: S.workPackages.frame, companyId: COMPANY_A, projectId: RIVERSIDE, contractorId: S.contractors.apex, projectContractorAssignmentId: S.assignments.apexRiverside, code: "WP-001", name: "Structural frame — Blocks A & B", description: "Columns, slabs, cores and stairs from level 1 to the roof.", discipline: "STRUCTURAL", status: "ACTIVE", responsibleMemberId: engineer, plannedStartDate: day(-140), plannedFinishDate: day(60), forecastStartDate: day(-140), forecastFinishDate: day(72), actualStartDate: day(-138), value: new Prisma.Decimal("1850000.00"), currency: "EUR", createdByMemberId: pm, createdAt: at(-150) },
      { id: S.workPackages.facade, companyId: COMPANY_A, projectId: RIVERSIDE, contractorId: S.contractors.brightline, projectContractorAssignmentId: S.assignments.brightlineRiverside, code: "WP-002", name: "Façade — curtain wall and cladding", description: "Unitised curtain wall to Block A, rainscreen cladding to Block B.", discipline: "FACADE", status: "AT_RISK", contractId: "contract_009", responsibleMemberId: architect, plannedStartDate: day(-30), plannedFinishDate: day(150), forecastStartDate: day(-10), forecastFinishDate: day(185), value: new Prisma.Decimal("920000.00"), currency: "EUR", createdByMemberId: pm, createdAt: at(-65) },
      { id: S.workPackages.groundworks, companyId: COMPANY_A, projectId: RIVERSIDE, contractorId: S.contractors.ironbridge, projectContractorAssignmentId: S.assignments.ironbridgeRiverside, code: "WP-003", name: "Groundworks and piling", discipline: "CIVIL", status: "COMPLETED", responsibleMemberId: engineer, plannedStartDate: day(-310), plannedFinishDate: day(-40), actualStartDate: day(-305), actualFinishDate: day(-48), completedAt: at(-48), completedByMemberId: pm, createdByMemberId: pm, createdAt: at(-320) },
      { id: S.workPackages.towerBasement, companyId: COMPANY_A, projectId: TOWER, contractorId: S.contractors.apex, projectContractorAssignmentId: S.assignments.apexTower, code: "WP-001", name: "Basement retaining walls", discipline: "STRUCTURAL", status: "PLANNED", responsibleMemberId: pm, plannedStartDate: day(45), plannedFinishDate: day(140), createdByMemberId: pm, createdAt: at(-9) },
    ],
  });

  /* Compliance --------------------------------------------------------------- */
  await seedStoredDocument(prisma, { id: "doc_compliance_apex_insurance", companyId: COMPANY_A, name: "Apex CAR insurance certificate 2026.pdf", module: "contractors", entityType: "contractor_compliance", entityId: S.compliance.apexInsurance, uploadedByMemberId: legal, createdBy: "user_legal" });
  await seedStoredDocument(prisma, { id: "doc_contractor_apex_licence", companyId: COMPANY_A, name: "Apex construction licence Class A.pdf", module: "contractors", entityType: "contractor", entityId: S.contractors.apex, uploadedByMemberId: legal, createdBy: "user_legal" });
  await seedStoredDocument(prisma, { id: "doc_contractor_brightline_bond", companyId: COMPANY_A, name: "Brightline performance bond.pdf", module: "contractors", entityType: "contractor", entityId: S.contractors.brightline, uploadedByMemberId: legal, createdBy: "user_legal" });
  await prisma.contractorComplianceItem.createMany({
    data: [
      { id: S.compliance.apexInsurance, companyId: COMPANY_A, contractorId: S.contractors.apex, type: "INSURANCE", title: "Contractor's all-risk insurance", status: "EXPIRING", documentId: "doc_compliance_apex_insurance", issuedAt: day(-351), expiresAt: day(14), issuer: "Sigal Uniqa Group", referenceNumber: "CAR-2025-44810", statusChangedAt: at(-16), createdByMemberId: legal, createdAt: at(-350) },
      { id: S.compliance.apexLicence, companyId: COMPANY_A, contractorId: S.contractors.apex, type: "LICENSE", title: "Construction licence — Class A", status: "VALID", documentId: "doc_contractor_apex_licence", issuedAt: day(-65), expiresAt: day(300), issuer: "National Licensing Centre", referenceNumber: "NLC-A-7781", createdByMemberId: legal, createdAt: at(-60) },
      { id: S.compliance.brightlineBond, companyId: COMPANY_A, contractorId: S.contractors.brightline, type: "PERFORMANCE_GUARANTEE", title: "Performance bond — 10% of contract value", status: "EXPIRED", documentId: "doc_contractor_brightline_bond", issuedAt: day(-370), expiresAt: day(-5), issuer: "Barclays Bank", referenceNumber: "PB-88120", statusChangedAt: at(-4), createdByMemberId: legal, createdAt: at(-365) },
      { id: S.compliance.brightlineHse, companyId: COMPANY_A, contractorId: S.contractors.brightline, type: "HSE_CERTIFICATION", title: "ISO 45001 certificate", status: "MISSING", notes: "Requested at the pre-start meeting; not yet received.", createdByMemberId: hse, createdAt: at(-20) },
      { id: S.compliance.northgateTax, companyId: COMPANY_A, contractorId: S.contractors.northgate, type: "TAX_DOCUMENT", title: "Tax compliance certificate", status: "VALID", issuedAt: day(-30), expiresAt: day(90), issuer: "Agenzia delle Entrate", createdByMemberId: legal, createdAt: at(-11) },
    ],
  });

  /* Engineering documents and revisions ------------------------------------ */
  const file = (docId: string, name: string, entityType: string, entityId: string, uploadedBy: string, createdBy: string) =>
    seedStoredDocument(prisma, { id: docId, companyId: COMPANY_A, name, projectId: RIVERSIDE, module: "engineering", entityType, entityId, uploadedByMemberId: uploadedBy, createdBy });

  await prisma.engineeringDocument.createMany({
    data: [
      { id: S.documents.floorPlan, companyId: COMPANY_A, projectId: RIVERSIDE, documentNumber: "ARC-SD-023", title: "Level 3 floor plan — Block A", documentType: "DRAWING", discipline: "ARCHITECTURE", status: "APPROVED", authorText: "Studio Rossi", responsibleMemberId: architect, reviewerMemberId: architect, reviewDueAt: day(-12), createdByMemberId: engineer, createdAt: at(-40) },
      { id: S.documents.transferSlab, companyId: COMPANY_A, projectId: RIVERSIDE, contractorId: S.contractors.apex, workPackageId: S.workPackages.frame, documentNumber: "STR-CALC-011", title: "Transfer slab calculation — Level 1", documentType: "CALCULATION", discipline: "STRUCTURAL", status: "SUBMITTED", authorText: "Apex design office", responsibleMemberId: pm, reviewerMemberId: engineer, reviewDueAt: day(-2), createdByMemberId: pm, createdAt: at(-12) },
      { id: S.documents.curtainWall, companyId: COMPANY_A, projectId: RIVERSIDE, contractorId: S.contractors.brightline, workPackageId: S.workPackages.facade, documentNumber: "FAC-SD-004", title: "Curtain wall typical bay — shop drawing", documentType: "SHOP_DRAWING", discipline: "FACADE", status: "UNDER_REVIEW", authorText: "Brightline Façades", responsibleMemberId: pm, reviewerMemberId: architect, reviewDueAt: day(3), createdByMemberId: pm, createdAt: at(-6) },
      { id: S.documents.ventilation, companyId: COMPANY_A, projectId: RIVERSIDE, documentNumber: "MEP-SPEC-002", title: "Ventilation specification", documentType: "SPECIFICATION", discipline: "MECHANICAL", status: "DRAFT", responsibleMemberId: engineer, createdByMemberId: engineer, createdAt: at(-3) },
    ],
  });
  await file("doc_eng_arc_sd_023_a", "ARC-SD-023 Rev A.pdf", "engineering_document", S.documents.floorPlan, engineer, "user_engineer");
  await file("doc_eng_arc_sd_023_b", "ARC-SD-023 Rev B.pdf", "engineering_document", S.documents.floorPlan, engineer, "user_engineer");
  await file("doc_eng_arc_sd_023_c", "ARC-SD-023 Rev C.pdf", "engineering_document", S.documents.floorPlan, engineer, "user_engineer");
  await file("doc_eng_str_calc_011_01", "STR-CALC-011 Rev 01.pdf", "engineering_document", S.documents.transferSlab, pm, "user_pm");
  await file("doc_eng_fac_sd_004_p01", "FAC-SD-004 Rev P01.pdf", "engineering_document", S.documents.curtainWall, pm, "user_pm");
  await prisma.engineeringDocumentRevision.createMany({
    data: [
      { id: "engrev_arc_sd_023_a", companyId: COMPANY_A, engineeringDocumentId: S.documents.floorPlan, revisionCode: "A", revisionNumber: 1, documentId: "doc_eng_arc_sd_023_a", status: "SUPERSEDED", submittedAt: at(-38), submittedByMemberId: engineer, reviewStartedAt: at(-37), reviewedAt: at(-35), reviewedByMemberId: architect, reviewDecision: "REVISION_REQUIRED", reviewComment: "Stair core dimensions do not match the structural grid. Coordinate with STR-GA-004.", supersededAt: at(-14), createdByMemberId: engineer, createdAt: at(-39) },
      { id: "engrev_arc_sd_023_b", companyId: COMPANY_A, engineeringDocumentId: S.documents.floorPlan, revisionCode: "B", revisionNumber: 2, documentId: "doc_eng_arc_sd_023_b", status: "SUPERSEDED", submittedAt: at(-30), submittedByMemberId: engineer, reviewStartedAt: at(-29), reviewedAt: at(-27), reviewedByMemberId: architect, reviewDecision: "APPROVED_WITH_COMMENTS", reviewComment: "Approved. Show the door swing to apartment A3.04 on the next issue.", supersededAt: at(-14), createdByMemberId: engineer, createdAt: at(-31) },
      { id: "engrev_arc_sd_023_c", companyId: COMPANY_A, engineeringDocumentId: S.documents.floorPlan, revisionCode: "C", revisionNumber: 3, documentId: "doc_eng_arc_sd_023_c", status: "FINALIZED", submittedAt: at(-16), submittedByMemberId: engineer, reviewStartedAt: at(-15), reviewedAt: at(-14), reviewedByMemberId: architect, reviewDecision: "APPROVED", createdByMemberId: engineer, createdAt: at(-17) },
      { id: "engrev_str_calc_011_01", companyId: COMPANY_A, engineeringDocumentId: S.documents.transferSlab, revisionCode: "01", revisionNumber: 1, documentId: "doc_eng_str_calc_011_01", status: "SUBMITTED", submittedAt: at(-9), submittedByMemberId: pm, createdByMemberId: pm, createdAt: at(-10) },
      { id: "engrev_fac_sd_004_p01", companyId: COMPANY_A, engineeringDocumentId: S.documents.curtainWall, revisionCode: "P01", revisionNumber: 1, documentId: "doc_eng_fac_sd_004_p01", status: "UNDER_REVIEW", submittedAt: at(-5), submittedByMemberId: pm, reviewStartedAt: at(-2), createdByMemberId: pm, createdAt: at(-6) },
    ],
  });
  await prisma.engineeringDocument.update({ where: { id: S.documents.floorPlan }, data: { currentRevisionId: "engrev_arc_sd_023_c" } });
  await prisma.engineeringDocument.update({ where: { id: S.documents.transferSlab }, data: { currentRevisionId: "engrev_str_calc_011_01" } });
  await prisma.engineeringDocument.update({ where: { id: S.documents.curtainWall }, data: { currentRevisionId: "engrev_fac_sd_004_p01" } });

  /* RFIs ------------------------------------------------------------------- */
  await prisma.rfi.createMany({
    data: [
      { id: S.rfis.slabEdge, companyId: COMPANY_A, projectId: RIVERSIDE, contractorId: S.contractors.apex, workPackageId: S.workPackages.frame, rfiNumber: "RFI-001", subject: "Slab edge detail at grid C/4", question: "The slab edge at grid C/4 on level 3 conflicts with the curtain wall bracket zone shown on FAC-SD-004. Please confirm the slab edge setback and whether the edge beam can be reduced to 450 mm.", discipline: "STRUCTURAL", status: "OPEN", priority: "HIGH", raisedByText: "Arben Hoxha, Apex Structural", raisedByMemberId: engineer, assignedToMemberId: architect, dueAt: day(-1), openedAt: at(-8), createdByMemberId: engineer, createdAt: at(-8) },
      { id: S.rfis.bracket, companyId: COMPANY_A, projectId: RIVERSIDE, contractorId: S.contractors.brightline, workPackageId: S.workPackages.facade, rfiNumber: "RFI-002", subject: "Curtain wall bracket spacing", question: "Can the bracket spacing on the typical bay increase from 1200 mm to 1500 mm to suit the mullion module?", discipline: "FACADE", status: "ANSWERED", priority: "NORMAL", raisedByText: "James Whitfield, Brightline", raisedByMemberId: engineer, assignedToMemberId: architect, dueAt: day(2), openedAt: at(-6), answeredAt: at(-2), createdByMemberId: engineer, createdAt: at(-6) },
      { id: S.rfis.fireStopping, companyId: COMPANY_A, projectId: RIVERSIDE, rfiNumber: "RFI-003", subject: "Fire stopping at service risers", question: "Which fire stopping system is specified for the service riser penetrations at each floor?", discipline: "FIRE_PROTECTION", status: "CLOSED", priority: "NORMAL", raisedByMemberId: engineer, assignedToMemberId: architect, dueAt: day(-20), openedAt: at(-30), answeredAt: at(-24), closedAt: at(-22), closureNote: "Specification clause 07 84 00 applies; confirmed on site.", createdByMemberId: engineer, createdAt: at(-30) },
      { id: S.rfis.parapet, companyId: COMPANY_A, projectId: RIVERSIDE, workPackageId: S.workPackages.frame, contractorId: S.contractors.apex, rfiNumber: "RFI-004", subject: "Parapet waterproofing upstand height", question: "The roof build-up leaves 120 mm of upstand at the parapet. Is 150 mm required?", discipline: "ARCHITECTURE", status: "DRAFT", priority: "LOW", raisedByMemberId: engineer, createdByMemberId: engineer, createdAt: at(-1) },
      { id: S.rfis.tower, companyId: COMPANY_A, projectId: TOWER, contractorId: S.contractors.apex, rfiNumber: "RFI-001", subject: "Existing basement wall condition", question: "Survey shows spalling on the existing party wall. Should it be repaired before the new retaining wall is cast?", discipline: "STRUCTURAL", status: "OPEN", priority: "NORMAL", raisedByMemberId: pm, assignedToMemberId: pm, dueAt: day(5), openedAt: at(-2), createdByMemberId: pm, createdAt: at(-2) },
    ],
  });
  await prisma.rfiResponse.createMany({
    data: [
      { id: "rfiresp_bracket_1", companyId: COMPANY_A, rfiId: S.rfis.bracket, responseText: "Yes — 1500 mm is acceptable on the typical bay, provided the corner bays stay at 1200 mm. Update FAC-SD-004 at the next revision.", respondedByMemberId: architect, respondedAt: at(-2), finalResponse: true },
      { id: "rfiresp_fire_1", companyId: COMPANY_A, rfiId: S.rfis.fireStopping, responseText: "Use the intumescent collar system in specification clause 07 84 00, with a 2-hour rating at every floor.", respondedByMemberId: architect, respondedAt: at(-24), finalResponse: true },
    ],
  });
  await prisma.rfiReference.createMany({
    data: [
      { id: "rfiref_slab_drawing", companyId: COMPANY_A, rfiId: S.rfis.slabEdge, referenceType: "DRAWING", referenceId: S.documents.floorPlan, note: "Level 3 plan, grid C/4", createdByMemberId: engineer },
      { id: "rfiref_slab_shop", companyId: COMPANY_A, rfiId: S.rfis.slabEdge, referenceType: "ENGINEERING_DOCUMENT", referenceId: S.documents.curtainWall, createdByMemberId: engineer },
      { id: "rfiref_bracket_submittal", companyId: COMPANY_A, rfiId: S.rfis.bracket, referenceType: "SUBMITTAL", referenceId: S.submittals.curtainWall, createdByMemberId: engineer },
    ],
  });

  /* Submittals -------------------------------------------------------------- */
  await prisma.technicalSubmittal.createMany({
    data: [
      { id: S.submittals.curtainWall, companyId: COMPANY_A, projectId: RIVERSIDE, contractorId: S.contractors.brightline, workPackageId: S.workPackages.facade, submittalNumber: "SUB-001", title: "Curtain wall system — Schüco FWS 50", description: "System data, thermal performance and finish samples for the Block A curtain wall.", submittalType: "MATERIAL_SUBMITTAL", discipline: "FACADE", status: "REVISION_REQUIRED", assignedReviewerMemberId: architect, dueAt: day(-4), specificationReference: "08 44 13 — Glazed curtain walls", manufacturer: "Schüco", productName: "FWS 50", modelNumber: "FWS 50.HI", supplierId: "supplier_buildpro", createdByMemberId: pm, createdAt: at(-15) },
      { id: S.submittals.crane, companyId: COMPANY_A, projectId: RIVERSIDE, contractorId: S.contractors.apex, workPackageId: S.workPackages.frame, submittalNumber: "SUB-002", title: "Method statement — tower crane erection", submittalType: "METHOD_STATEMENT", discipline: "STRUCTURAL", status: "SUBMITTED", assignedReviewerMemberId: hse, dueAt: day(-1), activity: "Tower crane erection and load test", workArea: "Block B core", createdByMemberId: pm, createdAt: at(-7) },
      { id: S.submittals.rebar, companyId: COMPANY_A, projectId: RIVERSIDE, contractorId: S.contractors.apex, workPackageId: S.workPackages.frame, submittalNumber: "SUB-003", title: "Reinforcement bar — B500C mill certificates", submittalType: "MATERIAL_SUBMITTAL", discipline: "STRUCTURAL", status: "APPROVED", assignedReviewerMemberId: qaqc, dueAt: day(-18), specificationReference: "03 21 00 — Reinforcement steel", manufacturer: "Kurum Steel", productName: "B500C rebar", supplierId: "supplier_nordsteel", createdByMemberId: pm, createdAt: at(-25) },
      { id: S.submittals.ductwork, companyId: COMPANY_A, projectId: RIVERSIDE, submittalNumber: "SUB-004", title: "Ventilation ductwork shop drawings", submittalType: "SHOP_DRAWING", discipline: "MECHANICAL", status: "DRAFT", createdByMemberId: engineer, createdAt: at(-1) },
    ],
  });
  await file("doc_sub_001_a", "SUB-001 Rev A — Schüco FWS 50 data.pdf", "technical_submittal", S.submittals.curtainWall, pm, "user_pm");
  await file("doc_sub_002_01", "SUB-002 Rev 01 — crane method statement.pdf", "technical_submittal", S.submittals.crane, pm, "user_pm");
  await file("doc_sub_003_a", "SUB-003 Rev A — mill certificates.pdf", "technical_submittal", S.submittals.rebar, pm, "user_pm");
  await prisma.technicalSubmittalRevision.createMany({
    data: [
      { id: "subrev_001_a", companyId: COMPANY_A, submittalId: S.submittals.curtainWall, revisionCode: "A", revisionNumber: 1, documentId: "doc_sub_001_a", status: "FINALIZED", submittedAt: at(-12), submittedByMemberId: pm, reviewStartedAt: at(-10), reviewedAt: at(-6), reviewedByMemberId: architect, reviewDecision: "REVISION_REQUIRED", reviewComment: "U-value data is for the standard profile, not the .HI profile specified. Resubmit with the .HI thermal report and RAL 7016 samples.", createdByMemberId: pm, createdAt: at(-13) },
      { id: "subrev_002_01", companyId: COMPANY_A, submittalId: S.submittals.crane, revisionCode: "01", revisionNumber: 1, documentId: "doc_sub_002_01", status: "SUBMITTED", submittedAt: at(-6), submittedByMemberId: pm, createdByMemberId: pm, createdAt: at(-7) },
      { id: "subrev_003_a", companyId: COMPANY_A, submittalId: S.submittals.rebar, revisionCode: "A", revisionNumber: 1, documentId: "doc_sub_003_a", status: "FINALIZED", submittedAt: at(-22), submittedByMemberId: pm, reviewStartedAt: at(-21), reviewedAt: at(-19), reviewedByMemberId: qaqc, reviewDecision: "APPROVED", createdByMemberId: pm, createdAt: at(-23) },
    ],
  });
  await prisma.technicalSubmittal.update({ where: { id: S.submittals.curtainWall }, data: { currentRevisionId: "subrev_001_a" } });
  await prisma.technicalSubmittal.update({ where: { id: S.submittals.crane }, data: { currentRevisionId: "subrev_002_01" } });
  await prisma.technicalSubmittal.update({ where: { id: S.submittals.rebar }, data: { currentRevisionId: "subrev_003_a" } });

  /* Transmittals ------------------------------------------------------------ */
  await prisma.documentTransmittal.create({
    data: {
      id: S.transmittals.issued, companyId: COMPANY_A, projectId: RIVERSIDE, transmittalNumber: "TRN-001", direction: "OUTGOING", purpose: "FOR_CONSTRUCTION", status: "ISSUED", subject: "Level 3 architectural plans for construction",
      contractorId: S.contractors.apex, workPackageId: S.workPackages.frame, senderText: "NESTO Riverside design team", recipientText: "Apex Structural Works — document control", issuedAt: day(-13), issuedByMemberId: pm, createdByMemberId: pm, createdAt: at(-13),
      items: { create: [{ companyId: COMPANY_A, engineeringDocumentId: S.documents.floorPlan, engineeringRevisionId: "engrev_arc_sd_023_c", documentId: "doc_eng_arc_sd_023_c", remarks: "Supersedes Rev B", sortOrder: 0 }] },
    },
  });
  await prisma.documentTransmittal.create({
    data: {
      id: S.transmittals.draft, companyId: COMPANY_A, projectId: RIVERSIDE, transmittalNumber: "TRN-002", direction: "OUTGOING", purpose: "FOR_REVIEW", status: "DRAFT", subject: "Façade shop drawings for coordination",
      contractorId: S.contractors.brightline, workPackageId: S.workPackages.facade, recipientText: "Brightline Façades — James Whitfield", createdByMemberId: pm, createdAt: at(-1),
      items: { create: [{ companyId: COMPANY_A, engineeringDocumentId: S.documents.curtainWall, engineeringRevisionId: "engrev_fac_sd_004_p01", documentId: "doc_eng_fac_sd_004_p01", sortOrder: 0 }] },
    },
  });

  /* Links and the site diary ------------------------------------------------ */
  const link = (sourceModule: string, sourceEntityType: string, sourceEntityId: string, targetModule: string, targetEntityType: string, targetEntityId: string) => ({
    companyId: COMPANY_A, integrationType: "ENGINEERING_RECORD", mode: "REFERENCE" as const, sourceModule, sourceEntityType, sourceEntityId, targetModule, targetEntityType, targetEntityId,
    idempotencyKey: `${sourceEntityType}:${sourceEntityId}:${targetEntityType}:${targetEntityId}`, createdByMemberId: pm,
  });
  await prisma.integrationLink.createMany({
    data: [
      link("engineering", "technical_submittal", S.submittals.curtainWall, "engineering", "engineering_document", S.documents.curtainWall),
      link("engineering", "technical_submittal", S.submittals.crane, "hse", "work_permit", "hse_ptw_001"),
      link("contractors", "work_package", S.workPackages.frame, "qaqc", "non_conformance_report", "ncr_001"),
      link("contractors", "work_package", S.workPackages.frame, "hse", "work_permit", "hse_ptw_001"),
    ],
    skipDuplicates: true,
  });
  const concrete = await prisma.dailyLogWorkforceEntry.findFirst({ where: { companyId: COMPANY_A, dailyLogId: "daily_log_riverside_locked", organizationName: "Alba Concrete" }, select: { id: true } });
  if (concrete) await prisma.dailyLogWorkforceEntry.update({ where: { id: concrete.id }, data: { contractorId: S.contractors.apex, workPackageId: S.workPackages.frame } });

  return { contractors: 5, assignments: 5, workPackages: 4, compliance: 5, documents: 4, rfis: 5, submittals: 4, transmittals: 2, owner: Boolean(owner) };
}
