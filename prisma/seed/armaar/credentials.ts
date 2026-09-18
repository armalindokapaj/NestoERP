/**
 * ARMAAR's employee files and qualifications (E-02 §11-§16, §59-§91, §94-§105).
 *
 * Enough of each kind for a presenter to walk HR's day and an employee's:
 *
 *   ARLIS - NDERTIM's civil engineer   contract, degree, a licence to practise
 *                                      that runs out within the month, her CV;
 *                                      the degree and her Civil 3D shared with
 *                                      the group once verified
 *   its site engineer                  a safety certificate renewed last spring
 *                                      (the old one kept, superseded), a truck
 *                                      licence past its date, and a crane
 *                                      signaller's card waiting for HR
 *   its HSE officer                    NEBOSH, and first aid running out
 *   its structural engineer            ETABS added by himself, not yet checked;
 *                                      Italian kept to himself
 *   its QA/QC engineer                 a technician's card HR sent back
 *   BCI's Tirana Lake project manager  contract and its site-allowance
 *                                      amendment, a salary review shared with
 *                                      Finance, PMP
 *   BCI's crane operator and driver    no login: an operator's licence running
 *                                      out, a work permit HR keeps to itself
 *
 * Files are real objects in storage through the seed's own document writer,
 * filed on the employment they belong to; qualifications are the person's,
 * recorded in the company that employs them, with the evidence filed there.
 * Stable ids: a rerun puts every row back as written here and adds nothing.
 */
import { createHash } from "node:crypto";

import type { CredentialVerificationStatus, EmployeeDocumentCategory, EmployeeDocumentVisibility, PrismaClient, QualificationType, QualificationVisibility, SkillProficiency } from "@prisma/client";

import { addDays, dbDay, todayDay } from "../../../lib/modules/hr/employment/employment.dates";
import { seedStoredDocument } from "../document-objects";
import { memberId } from "./access";
import { companyId } from "./organization";
import type { CompanyCode } from "./public-facts";
import { userId } from "./people";
import { ARMAAR_GROUP_ID } from "./records";
import { workerEmploymentId } from "./workforce";

const ALN: CompanyCode = "ARLIS_NDERTIM";
const BCI: CompanyCode = "BUILDING_CONSTRUCTION_INVEST";
const HR_OF: Record<string, string> = { [ALN]: "arlis.hr", [BCI]: "bci.hr" };

type Holder = { employment: string; person: string; company: CompanyCode; login: string | null };

/** A person with a login: their employment where they are employed. */
function staff(username: string, company: CompanyCode): Holder {
  const base = userId(username).replace(/^user_armaar_/, "");
  return { employment: `employee_armaar_${base}`, person: `person_armaar_${base}`, company, login: username };
}

/** A site worker without a login (E-04). */
function worker(key: string, company: CompanyCode): Holder {
  return { employment: workerEmploymentId(key), person: `person_armaar_w_${key}`, company, login: null };
}

const CIVIL = staff("arlis.civil", ALN);
const SITE = staff("arlis.site-engineer", ALN);
const HSE = staff("arlis.hse-officer", ALN);
const STRUCTURAL = staff("arlis.structural", ALN);
const QAQC = staff("arlis.qaqc-engineer", ALN);
const PM = staff("bci.pm", BCI);
const CRANE = worker("bci_20", BCI);
const DRIVER = worker("bci_21", BCI);

type FileSpec = {
  key: string;
  holder: Holder;
  category: EmployeeDocumentCategory;
  title: string;
  file: string;
  visibility?: EmployeeDocumentVisibility;
  status?: CredentialVerificationStatus;
  issuer?: string;
  number?: string;
  /** Days from today. */
  issued?: number;
  expires?: number;
  effectiveFrom?: number;
  /** Uploaded by the holder themselves (a professional file), else by the company's HR. */
  bySelf?: boolean;
  note?: string;
  supersededBy?: string;
  amends?: string;
};

const FILES: FileSpec[] = [
  { key: "civil_contract", holder: CIVIL, category: "EMPLOYMENT_CONTRACT", title: "Employment contract — Civil Engineer", file: "Employment contract — M. Toska.pdf", issued: -1210, effectiveFrom: -1200, issuer: "ARLIS - NDERTIM" },
  { key: "civil_degree", holder: CIVIL, category: "DEGREE", title: "Master of Science in Civil Engineering", file: "MSc diploma — M. Toska.pdf", status: "VERIFIED", issuer: "Polytechnic University of Tirana", issued: -3300, bySelf: true, note: "Checked against the university register." },
  { key: "civil_licence", holder: CIVIL, category: "PROFESSIONAL_LICENSE", title: "Licence to practise — civil works", file: "Licence to practise — M. Toska.pdf", status: "VERIFIED", issuer: "Ministry of Infrastructure and Energy", number: "LP-CW-2021-0412", issued: -1800, expires: 24 },
  { key: "civil_cv", holder: CIVIL, category: "CV", title: "Curriculum vitae", file: "CV — Marsela Toska.pdf", issued: -400, bySelf: true },

  { key: "site_height_2023", holder: SITE, category: "SAFETY_CERTIFICATE", title: "Working at height — 2023", file: "Working at height certificate 2023.pdf", status: "SUPERSEDED", issuer: "Albanian Institute of Occupational Safety", number: "WAH-23-1188", issued: -900, expires: -170, supersededBy: "site_height_2026", visibility: "GROUP_SUMMARY" },
  { key: "site_height_2026", holder: SITE, category: "SAFETY_CERTIFICATE", title: "Working at height", file: "Working at height certificate 2026.pdf", status: "VERIFIED", issuer: "Albanian Institute of Occupational Safety", number: "WAH-26-0407", issued: -175, expires: 555, visibility: "GROUP_SUMMARY" },
  { key: "site_truck", holder: SITE, category: "DRIVING_LICENSE", title: "Driving licence — category C", file: "Driving licence C — T. Ymeri.pdf", status: "EXPIRED", issuer: "DPSHTRR", number: "AL-C-771203", issued: -3650, expires: -5 },
  { key: "site_signaller", holder: SITE, category: "EQUIPMENT_LICENSE", title: "Tower crane signaller card", file: "Crane signaller card — T. Ymeri.jpg", issuer: "ISSH", number: "CS-2026-118", issued: -12, expires: 1083, bySelf: true },

  { key: "hse_nebosh", holder: HSE, category: "PROFESSIONAL_CERTIFICATE", title: "NEBOSH International General Certificate", file: "NEBOSH IGC — N. Gjini.pdf", status: "VERIFIED", issuer: "NEBOSH", number: "00471928", issued: -1400, visibility: "GROUP_SUMMARY" },
  { key: "hse_first_aid", holder: HSE, category: "TRAINING_CERTIFICATE", title: "First aid at work", file: "First aid at work — N. Gjini.pdf", status: "VERIFIED", issuer: "Albanian Red Cross", issued: -1080, expires: 12 },

  { key: "qaqc_card", holder: QAQC, category: "PROFESSIONAL_CERTIFICATE", title: "Concrete field testing technician", file: "Concrete testing card — scan.jpg", status: "REJECTED", issuer: "ACI", issued: -300, expires: 1500, bySelf: true, note: "The scan is cut off at the bottom: upload the whole card, both sides." },

  { key: "pm_contract", holder: PM, category: "EMPLOYMENT_CONTRACT", title: "Employment contract — Project Manager", file: "Employment contract — E. Lamaj.pdf", issued: -1310, effectiveFrom: -1300, issuer: "BUILDING CONSTRUCTION INVEST" },
  { key: "pm_amendment", holder: PM, category: "CONTRACT_AMENDMENT", title: "Amendment — Tirana Lake site allowance", file: "Contract amendment — site allowance.pdf", issued: -200, effectiveFrom: -190, amends: "pm_contract", issuer: "BUILDING CONSTRUCTION INVEST" },
  { key: "pm_salary", holder: PM, category: "SALARY_CHANGE_DOCUMENT", title: "Salary review 2026", file: "Salary review 2026 — E. Lamaj.pdf", visibility: "EMPLOYEE_HR_FINANCE", issued: -60, effectiveFrom: -45 },
  { key: "pm_pmp", holder: PM, category: "PROFESSIONAL_CERTIFICATE", title: "Project Management Professional (PMP)", file: "PMP certificate — E. Lamaj.pdf", status: "VERIFIED", issuer: "Project Management Institute", number: "3318842", issued: -700, expires: 395, visibility: "GROUP_SUMMARY" },

  { key: "crane_operator", holder: CRANE, category: "EQUIPMENT_LICENSE", title: "Tower crane operator licence", file: "Tower crane operator licence — Y. Berisha.pdf", status: "VERIFIED", issuer: "ISSH", number: "TCO-2019-0233", issued: -1820, expires: 8 },
  { key: "driver_permit", holder: DRIVER, category: "WORK_PERMIT", title: "Work and residence permit", file: "Work permit — A. Sinani.pdf", visibility: "HR_ONLY", status: "VERIFIED", issuer: "Ministry of Interior", number: "WP-2025-5521", issued: -380, expires: 40 },
  { key: "driver_licence", holder: DRIVER, category: "DRIVING_LICENSE", title: "Driving licence — category C+E", file: "Driving licence CE — A. Sinani.pdf", status: "VERIFIED", issuer: "DPSHTRR", number: "AL-CE-550187", issued: -2400, expires: 700 },
];

type QualificationSpec = {
  key: string;
  holder: Holder;
  type: QualificationType;
  title: string;
  visibility?: QualificationVisibility;
  status?: CredentialVerificationStatus;
  issuer?: string;
  number?: string;
  issued?: number;
  expires?: number;
  proficiency?: SkillProficiency;
  /** The file it rests on, filed on the holder's employment. */
  evidence?: string;
  bySelf?: boolean;
  note?: string;
  supersededBy?: string;
};

const QUALIFICATIONS: QualificationSpec[] = [
  { key: "civil_msc", holder: CIVIL, type: "DEGREE", title: "MSc Civil Engineering", visibility: "GROUP_SUMMARY", status: "VERIFIED", issuer: "Polytechnic University of Tirana", issued: -3300, evidence: "civil_degree", bySelf: true },
  { key: "civil_licence", holder: CIVIL, type: "PROFESSIONAL_LICENSE", title: "Licensed civil engineer", status: "VERIFIED", issuer: "Ministry of Infrastructure and Energy", number: "LP-CW-2021-0412", issued: -1800, expires: 24, evidence: "civil_licence" },
  { key: "civil_c3d", holder: CIVIL, type: "SKILL", title: "AutoCAD Civil 3D", visibility: "GROUP_SUMMARY", status: "VERIFIED", proficiency: "ADVANCED", bySelf: true },
  { key: "civil_english", holder: CIVIL, type: "LANGUAGE_CERTIFICATE", title: "English — C1", visibility: "GROUP_SUMMARY", status: "VERIFIED", issuer: "British Council", proficiency: "ADVANCED", issued: -2000, bySelf: true },

  { key: "site_height_2023", holder: SITE, type: "SAFETY_CERTIFICATE", title: "Working at height", visibility: "GROUP_SUMMARY", status: "SUPERSEDED", issuer: "Albanian Institute of Occupational Safety", issued: -900, expires: -170, evidence: "site_height_2023", supersededBy: "site_height_2026" },
  { key: "site_height_2026", holder: SITE, type: "SAFETY_CERTIFICATE", title: "Working at height", visibility: "GROUP_SUMMARY", status: "VERIFIED", issuer: "Albanian Institute of Occupational Safety", issued: -175, expires: 555, evidence: "site_height_2026" },
  { key: "site_signaller", holder: SITE, type: "EQUIPMENT_LICENSE", title: "Tower crane signaller", visibility: "GROUP_SUMMARY", issuer: "ISSH", number: "CS-2026-118", issued: -12, expires: 1083, evidence: "site_signaller", bySelf: true },

  { key: "hse_nebosh", holder: HSE, type: "PROFESSIONAL_CERTIFICATE", title: "NEBOSH International General Certificate", visibility: "GROUP_SUMMARY", status: "VERIFIED", issuer: "NEBOSH", issued: -1400, evidence: "hse_nebosh" },
  { key: "hse_first_aid", holder: HSE, type: "TRAINING_CERTIFICATE", title: "First aid at work", visibility: "GROUP_SUMMARY", status: "VERIFIED", issuer: "Albanian Red Cross", issued: -1080, expires: 12, evidence: "hse_first_aid" },

  { key: "structural_etabs", holder: STRUCTURAL, type: "SKILL", title: "ETABS", visibility: "GROUP_SUMMARY", proficiency: "EXPERT", bySelf: true },
  { key: "structural_italian", holder: STRUCTURAL, type: "LANGUAGE_CERTIFICATE", title: "Italian — B2", visibility: "PRIVATE", issuer: "Istituto Italiano di Cultura", proficiency: "INTERMEDIATE", issued: -1500, bySelf: true },
  { key: "structural_degree", holder: STRUCTURAL, type: "DEGREE", title: "BSc Civil Engineering (Structures)", visibility: "GROUP_SUMMARY", status: "VERIFIED", issuer: "Polytechnic University of Tirana", issued: -3100 },

  { key: "qaqc_card", holder: QAQC, type: "PROFESSIONAL_CERTIFICATE", title: "Concrete field testing technician", visibility: "GROUP_SUMMARY", status: "REJECTED", issuer: "ACI", issued: -300, expires: 1500, evidence: "qaqc_card", bySelf: true, note: "The scan is cut off at the bottom: upload the whole card, both sides." },

  { key: "pm_pmp", holder: PM, type: "PROFESSIONAL_CERTIFICATE", title: "Project Management Professional (PMP)", visibility: "GROUP_SUMMARY", status: "VERIFIED", issuer: "Project Management Institute", issued: -700, expires: 395, evidence: "pm_pmp" },
  { key: "pm_primavera", holder: PM, type: "SKILL", title: "Primavera P6", visibility: "GROUP_SUMMARY", status: "VERIFIED", proficiency: "ADVANCED", bySelf: true },

  { key: "crane_operator", holder: CRANE, type: "EQUIPMENT_LICENSE", title: "Tower crane operator", status: "VERIFIED", issuer: "ISSH", issued: -1820, expires: 8, evidence: "crane_operator" },
  { key: "driver_ce", holder: DRIVER, type: "DRIVING_LICENSE", title: "Driving licence — C+E", status: "VERIFIED", issuer: "DPSHTRR", issued: -2400, expires: 700, evidence: "driver_licence" },
];

const fileId = (key: string) => `armaar_hrdoc_${key}`;
const linkId = (key: string) => `armaar_edl_${key}`;
const qualificationId = (key: string) => `armaar_pq_${key}`;
/** The id the storage seed gives a document's first version, so a verified file is not "new since verification". */
const firstVersionId = (documentId: string) => `dver_${createHash("md5").update(`${documentId}:1`).digest("hex").slice(0, 24)}`;

function day(offset: number | undefined): Date | null {
  return offset === undefined ? null : dbDay(addDays(todayDay(), offset));
}

function checked(status: CredentialVerificationStatus): boolean {
  return status === "VERIFIED" || status === "EXPIRED" || status === "SUPERSEDED" || status === "REJECTED";
}

export async function seedArmaarCredentials(prisma: PrismaClient): Promise<{ documents: number; qualifications: number }> {
  const hrMember = (holder: Holder) => memberId(HR_OF[holder.company]!, holder.company);
  const uploader = (holder: Holder, bySelf: boolean | undefined) => (bySelf && holder.login ? holder.login : HR_OF[holder.company]!);

  /* The files, then what each is to HR ---------------------------------------- */
  for (const spec of FILES) {
    const by = uploader(spec.holder, spec.bySelf);
    await seedStoredDocument(prisma, {
      id: fileId(spec.key),
      companyId: companyId(spec.holder.company),
      name: spec.file,
      module: "hr",
      entityType: "employee",
      entityId: spec.holder.employment,
      uploadedByMemberId: memberId(by, spec.holder.company),
      createdBy: userId(by),
    });
  }
  for (const spec of FILES) {
    const status = spec.status ?? "UNVERIFIED";
    const verifier = checked(status) ? hrMember(spec.holder) : null;
    const data = {
      companyId: companyId(spec.holder.company),
      employeeProfileId: spec.holder.employment,
      documentId: fileId(spec.key),
      category: spec.category,
      title: spec.title,
      visibility: spec.visibility ?? (spec.category === "SALARY_CHANGE_DOCUMENT" ? "EMPLOYEE_HR_FINANCE" : "EMPLOYEE_AND_HR"),
      verificationStatus: status,
      issuer: spec.issuer ?? null,
      documentNumber: spec.number ?? null,
      issueDate: day(spec.issued),
      expiryDate: day(spec.expires),
      effectiveFrom: day(spec.effectiveFrom),
      effectiveTo: null,
      isCurrent: status !== "SUPERSEDED",
      supersededById: null,
      amendsId: null,
      verifiedByMemberId: verifier,
      verifiedAt: verifier ? day((spec.issued ?? -30) + 5) : null,
      verificationNote: spec.note ?? null,
      verifiedDocumentVersionId: status === "VERIFIED" ? firstVersionId(fileId(spec.key)) : null,
      createdByMemberId: memberId(uploader(spec.holder, spec.bySelf), spec.holder.company),
      archivedAt: null,
      archivedByMemberId: null,
      archiveReason: null,
    };
    await prisma.employeeDocumentLink.upsert({ where: { id: linkId(spec.key) }, update: data, create: { id: linkId(spec.key), ...data } });
  }
  // What renews and what amends, once both ends exist.
  for (const spec of FILES.filter((row) => row.supersededBy || row.amends)) {
    await prisma.employeeDocumentLink.update({
      where: { id: linkId(spec.key) },
      data: { supersededById: spec.supersededBy ? linkId(spec.supersededBy) : null, amendsId: spec.amends ? linkId(spec.amends) : null },
    });
  }

  /* The person's qualifications ------------------------------------------------ */
  for (const spec of QUALIFICATIONS) {
    const status = spec.status ?? "UNVERIFIED";
    const verifier = checked(status) ? hrMember(spec.holder) : null;
    const data = {
      parentGroupId: ARMAAR_GROUP_ID,
      personProfileId: spec.holder.person,
      companyId: companyId(spec.holder.company),
      type: spec.type,
      title: spec.title,
      issuer: spec.issuer ?? null,
      documentNumber: spec.number ?? null,
      issueDate: day(spec.issued),
      expiryDate: day(spec.expires),
      proficiency: spec.proficiency ?? null,
      verificationStatus: status,
      visibility: spec.visibility ?? "EMPLOYEE_AND_HR",
      supportingDocumentId: spec.evidence ? fileId(spec.evidence) : null,
      isCurrent: status !== "SUPERSEDED",
      supersededById: null,
      verifiedByMemberId: verifier,
      verifiedAt: verifier ? day((spec.issued ?? -30) + 5) : null,
      verificationNote: spec.note ?? null,
      verifiedDocumentVersionId: status === "VERIFIED" && spec.evidence ? firstVersionId(fileId(spec.evidence)) : null,
      createdByMemberId: memberId(uploader(spec.holder, spec.bySelf), spec.holder.company),
      archivedAt: null,
      archivedByMemberId: null,
      archiveReason: null,
    };
    await prisma.personQualification.upsert({ where: { id: qualificationId(spec.key) }, update: data, create: { id: qualificationId(spec.key), ...data } });
  }
  for (const spec of QUALIFICATIONS.filter((row) => row.supersededBy)) {
    await prisma.personQualification.update({ where: { id: qualificationId(spec.key) }, data: { supersededById: qualificationId(spec.supersededBy!) } });
  }

  return { documents: FILES.length, qualifications: QUALIFICATIONS.length };
}
