/**
 * ARMAAR Group's public facts (D-01 §4, §5, §15-§18) — the only place they live.
 *
 * A fact here is PUBLIC and carries the source it was taken from. Everything
 * the seed puts beside it — people, budgets, progress, sales, which company runs
 * a project unless stated here — is SYNTHETIC or INFERRED, and recorded as such
 * in `demo_records` (D-01 §2, §3, §107). Nothing here is overwritten from a
 * template (§108).
 *
 * The source set is what D-01 itself identified. A company's NIPT, a project's
 * location or built area that is not in it is left empty rather than guessed:
 * to add one, add it here with its source and reseed.
 */

export type PublicSource = { label: string; url: string | null; verifiedAt: string };

/** The facts D-01 lists as verified public information about the group (2026-09-18). */
export const D01_SOURCE: PublicSource = {
  label: "NESTO Demo PRD D-01, the group's identified public facts",
  url: null,
  verifiedAt: "2026-09-18",
};

export const GROUP_FACTS = {
  name: "ARMAAR GROUP",
  legalName: "ARMAAR GROUP sh.p.k.",
  /** The NIPT: NESTO keeps it as the registration number. */
  registrationNumber: "M01517007J",
  country: "Albania",
  city: "Tirana",
  source: D01_SOURCE,
} as const;

export type CompanyCode =
  | "ARLIS_NDERTIM"
  | "ARLIS_ADMINISTRIM"
  | "ARSOL_ENERGY"
  | "IDEAL_CONSTRUCTION"
  | "KLAIS"
  | "KF_POGRADECI"
  | "UNICO_CONSTRUCTION"
  | "SARANDA_MARINA_INVEST"
  | "BUILDING_CONSTRUCTION_INVEST"
  | "SUNRAY_ENERGY"
  | "EKSO"
  | "THE_EOTEL"
  | "SKYLINE_TOWERS";

/** The group's identified companies and whether each is active (D-01 §5). */
export const COMPANY_FACTS: ReadonlyArray<{ code: CompanyCode; name: string; status: "ACTIVE" | "SUSPENDED"; registrationNumber: string | null }> = [
  { code: "ARLIS_NDERTIM", name: "ARLIS - NDERTIM", status: "ACTIVE", registrationNumber: null },
  { code: "ARLIS_ADMINISTRIM", name: "ARLIS ADMINISTRIM", status: "ACTIVE", registrationNumber: null },
  { code: "ARSOL_ENERGY", name: "ARSOL ENERGY", status: "ACTIVE", registrationNumber: null },
  { code: "IDEAL_CONSTRUCTION", name: "IDEAL Construction", status: "ACTIVE", registrationNumber: null },
  { code: "KLAIS", name: "Klais", status: "ACTIVE", registrationNumber: null },
  { code: "KF_POGRADECI", name: "K.F POGRADECI", status: "ACTIVE", registrationNumber: null },
  { code: "UNICO_CONSTRUCTION", name: "UNICO CONSTRUCTION", status: "ACTIVE", registrationNumber: null },
  { code: "SARANDA_MARINA_INVEST", name: "Saranda Marina Invest", status: "ACTIVE", registrationNumber: null },
  { code: "BUILDING_CONSTRUCTION_INVEST", name: "BUILDING CONSTRUCTION INVEST", status: "ACTIVE", registrationNumber: null },
  { code: "SUNRAY_ENERGY", name: "SUNRAY ENERGY", status: "SUSPENDED", registrationNumber: null },
  { code: "EKSO", name: "EKSO", status: "SUSPENDED", registrationNumber: null },
  { code: "THE_EOTEL", name: "THE EOTel", status: "SUSPENDED", registrationNumber: null },
  { code: "SKYLINE_TOWERS", name: "SKYLINE TOWERS", status: "SUSPENDED", registrationNumber: null },
];

export type ProjectCode =
  | "TIRANA_LAKE"
  | "UNITED_TOWERS"
  | "CORNER"
  | "GRAN_MELIA"
  | "POGRADEC_MARINA"
  | "EYES_OF_TIRANA"
  | "PHARMACY_10"
  | "SQUARE_21"
  | "THE_COURTYARD"
  | "FARKA_RESIDENCE"
  | "CLEARWATER_BEACH";

/**
 * The group's public project portfolio (D-01 §15, §18). Only Tirana Lake has
 * more than its name in the source set: its city, built area, type and
 * components, and its company (§17). A field left out here is not public.
 */
export const PROJECT_FACTS: ReadonlyArray<{
  code: ProjectCode;
  name: string;
  city?: string;
  builtArea?: number;
  type?: string;
  components?: readonly string[];
  company?: CompanyCode;
}> = [
  {
    code: "TIRANA_LAKE",
    name: "Tirana Lake",
    city: "Tirana",
    builtArea: 233_000,
    // D-01 §18 "Mixed Use"; the company's project type of that name.
    type: "Mixed use",
    components: ["Residential", "Commercial", "Office"],
    company: "BUILDING_CONSTRUCTION_INVEST",
  },
  { code: "UNITED_TOWERS", name: "United Towers" },
  { code: "CORNER", name: "Corner" },
  { code: "GRAN_MELIA", name: "Gran Melia" },
  { code: "POGRADEC_MARINA", name: "Pogradec Marina" },
  { code: "EYES_OF_TIRANA", name: "Eyes of Tirana" },
  { code: "PHARMACY_10", name: "Pharmacy 10" },
  { code: "SQUARE_21", name: "Square 21" },
  { code: "THE_COURTYARD", name: "The Courtyard" },
  { code: "FARKA_RESIDENCE", name: "Farka Residence" },
  { code: "CLEARWATER_BEACH", name: "Clearwater Beach" },
];
