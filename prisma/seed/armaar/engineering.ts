/**
 * Tirana Lake's contractors and engineering, deepened (D-02 §24-§28, §65, §74).
 *
 * D-01 appointed Tirana Lake's first five contractors — concrete, façade,
 * electrical, HVAC, finishing — each with a work package and a subcontract.
 * D-02 completes the site: waterproofing and plumbing at work, the lifts signed
 * and not yet started, a landscaping contractor still being evaluated, and two
 * contractors of other companies (Farka Residence's formwork, Gran Melia's
 * frame, out to tender). Every contractor gets the people NESTO talks to.
 *
 * Then the engineering record the product keeps on the project: drawings,
 * calculations, specifications and a method statement, each through its
 * revisions and reviews; RFIs in every state the register shows (draft, open,
 * overdue, answered, waiting for clarification, closed); submittals from a
 * draft sample to approved mill certificates; and the transmittals that issued
 * them. Every revision is a real stored file on its record (PRD #29); a
 * transmittal item names the revision it issued.
 *
 * The contractor chain past its contract — progress, invoice, verification,
 * payment — is E-11's and is not faked (§24, §74). Every value is synthetic.
 * Stable ids; a rerun adds nothing.
 */
import { Prisma, type EngineeringDiscipline, type EngineeringDocumentType, type PrismaClient, type RfiPriority, type RfiStatus, type TechnicalSubmittalType, type TransmittalDirection, type TransmittalPurpose } from "@prisma/client";

import { addLocalDays, localDate } from "../../../lib/modules/calendar/calendar.time";
import { normalizeContractorName } from "../../../lib/modules/contractors/contractor.names";
import { seedStoredDocument } from "../document-objects";
import { memberId } from "./access";
import { contractorId, supplierId } from "./operations";
import { companyId } from "./organization";
import { userId } from "./people";
import { projectId } from "./projects";
import type { CompanyCode, ProjectCode } from "./public-facts";
import { ARMAAR_GROUP_ID } from "./records";

const ZONE = "Europe/Tirane";
const EUR = "EUR";
const BCI = "BUILDING_CONSTRUCTION_INVEST" as const;
const TL = projectId("TIRANA_LAKE");
const money = (value: number) => new Prisma.Decimal(value.toFixed(2));

/** The work package D-01 gave each of its contractors. */
const wpOf = (contractor: string) => `armaar_wp_${contractor}`;

/* Contractors (§24, §25) ---------------------------------------------------- */

type NewContractor = {
  key: string;
  company: CompanyCode;
  project: ProjectCode;
  legalName: string;
  taxId: string;
  /** The same company's supplier record, where it also sells to the company. */
  supplier: string | null;
  status: "ACTIVE" | "PROSPECTIVE";
  trade: string;
  scope: string;
  contacts: Array<{ name: string; title: string; role: "PROJECT_MANAGER" | "ENGINEER" | "SITE_ENGINEER" | "DOCUMENT_CONTROLLER" | "COMMERCIAL" | "HSE" | "QAQC" }>;
  pkg: { code: string; name: string; discipline: EngineeringDiscipline; status: "PLANNED" | "ACTIVE"; value: number; manager: string; start: number; end: number };
  contract: { number: string; status: "IN_REVIEW" | "SIGNED" | "ACTIVE"; signed: number | null } | null;
  compliance: Array<{ type: "INSURANCE" | "LICENSE" | "TAX_DOCUMENT" | "HSE_CERTIFICATION"; title: string; status: "VALID" | "EXPIRING" | "MISSING"; expires?: number; issuer?: string; note?: string }>;
};

const CONTRACTORS: NewContractor[] = [
  {
    key: "hidroizol", company: BCI, project: "TIRANA_LAKE", legalName: "HidroIzol Albania sh.p.k.", taxId: "X90000010K", supplier: "hidroizol", status: "ACTIVE", trade: "Waterproofing",
    scope: "Waterproofing of the basements, the podium roof and every wet area of Towers A and B.",
    contacts: [{ name: "Arlind Gashi", title: "Project manager", role: "PROJECT_MANAGER" }, { name: "Eni Kraja", title: "Site supervisor", role: "SITE_ENGINEER" }],
    pkg: { code: "WP-TL-06", name: "Waterproofing — basements, podium roof and wet areas", discipline: "ARCHITECTURE", status: "ACTIVE", value: 1_450_000, manager: "bci.engineering", start: -80, end: 200 },
    contract: { number: "BCI-SC-2025-006", status: "ACTIVE", signed: -95 },
    compliance: [{ type: "INSURANCE", title: "Contractor's all-risk insurance", status: "VALID", expires: 210, issuer: "Demo Insurance Co." }, { type: "LICENSE", title: "Construction licence — waterproofing works", status: "VALID", expires: 540, issuer: "National Licensing Centre" }],
  },
  {
    key: "aquatek", company: BCI, project: "TIRANA_LAKE", legalName: "AquaTek Instalime sh.p.k.", taxId: "X90000011L", supplier: "aquatek", status: "ACTIVE", trade: "Plumbing",
    scope: "Water supply, drainage and sanitary installations, Towers A and B.",
    contacts: [{ name: "Blerim Hoxha", title: "Contracts manager", role: "COMMERCIAL" }, { name: "Silva Meta", title: "MEP engineer", role: "ENGINEER" }],
    pkg: { code: "WP-TL-07", name: "Plumbing and drainage — Towers A and B", discipline: "PLUMBING", status: "ACTIVE", value: 3_200_000, manager: "arlis.mep", start: -50, end: 400 },
    contract: { number: "BCI-SC-2025-007", status: "ACTIVE", signed: -65 },
    compliance: [{ type: "INSURANCE", title: "Contractor's all-risk insurance", status: "EXPIRING", expires: 18, issuer: "Demo Insurance Co." }, { type: "HSE_CERTIFICATION", title: "ISO 45001 certificate", status: "VALID", expires: 300, issuer: "Demo Certification Body" }],
  },
  {
    key: "liftech", company: BCI, project: "TIRANA_LAKE", legalName: "Liftech Balkans sh.p.k.", taxId: "X90000012M", supplier: "liftech", status: "ACTIVE", trade: "Lifts",
    scope: "Supply, installation and commissioning of eight passenger lifts and two goods lifts.",
    contacts: [{ name: "Dritan Vasili", title: "Project manager", role: "PROJECT_MANAGER" }],
    pkg: { code: "WP-TL-08", name: "Lifts — Towers A and B", discipline: "MECHANICAL", status: "PLANNED", value: 1_900_000, manager: "arlis.mep", start: 60, end: 380 },
    contract: { number: "BCI-SC-2026-008", status: "SIGNED", signed: -12 },
    compliance: [{ type: "INSURANCE", title: "Contractor's all-risk insurance", status: "VALID", expires: 330, issuer: "Demo Insurance Co." }],
  },
  {
    key: "gjelber", company: BCI, project: "TIRANA_LAKE", legalName: "Gjelbër Landscape sh.p.k.", taxId: "X90000021W", supplier: null, status: "PROSPECTIVE", trade: "Landscaping",
    scope: "Hard and soft landscaping, the lakeside promenade and the podium gardens.",
    contacts: [{ name: "Nevila Brahimi", title: "Director", role: "COMMERCIAL" }],
    pkg: { code: "WP-TL-09", name: "Landscape and external works", discipline: "LANDSCAPE", status: "PLANNED", value: 1_100_000, manager: "bci.architect", start: 250, end: 480 },
    contract: { number: "BCI-SC-2026-009", status: "IN_REVIEW", signed: null },
    compliance: [{ type: "TAX_DOCUMENT", title: "Tax compliance certificate", status: "VALID", expires: 75, issuer: "General Directorate of Taxation" }, { type: "INSURANCE", title: "Contractor's all-risk insurance", status: "MISSING", note: "Requested with the tender return." }],
  },
  {
    key: "korca_timber", company: "IDEAL_CONSTRUCTION", project: "FARKA_RESIDENCE", legalName: "Korça Timber sh.p.k.", taxId: "X90000008H", supplier: "korca_timber", status: "ACTIVE", trade: "Formwork",
    scope: "Formwork and falsework for the slabs and columns of Blocks B and C.",
    contacts: [{ name: "Ilir Prendi", title: "Site foreman", role: "SITE_ENGINEER" }],
    pkg: { code: "WP-FR-01", name: "Formwork and falsework — Blocks B and C", discipline: "STRUCTURAL", status: "ACTIVE", value: 640_000, manager: "ideal.site-engineer", start: -120, end: 90 },
    contract: { number: "IDEAL-SC-2026-003", status: "ACTIVE", signed: -130 },
    compliance: [{ type: "INSURANCE", title: "Contractor's all-risk insurance", status: "VALID", expires: 150, issuer: "Demo Insurance Co." }],
  },
  {
    key: "riviera", company: "SARANDA_MARINA_INVEST", project: "GRAN_MELIA", legalName: "Riviera Structures sh.p.k.", taxId: "X90000022X", supplier: null, status: "PROSPECTIVE", trade: "Structural frame",
    scope: "Structural frame of the villas and the hotel block — tender stage.",
    contacts: [{ name: "Gent Laska", title: "Estimator", role: "COMMERCIAL" }],
    pkg: { code: "WP-GM-01", name: "Villas and hotel — structural frame", discipline: "STRUCTURAL", status: "PLANNED", value: 6_800_000, manager: "smi.pm", start: 45, end: 400 },
    contract: null,
    compliance: [{ type: "LICENSE", title: "Construction licence — Class A", status: "MISSING", note: "Asked for with the tender return." }],
  },
];

/** The people NESTO talks to at D-01's five contractors. */
const D01_CONTACTS: Array<{ contractor: string; name: string; title: string; role: "PROJECT_MANAGER" | "ENGINEER" | "DOCUMENT_CONTROLLER" | "COMMERCIAL" | "HSE" }> = [
  { contractor: "albabuild", name: "Arben Muka", title: "Project manager", role: "PROJECT_MANAGER" },
  { contractor: "albabuild", name: "Mirela Duka", title: "Document controller", role: "DOCUMENT_CONTROLLER" },
  { contractor: "albabuild", name: "Tomor Lika", title: "HSE lead", role: "HSE" },
  { contractor: "vlora_glass", name: "Elvis Dura", title: "Façade engineer", role: "ENGINEER" },
  { contractor: "vlora_glass", name: "Brikena Sala", title: "Document controller", role: "DOCUMENT_CONTROLLER" },
  { contractor: "elektronord", name: "Gerta Nushi", title: "Project manager", role: "PROJECT_MANAGER" },
  { contractor: "klimatek", name: "Saimir Hoti", title: "HVAC engineer", role: "ENGINEER" },
  { contractor: "durres_finishing", name: "Fatjona Ziu", title: "Commercial manager", role: "COMMERCIAL" },
];

/* Engineering documents (§29, §65) ------------------------------------------- */

type Review = "APPROVED" | "APPROVED_WITH_COMMENTS" | "REVISION_REQUIRED" | "UNDER_REVIEW" | "SUBMITTED";
type Revision = { code: string; review: Review; day: number; comment?: string };

const DOCUMENTS: Array<{ key: string; number: string; title: string; type: EngineeringDocumentType; discipline: EngineeringDiscipline; contractor?: string; author: string; responsible: string; reviewer?: string; reviewDue?: number; revisions: Revision[] }> = [
  { key: "arc_ga_101", number: "ARC-GA-101", title: "Tower A — general arrangement, levels 1 to 12", type: "DRAWING", discipline: "ARCHITECTURE", author: "UNICO CONSTRUCTION — architecture", responsible: "bci.architect", reviewer: "unico.architect", revisions: [{ code: "A", review: "REVISION_REQUIRED", day: -120, comment: "Stair core B does not sit on the structural grid; coordinate with STR-GA-301." }, { code: "B", review: "APPROVED", day: -95 }] },
  { key: "arc_el_102", number: "ARC-EL-102", title: "Tower B — façade elevations", type: "DRAWING", discipline: "FACADE", contractor: "vlora_glass", author: "UNICO CONSTRUCTION — architecture", responsible: "bci.architect", reviewer: "unico.architect", revisions: [{ code: "A", review: "APPROVED_WITH_COMMENTS", day: -80, comment: "Approved. Show the mullion module at the corner bays on the next issue." }] },
  { key: "str_ga_301", number: "STR-GA-301", title: "Tower A — core walls, general arrangement", type: "DRAWING", discipline: "STRUCTURAL", contractor: "albabuild", author: "ARLIS - NDERTIM — structural engineering", responsible: "arlis.civil", reviewer: "bci.engineering", revisions: [{ code: "A", review: "REVISION_REQUIRED", day: -150, comment: "Openings at level 9 clash with the MEP risers." }, { code: "B", review: "APPROVED_WITH_COMMENTS", day: -110, comment: "Approved; confirm the lintel sizes at the next issue." }, { code: "C", review: "APPROVED", day: -60 }] },
  { key: "str_calc_305", number: "STR-CALC-305", title: "Podium transfer slab — calculation", type: "CALCULATION", discipline: "STRUCTURAL", contractor: "albabuild", author: "ARLIS - NDERTIM — structural engineering", responsible: "arlis.civil", reviewer: "bci.engineering", reviewDue: 2, revisions: [{ code: "01", review: "REVISION_REQUIRED", day: -40, comment: "Punching shear at column C7 is not checked for the revised plant load." }, { code: "02", review: "UNDER_REVIEW", day: -6 }] },
  { key: "mep_sld_401", number: "MEP-SLD-401", title: "Electrical single-line diagram — Towers A and B", type: "DRAWING", discipline: "ELECTRICAL", contractor: "elektronord", author: "ElektroNord design office", responsible: "arlis.mep", reviewer: "bci.engineering", reviewDue: 5, revisions: [{ code: "01", review: "SUBMITTED", day: -4 }] },
  { key: "mep_hvac_402", number: "MEP-HVAC-402", title: "Tower B plant room — HVAC layout", type: "DRAWING", discipline: "MECHANICAL", contractor: "klimatek", author: "KlimaTek design office", responsible: "arlis.mep", reviewer: "bci.engineering", revisions: [{ code: "P01", review: "REVISION_REQUIRED", day: -9, comment: "Access clearance to AHU-3 is below the manufacturer's minimum; relocate it." }] },
  { key: "fac_sd_210", number: "FAC-SD-210", title: "Curtain wall — typical bay and bracket shop drawing", type: "SHOP_DRAWING", discipline: "FACADE", contractor: "vlora_glass", author: "Vlora Glass Systems", responsible: "bci.architect", reviewer: "unico.architect", reviewDue: 3, revisions: [{ code: "A", review: "REVISION_REQUIRED", day: -35, comment: "Bracket spacing to suit the 1,500 mm module — see RFI-001." }, { code: "B", review: "REVISION_REQUIRED", day: -18, comment: "The thermal break is missing at the slab edge." }, { code: "C", review: "UNDER_REVIEW", day: -4 }] },
  { key: "plb_spec_501", number: "PLB-SPEC-501", title: "Plumbing and drainage specification", type: "SPECIFICATION", discipline: "PLUMBING", contractor: "aquatek", author: "AquaTek Instalime", responsible: "arlis.mep", revisions: [] },
  { key: "fin_spec_601", number: "FIN-SPEC-601", title: "Apartment finishes schedule — Tower A", type: "SPECIFICATION", discipline: "INTERIORS", contractor: "durres_finishing", author: "UNICO CONSTRUCTION — interiors", responsible: "bci.architect", reviewer: "unico.architect", revisions: [{ code: "A", review: "APPROVED", day: -45 }] },
  { key: "wpr_det_701", number: "WPR-DET-701", title: "Basement and podium waterproofing details", type: "DRAWING", discipline: "ARCHITECTURE", contractor: "hidroizol", author: "HidroIzol Albania", responsible: "bci.engineering", reviewer: "arlis.civil", revisions: [{ code: "A", review: "APPROVED", day: -85 }] },
  { key: "lnd_ga_801", number: "LND-GA-801", title: "External works and landscape — general arrangement", type: "DRAWING", discipline: "LANDSCAPE", author: "UNICO CONSTRUCTION — landscape", responsible: "bci.architect", revisions: [] },
  { key: "str_ms_310", number: "STR-MS-310", title: "Tower crane climbing — method statement", type: "METHOD_STATEMENT", discipline: "STRUCTURAL", contractor: "albabuild", author: "AlbaBuild site management", responsible: "arlis.site-engineer", reviewer: "arlis.hse", revisions: [{ code: "01", review: "APPROVED", day: -70 }] },
];

/* RFIs (§26) ---------------------------------------------------------------- */

const RFIS: Array<{ number: string; subject: string; question: string; discipline: EngineeringDiscipline; contractor?: string; status: RfiStatus; priority: RfiPriority; raisedBy: string; raisedByText?: string; assignee?: string; opened: number; due?: number; answered?: number; closed?: number; answer?: string; closure?: string; references?: Array<{ type: "DRAWING" | "ENGINEERING_DOCUMENT" | "SUBMITTAL"; key: string; note?: string }> }> = [
  { number: "RFI-001", subject: "Façade anchor detail at the slab edge", question: "Can the curtain wall anchors at the Tower B slab edges move to a 1,500 mm spacing to suit the mullion module, with the corner bays kept at 1,200 mm?", discipline: "FACADE", contractor: "vlora_glass", status: "ANSWERED", priority: "HIGH", raisedBy: "arlis.site-engineer", raisedByText: "Elvis Dura, Vlora Glass Systems", assignee: "bci.architect", opened: -20, due: -13, answered: -15, answer: "Yes, 1,500 mm on the typical bays; keep 1,200 mm at the corners and at the expansion joints. Show it on FAC-SD-210 at the next revision.", references: [{ type: "DRAWING", key: "fac_sd_210" }] },
  { number: "RFI-002", subject: "MEP shaft clearance at Tower A level 7", question: "The riser shaft at grid D/5 on level 7 leaves 80 mm for the insulation of the chilled-water pipes, against 120 mm specified. Can the shaft widen into the corridor ceiling void?", discipline: "MECHANICAL", contractor: "klimatek", status: "OPEN", priority: "HIGH", raisedBy: "arlis.mep", raisedByText: "Saimir Hoti, KlimaTek", assignee: "bci.engineering", opened: -9, due: -2 },
  { number: "RFI-003", subject: "Waterproofing termination detail at the podium upstand", question: "Where does the membrane terminate on the podium upstand behind the retail frontage — under the stone cladding or turned into the reglet?", discipline: "ARCHITECTURE", contractor: "hidroizol", status: "CLOSED", priority: "NORMAL", raisedBy: "bci.engineering", raisedByText: "Arlind Gashi, HidroIzol Albania", assignee: "bci.architect", opened: -66, due: -60, answered: -61, closed: -55, answer: "Turn it into the reglet 150 mm above the finished terrace level and seal it; the cladding is fixed after the flood test.", closure: "Detail added to WPR-DET-701; confirmed on site at the flood test.", references: [{ type: "DRAWING", key: "wpr_det_701" }] },
  { number: "RFI-004", subject: "Slab opening coordination — Tower B level 3 risers", question: "The electrical riser opening at level 3 is 300 mm off the one on the structural drawing. Which governs?", discipline: "STRUCTURAL", contractor: "albabuild", status: "OPEN", priority: "NORMAL", raisedBy: "arlis.site-engineer", raisedByText: "Arben Muka, AlbaBuild", assignee: "arlis.civil", opened: -3, due: 3 },
  { number: "RFI-005", subject: "Tile setting-out at the apartment thresholds", question: "Should the tile joint line up with the door leaf or with the frame at the apartment entrances?", discipline: "INTERIORS", contractor: "durres_finishing", status: "DRAFT", priority: "LOW", raisedBy: "bci.architect", opened: -1 },
  { number: "RFI-006", subject: "Earthing of the curtain wall", question: "Is the curtain wall to be bonded to the lightning protection at every floor or at every third floor?", discipline: "ELECTRICAL", contractor: "elektronord", status: "ANSWERED", priority: "NORMAL", raisedBy: "arlis.mep", raisedByText: "Gerta Nushi, ElektroNord", assignee: "bci.engineering", opened: -10, due: -3, answered: -4, answer: "At every third floor and at the roof, with a bond across each movement joint." },
  { number: "RFI-007", subject: "Fire damper access panels in the corridor ceilings", question: "The corridor ceilings are plasterboard without access panels. How are the fire dampers inspected?", discipline: "FIRE_PROTECTION", contractor: "klimatek", status: "CLARIFICATION_REQUIRED", priority: "NORMAL", raisedBy: "arlis.mep", assignee: "bci.architect", opened: -12, due: -5, answered: -7, answer: "Which dampers do you mean — the ones on the supply branches or on the extract? Mark them on MEP-HVAC-402." },
  { number: "RFI-008", subject: "Drainage falls on the podium terraces", question: "The terrace build-up leaves 1:100 falls to the outlets; is 1:80 required under the paving?", discipline: "PLUMBING", contractor: "aquatek", status: "OPEN", priority: "NORMAL", raisedBy: "arlis.site-engineer", raisedByText: "Silva Meta, AquaTek", assignee: "bci.architect", opened: -2, due: 6 },
  { number: "RFI-009", subject: "Tower A core wall openings at level 9", question: "Two service openings in core wall W3 at level 9 are not on STR-GA-301 Rev C. Can they be cored, or do they need trimming bars cast in?", discipline: "STRUCTURAL", contractor: "albabuild", status: "OPEN", priority: "CRITICAL", raisedBy: "arlis.pm", raisedByText: "Arben Muka, AlbaBuild", assignee: "arlis.civil", opened: -4, due: 1, references: [{ type: "DRAWING", key: "str_ga_301", note: "Core wall W3, level 9" }] },
  { number: "RFI-010", subject: "Lift pit depth — Tower B", question: "The lift supplier asks for a 1,600 mm pit; the basement slab gives 1,400 mm. Can the pit be lowered locally?", discipline: "MECHANICAL", contractor: "liftech", status: "OPEN", priority: "LOW", raisedBy: "arlis.mep", raisedByText: "Dritan Vasili, Liftech Balkans", assignee: "arlis.civil", opened: -1, due: 10 },
  { number: "RFI-011", subject: "Balustrade fixing into the slab edge", question: "Can the balcony balustrade posts be fixed with resin anchors into the slab edge, or do they need cast-in plates?", discipline: "ARCHITECTURE", status: "CLOSED", priority: "NORMAL", raisedBy: "arlis.site-engineer", assignee: "bci.architect", opened: -32, due: -25, answered: -26, closed: -20, answer: "Resin anchors are acceptable at 150 mm edge distance; pull-test one post in fifty.", closure: "Pull tests passed; recorded in the site diary." },
  { number: "RFI-012", subject: "Concrete grade for the transfer slab infill strips", question: "Are the infill strips of the podium transfer slab cast in C35/45 like the slab, or in the C40/50 of the columns below?", discipline: "STRUCTURAL", contractor: "albabuild", status: "CLOSED", priority: "HIGH", raisedBy: "arlis.site-engineer", assignee: "arlis.civil", opened: -98, due: -92, answered: -94, closed: -90, answer: "C40/50 within 600 mm of each column head; C35/45 elsewhere.", closure: "Pour sequence issued to the site team." },
  { number: "RFI-013", subject: "Sanitary fixture set-out in the accessible apartments", question: "Is the WC in the accessible apartments set out 450 mm or 500 mm from the side wall?", discipline: "PLUMBING", contractor: "aquatek", status: "CLOSED", priority: "NORMAL", raisedBy: "arlis.mep", assignee: "bci.architect", opened: -40, due: -33, answered: -35, closed: -34, answer: "450 mm to the centre line, as on the accessible apartment plan.", closure: "Answered by the plan already issued." },
  { number: "RFI-014", subject: "Retaining wall drainage at the east boundary", question: "Behind the east retaining wall the drainage layer meets a live water main. Can the land drain be diverted south?", discipline: "CIVIL", status: "OPEN", priority: "NORMAL", raisedBy: "arlis.civil", assignee: "bci.engineering", opened: -14, due: -5 },
];

/* Submittals (§27) ------------------------------------------------------------ */

const SUBMITTALS: Array<{ number: string; title: string; type: TechnicalSubmittalType; discipline: EngineeringDiscipline; contractor: string; supplier?: string; reviewer?: string; due?: number; spec?: string; manufacturer?: string; product?: string; activity?: string; area?: string; revisions: Revision[] }> = [
  { number: "SUB-001", title: "Aluminium curtain wall profiles — system data", type: "MATERIAL_SUBMITTAL", discipline: "FACADE", contractor: "vlora_glass", supplier: "vlora_glass", reviewer: "bci.architect", spec: "08 44 13 — Glazed curtain walls", manufacturer: "Demo Façade Systems", product: "Curtain wall 60 mm, thermally broken", revisions: [{ code: "A", review: "REVISION_REQUIRED", day: -60, comment: "The U-values are for the standard profile, not the thermally broken one specified." }, { code: "B", review: "APPROVED", day: -40 }] },
  { number: "SUB-002", title: "Waterproofing membrane — product data and warranty", type: "MATERIAL_SUBMITTAL", discipline: "ARCHITECTURE", contractor: "hidroizol", supplier: "hidroizol", reviewer: "bci.engineering", spec: "07 52 00 — Modified bituminous membranes", product: "SBS membrane, two layers", revisions: [{ code: "A", review: "APPROVED_WITH_COMMENTS", day: -88, comment: "Approved; hand over the fifteen-year system warranty before practical completion." }] },
  { number: "SUB-003", title: "Air handling units — technical submittal", type: "TECHNICAL_SUBMITTAL", discipline: "MECHANICAL", contractor: "klimatek", supplier: "klimatek", reviewer: "bci.engineering", due: 2, manufacturer: "Demo Air Systems", product: "AHU 12,000 m³/h with heat recovery", revisions: [{ code: "01", review: "UNDER_REVIEW", day: -7 }] },
  { number: "SUB-004", title: "LV main switchboard — technical data", type: "TECHNICAL_SUBMITTAL", discipline: "ELECTRICAL", contractor: "elektronord", supplier: "elektronord", reviewer: "bci.engineering", due: 7, revisions: [{ code: "01", review: "SUBMITTED", day: -3 }] },
  { number: "SUB-005", title: "Curtain wall brackets — stainless steel, samples and data", type: "MATERIAL_SUBMITTAL", discipline: "FACADE", contractor: "vlora_glass", supplier: "vlora_glass", reviewer: "bci.engineering", due: 5, spec: "08 44 13 — Glazed curtain walls", revisions: [{ code: "A", review: "SUBMITTED", day: -2 }] },
  { number: "SUB-006", title: "Reinforcing steel B500C — mill certificates", type: "MATERIAL_SUBMITTAL", discipline: "STRUCTURAL", contractor: "albabuild", supplier: "adriatik_steel", reviewer: "arlis.qaqc-engineer", spec: "03 21 00 — Reinforcement steel", product: "B500C rebar, 12–32 mm", revisions: [{ code: "A", review: "APPROVED", day: -45 }] },
  { number: "SUB-007", title: "Concrete mix design C35/45", type: "MATERIAL_SUBMITTAL", discipline: "STRUCTURAL", contractor: "albabuild", supplier: "tirana_readymix", reviewer: "arlis.qaqc-engineer", spec: "03 30 00 — Cast-in-place concrete", revisions: [{ code: "A", review: "APPROVED", day: -100 }] },
  { number: "SUB-008", title: "Tower crane climbing — method statement", type: "METHOD_STATEMENT", discipline: "STRUCTURAL", contractor: "albabuild", reviewer: "arlis.hse", activity: "Climbing the tower crane to level 14", area: "Tower A core", revisions: [{ code: "01", review: "APPROVED", day: -72 }] },
  { number: "SUB-009", title: "Fire-stopping system — product data", type: "PRODUCT_DATA", discipline: "FIRE_PROTECTION", contractor: "klimatek", reviewer: "bci.engineering", revisions: [{ code: "A", review: "REVISION_REQUIRED", day: -11, comment: "The system is rated for 60 minutes; the risers need 120." }] },
  { number: "SUB-010", title: "Lift car finishes — samples", type: "SAMPLE", discipline: "MECHANICAL", contractor: "liftech", supplier: "liftech", revisions: [] },
  { number: "SUB-011", title: "Porcelain tiles 60×60 — samples", type: "SAMPLE", discipline: "INTERIORS", contractor: "durres_finishing", supplier: "adria_tiles", reviewer: "bci.architect", due: 1, revisions: [{ code: "A", review: "UNDER_REVIEW", day: -5 }] },
  { number: "SUB-012", title: "Sanitary fixtures — product data", type: "PRODUCT_DATA", discipline: "PLUMBING", contractor: "aquatek", supplier: "sanitaria", reviewer: "bci.architect", due: 9, revisions: [{ code: "A", review: "SUBMITTED", day: -1 }] },
];

/* Transmittals (§28) ---------------------------------------------------------- */

const TRANSMITTALS: Array<{ number: string; subject: string; direction: TransmittalDirection; purpose: TransmittalPurpose; issued: number | null; contractor?: string; sender?: string; recipient: string; items: Array<[string, string]>; by: string }> = [
  { number: "TRN-001", subject: "Structural drawing package — Tower A cores, Rev C", direction: "OUTGOING", purpose: "FOR_CONSTRUCTION", issued: -59, contractor: "albabuild", recipient: "AlbaBuild — site document control", items: [["str_ga_301", "C"]], by: "arlis.civil" },
  { number: "TRN-002", subject: "Architecture revision set — Tower A general arrangement, Rev B", direction: "OUTGOING", purpose: "FOR_CONSTRUCTION", issued: -94, recipient: "ARLIS - NDERTIM — site document control", items: [["arc_ga_101", "B"]], by: "bci.architect" },
  { number: "TRN-003", subject: "MEP coordination package", direction: "OUTGOING", purpose: "FOR_REVIEW", issued: -3, recipient: "ElektroNord and KlimaTek — design teams", items: [["mep_sld_401", "01"], ["mep_hvac_402", "P01"]], by: "arlis.mep" },
  { number: "TRN-004", subject: "Curtain wall shop drawings, Rev C", direction: "INCOMING", purpose: "FOR_APPROVAL", issued: -4, contractor: "vlora_glass", sender: "Vlora Glass Systems — document control", recipient: "BUILDING CONSTRUCTION INVEST — design management", items: [["fac_sd_210", "C"]], by: "bci.architect" },
  { number: "TRN-005", subject: "Apartment finishes schedule for pricing", direction: "OUTGOING", purpose: "FOR_INFORMATION", issued: -44, contractor: "durres_finishing", recipient: "Durrës Finishing Works — estimating", items: [["fin_spec_601", "A"]], by: "bci.architect" },
  { number: "TRN-006", subject: "Waterproofing details for construction", direction: "OUTGOING", purpose: "FOR_CONSTRUCTION", issued: null, contractor: "hidroizol", recipient: "HidroIzol Albania — site supervisor", items: [["wpr_det_701", "A"]], by: "bci.engineering" },
];

export async function seedArmaarEngineering(prisma: PrismaClient) {
  const today = localDate(new Date(), ZONE);
  const day = (offset: number) => new Date(`${addLocalDays(today, offset)}T12:00:00.000Z`);
  const at = (offset: number, hour = 10) => new Date(`${addLocalDays(today, offset)}T${String(hour).padStart(2, "0")}:00:00.000Z`);
  const m = (username: string, code: CompanyCode = BCI) => memberId(username, code);
  const legalOf = (code: CompanyCode) => (code === BCI ? "bci.legal" : "armaar.legal");

  await prisma.engineeringSettings.upsert({ where: { companyId: companyId(BCI) }, update: {}, create: { companyId: companyId(BCI) } });

  /* Contacts at D-01's contractors ------------------------------------------- */
  for (const [index, contact] of D01_CONTACTS.entries()) {
    const id = `armaar_ctc_${contact.contractor}_${index + 1}`;
    const domain = `${contact.contractor.replace(/_/g, "-")}.armaar-demo.test`;
    await prisma.contractorContact.upsert({
      where: { id },
      update: {},
      create: { id, companyId: companyId(BCI), contractorId: contractorId(contact.contractor), name: contact.name, roleTitle: contact.title, contactRole: contact.role, email: `${contact.name.split(" ")[0]!.toLowerCase()}@${domain}` },
    });
  }
  // The assignment names its main contact where D-01 left it empty.
  for (const key of ["albabuild", "vlora_glass", "elektronord", "klimatek", "durres_finishing"]) {
    const index = D01_CONTACTS.findIndex((contact) => contact.contractor === key);
    await prisma.projectContractorAssignment.updateMany({ where: { id: `armaar_pca_${key}`, primaryContractorContactId: null }, data: { primaryContractorContactId: `armaar_ctc_${key}_${index + 1}` } });
  }

  /* New contractors, their packages and subcontracts (§24, §25) --------------- */
  for (const [index, contractor] of CONTRACTORS.entries()) {
    const code = contractor.company;
    const company = companyId(code);
    const project = projectId(contractor.project);
    const id = contractorId(contractor.key);
    const manager = m(contractor.pkg.manager, code);
    const started = contractor.pkg.start;
    const domain = `${contractor.key.replace(/_/g, "-")}.armaar-demo.test`;
    await prisma.contractorProfile.upsert({
      where: { id },
      update: {},
      create: {
        id,
        companyId: company,
        legalName: contractor.legalName,
        vatNumber: contractor.taxId,
        email: `projects@${domain}`,
        city: "Tirana",
        countryCode: "AL",
        status: contractor.status,
        statusChangedAt: at(Math.min(started, 0) - 30),
        supplierId: contractor.supplier ? supplierId(contractor.supplier, code) : null,
        primaryContactName: contractor.contacts[0]!.name,
        notes: `${contractor.trade} contractor.`,
        normalizedName: normalizeContractorName(contractor.legalName),
        createdByMemberId: m(code === BCI ? "bci.procurement" : code === "IDEAL_CONSTRUCTION" ? "ideal.procurement" : "armaar.procurement", code),
        createdAt: at(Math.min(started, 0) - 45),
      },
    });
    for (const [position, contact] of contractor.contacts.entries()) {
      const contactId = `armaar_ctc_${contractor.key}_${position + 1}`;
      await prisma.contractorContact.upsert({
        where: { id: contactId },
        update: {},
        create: { id: contactId, companyId: company, contractorId: id, name: contact.name, roleTitle: contact.title, contactRole: contact.role, email: `${contact.name.split(" ")[0]!.toLowerCase()}@${domain}` },
      });
    }
    const contract = contractor.contract ? `armaar_contract_sub_${contractor.key}` : null;
    if (contractor.contract && contract) {
      const signed = contractor.contract.signed;
      await prisma.contract.upsert({
        where: { id: contract },
        update: {},
        create: {
          id: contract,
          companyId: company,
          contractNumber: contractor.contract.number,
          title: `${contractor.trade} subcontract — ${contractor.project === "TIRANA_LAKE" ? "Tirana Lake" : contractor.project === "FARKA_RESIDENCE" ? "Farka Residence" : "Gran Melia"}`,
          contractType: "SUBCONTRACT",
          projectId: project,
          ownerMemberId: m(legalOf(code), code),
          status: contractor.contract.status,
          counterpartyName: contractor.legalName,
          currency: EUR,
          contractValue: money(contractor.pkg.value),
          signedDate: signed === null ? null : day(signed),
          effectiveDate: contractor.contract.status === "ACTIVE" && signed !== null ? day(signed + 7) : null,
          expiryDate: day(contractor.pkg.end + 365),
          governingLaw: "Albanian law",
          jurisdiction: "Tirana",
          summary: contractor.scope,
          createdByMemberId: m(legalOf(code), code),
          createdAt: at((signed ?? -6) - 20),
        },
      });
    }
    const assignment = `armaar_pca_${contractor.key}`;
    await prisma.projectContractorAssignment.upsert({
      where: { id: assignment },
      update: {},
      create: { id: assignment, companyId: company, projectId: project, contractorId: id, status: contractor.pkg.status === "ACTIVE" ? "ACTIVE" : "PLANNED", scopeSummary: contractor.scope, contractId: contract, internalManagerMemberId: manager, primaryContractorContactId: `armaar_ctc_${contractor.key}_1`, startDate: day(started), endDate: day(contractor.pkg.end), createdByMemberId: manager, createdAt: at(Math.min(started, 0) - 25) },
    });
    await prisma.workPackage.upsert({
      where: { id: wpOf(contractor.key) },
      update: {},
      create: {
        id: wpOf(contractor.key),
        companyId: company,
        projectId: project,
        contractorId: id,
        projectContractorAssignmentId: assignment,
        code: contractor.pkg.code,
        name: contractor.pkg.name,
        description: contractor.scope,
        discipline: contractor.pkg.discipline,
        status: contractor.pkg.status,
        contractId: contract,
        responsibleMemberId: manager,
        plannedStartDate: day(started),
        plannedFinishDate: day(contractor.pkg.end),
        forecastStartDate: day(started),
        forecastFinishDate: day(contractor.pkg.end),
        actualStartDate: started < 0 ? day(started + 2) : null,
        value: money(contractor.pkg.value),
        currency: EUR,
        createdByMemberId: manager,
        createdAt: at(Math.min(started, 0) - 25),
      },
    });
    for (const [position, item] of contractor.compliance.entries()) {
      const itemId = `armaar_cci_${contractor.key}_${position + 1}`;
      await prisma.contractorComplianceItem.upsert({
        where: { id: itemId },
        update: {},
        create: {
          id: itemId,
          companyId: company,
          contractorId: id,
          type: item.type,
          title: item.title,
          status: item.status,
          issuedAt: item.status === "MISSING" ? null : day(-200 - index * 10),
          expiresAt: item.expires === undefined ? null : day(item.expires),
          issuer: item.issuer ?? null,
          notes: item.note ?? null,
          createdByMemberId: m(legalOf(code), code),
          createdAt: at(Math.min(started, 0) - 40),
        },
      });
    }
  }

  /* Drawings, calculations and specifications, revision by revision (§65) ----- */
  const engineeringDocumentId = (key: string) => `armaar_engdoc_${key}`;
  const revisionId = (key: string, code: string) => `armaar_engrev_${key}_${code.toLowerCase()}`;
  const revisionFile = (key: string, code: string) => `armaar_doc_eng_${key}_${code.toLowerCase()}`;
  for (const document of DOCUMENTS) {
    const id = engineeringDocumentId(document.key);
    const first = document.revisions[0]?.day ?? -2;
    const latest = document.revisions.at(-1);
    await prisma.engineeringDocument.upsert({
      where: { id },
      update: {},
      create: {
        id,
        companyId: companyId(BCI),
        projectId: TL,
        contractorId: document.contractor ? contractorId(document.contractor) : null,
        workPackageId: document.contractor ? wpOf(document.contractor) : null,
        documentNumber: document.number,
        title: document.title,
        documentType: document.type,
        discipline: document.discipline,
        status: latest ? documentStatus(latest.review) : "DRAFT",
        authorText: document.author,
        responsibleMemberId: m(document.responsible),
        reviewerMemberId: document.reviewer ? m(document.reviewer) : null,
        reviewDueAt: document.reviewDue === undefined ? null : day(document.reviewDue),
        createdByMemberId: m(document.responsible),
        createdAt: at(first - 3),
      },
    });
    for (const [index, revision] of document.revisions.entries()) {
      const next = document.revisions[index + 1];
      const file = revisionFile(document.key, revision.code);
      await seedStoredDocument(prisma, { id: file, companyId: companyId(BCI), name: `${document.number} Rev ${revision.code}.pdf`, projectId: TL, module: "engineering", entityType: "engineering_document", entityId: id, uploadedByMemberId: m(document.responsible), createdBy: userId(document.responsible) });
      await prisma.engineeringDocumentRevision.upsert({
        where: { id: revisionId(document.key, revision.code) },
        update: {},
        create: { id: revisionId(document.key, revision.code), companyId: companyId(BCI), engineeringDocumentId: id, revisionCode: revision.code, revisionNumber: index + 1, documentId: file, ...revisionState(revision, next, document.reviewer ? m(document.reviewer) : null, m(document.responsible), at), createdByMemberId: m(document.responsible), createdAt: at(revision.day - 1) },
      });
    }
    if (latest) await prisma.engineeringDocument.updateMany({ where: { id, currentRevisionId: null }, data: { currentRevisionId: revisionId(document.key, latest.code) } });
  }

  /* RFIs (§26) ---------------------------------------------------------------- */
  for (const rfi of RFIS) {
    const id = `armaar_rfi_tl_${rfi.number.slice(-3)}`;
    await prisma.rfi.upsert({
      where: { id },
      update: {},
      create: {
        id,
        companyId: companyId(BCI),
        projectId: TL,
        contractorId: rfi.contractor ? contractorId(rfi.contractor) : null,
        workPackageId: rfi.contractor ? wpOf(rfi.contractor) : null,
        rfiNumber: rfi.number,
        subject: rfi.subject,
        question: rfi.question,
        discipline: rfi.discipline,
        status: rfi.status,
        priority: rfi.priority,
        raisedByText: rfi.raisedByText ?? null,
        raisedByMemberId: m(rfi.raisedBy),
        assignedToMemberId: rfi.assignee ? m(rfi.assignee) : null,
        dueAt: rfi.due === undefined ? null : day(rfi.due),
        openedAt: rfi.status === "DRAFT" ? null : at(rfi.opened, 9),
        answeredAt: rfi.answered === undefined ? null : at(rfi.answered, 15),
        closedAt: rfi.closed === undefined ? null : at(rfi.closed, 16),
        closureNote: rfi.closure ?? null,
        createdByMemberId: m(rfi.raisedBy),
        createdAt: at(rfi.opened, 9),
      },
    });
    if (rfi.answer && rfi.answered !== undefined) {
      await prisma.rfiResponse.upsert({
        where: { id: `${id}_response_1` },
        update: {},
        // A request for clarification is an answer that is not the final one.
        create: { id: `${id}_response_1`, companyId: companyId(BCI), rfiId: id, responseText: rfi.answer, respondedByMemberId: m(rfi.assignee!), respondedAt: at(rfi.answered, 15), finalResponse: rfi.status !== "CLARIFICATION_REQUIRED" },
      });
    }
    for (const [index, reference] of (rfi.references ?? []).entries()) {
      await prisma.rfiReference.upsert({
        where: { id: `${id}_ref_${index + 1}` },
        update: {},
        create: { id: `${id}_ref_${index + 1}`, companyId: companyId(BCI), rfiId: id, referenceType: reference.type, referenceId: engineeringDocumentId(reference.key), note: reference.note ?? null, createdByMemberId: m(rfi.raisedBy) },
      });
    }
  }

  /* Submittals (§27) ----------------------------------------------------------- */
  const submittalRevisionId = (number: string, code: string) => `armaar_subrev_tl_${number.slice(-3)}_${code.toLowerCase()}`;
  for (const submittal of SUBMITTALS) {
    const id = `armaar_sub_tl_${submittal.number.slice(-3)}`;
    const latest = submittal.revisions.at(-1);
    const author = m("bci.pm");
    await prisma.technicalSubmittal.upsert({
      where: { id },
      update: {},
      create: {
        id,
        companyId: companyId(BCI),
        projectId: TL,
        contractorId: contractorId(submittal.contractor),
        workPackageId: wpOf(submittal.contractor),
        submittalNumber: submittal.number,
        title: submittal.title,
        submittalType: submittal.type,
        discipline: submittal.discipline,
        status: latest ? documentStatus(latest.review) : "DRAFT",
        assignedReviewerMemberId: submittal.reviewer ? m(submittal.reviewer) : null,
        dueAt: submittal.due === undefined ? null : day(submittal.due),
        specificationReference: submittal.spec ?? null,
        manufacturer: submittal.manufacturer ?? null,
        productName: submittal.product ?? null,
        supplierId: submittal.supplier ? supplierId(submittal.supplier, BCI) : null,
        activity: submittal.activity ?? null,
        workArea: submittal.area ?? null,
        createdByMemberId: author,
        createdAt: at((submittal.revisions[0]?.day ?? -1) - 2),
      },
    });
    for (const [index, revision] of submittal.revisions.entries()) {
      const next = submittal.revisions[index + 1];
      const file = `armaar_doc_sub_tl_${submittal.number.slice(-3)}_${revision.code.toLowerCase()}`;
      await seedStoredDocument(prisma, { id: file, companyId: companyId(BCI), name: `${submittal.number} Rev ${revision.code} — ${submittal.title.split(" — ")[0]}.pdf`, projectId: TL, module: "engineering", entityType: "technical_submittal", entityId: id, uploadedByMemberId: author, createdBy: userId("bci.pm") });
      await prisma.technicalSubmittalRevision.upsert({
        where: { id: submittalRevisionId(submittal.number, revision.code) },
        update: {},
        create: { id: submittalRevisionId(submittal.number, revision.code), companyId: companyId(BCI), submittalId: id, revisionCode: revision.code, revisionNumber: index + 1, documentId: file, ...revisionState(revision, next, submittal.reviewer ? m(submittal.reviewer) : null, author, at), createdByMemberId: author, createdAt: at(revision.day - 1) },
      });
    }
    if (latest) await prisma.technicalSubmittal.updateMany({ where: { id, currentRevisionId: null }, data: { currentRevisionId: submittalRevisionId(submittal.number, latest.code) } });
  }

  /* Transmittals (§28) ---------------------------------------------------------- */
  for (const transmittal of TRANSMITTALS) {
    const id = `armaar_trn_tl_${transmittal.number.slice(-3)}`;
    if (await prisma.documentTransmittal.findUnique({ where: { id }, select: { id: true } })) continue;
    const by = m(transmittal.by);
    await prisma.documentTransmittal.create({
      data: {
        id,
        companyId: companyId(BCI),
        projectId: TL,
        transmittalNumber: transmittal.number,
        direction: transmittal.direction,
        purpose: transmittal.purpose,
        status: transmittal.issued === null ? "DRAFT" : "ISSUED",
        subject: transmittal.subject,
        contractorId: transmittal.contractor ? contractorId(transmittal.contractor) : null,
        workPackageId: transmittal.contractor ? wpOf(transmittal.contractor) : null,
        senderText: transmittal.sender ?? "BUILDING CONSTRUCTION INVEST — Tirana Lake design management",
        recipientText: transmittal.recipient,
        issuedAt: transmittal.issued === null ? null : day(transmittal.issued),
        issuedByMemberId: transmittal.issued === null ? null : by,
        createdByMemberId: by,
        createdAt: at(transmittal.issued ?? -1, 9),
        items: {
          create: transmittal.items.map(([key, code], index) => ({ companyId: companyId(BCI), engineeringDocumentId: engineeringDocumentId(key), engineeringRevisionId: revisionId(key, code), documentId: revisionFile(key, code), sortOrder: index })),
        },
      },
    });
  }

  const inGroup = { company: { parentGroupId: ARMAAR_GROUP_ID } };
  return {
    contractors: await prisma.contractorProfile.count({ where: inGroup }),
    workPackages: await prisma.workPackage.count({ where: inGroup }),
    documents: await prisma.engineeringDocument.count({ where: inGroup }),
    rfis: await prisma.rfi.count({ where: inGroup }),
    submittals: await prisma.technicalSubmittal.count({ where: inGroup }),
    transmittals: await prisma.documentTransmittal.count({ where: inGroup }),
  };
}

/** A record's status is its current revision's review (the register reads it so). */
function documentStatus(review: Review) {
  return review;
}

/**
 * One revision's review, as the product leaves it: a later revision supersedes
 * it once submitted; a decision finalises it; a review under way has started.
 */
function revisionState(revision: Revision, next: Revision | undefined, reviewer: string | null, submitter: string, at: (offset: number, hour?: number) => Date) {
  const submitted = { submittedAt: at(revision.day, 9), submittedByMemberId: submitter };
  if (revision.review === "SUBMITTED") return { ...submitted, status: "SUBMITTED" as const };
  if (revision.review === "UNDER_REVIEW") return { ...submitted, status: "UNDER_REVIEW" as const, reviewStartedAt: at(revision.day + 2, 10) };
  const decided = { ...submitted, reviewStartedAt: at(revision.day + 1, 10), reviewedAt: at(revision.day + 3, 16), reviewedByMemberId: reviewer, reviewDecision: revision.review, reviewComment: revision.comment ?? null };
  return next ? { ...decided, status: "SUPERSEDED" as const, supersededAt: at(next.day, 9) } : { ...decided, status: "FINALIZED" as const };
}
