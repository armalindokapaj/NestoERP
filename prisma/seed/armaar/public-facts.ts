/**
 * ARMAAR Group's public facts (D-01 §4, §5, §15-§18) — the only place they live.
 *
 * A fact here is PUBLIC and carries the source it was taken from. Everything
 * the seed puts beside it — people, budgets, progress, sales, which company runs
 * a project unless stated here — is SYNTHETIC or INFERRED, and recorded as such
 * in `demo_records` (D-01 §2, §3, §107). Nothing here is overwritten from a
 * template (§108).
 *
 * The source set is what D-01 identified, and D-03 added to it: the group's
 * owner, each company's NIPT and its administrator in the registry. A project's
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

/** What D-03 adds as public (§6, §7, §13): the registry's owner, administrators and NIPTs (2026-09-19). */
export const D03_SOURCE: PublicSource = {
  label: "NESTO Demo PRD D-03, the group's owner, company administrators and NIPTs",
  url: null,
  verifiedAt: "2026-09-19",
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

/** The group's identified companies, whether each is active (D-01 §5), and its NIPT (D-03 §13). */
export const COMPANY_FACTS: ReadonlyArray<{ code: CompanyCode; name: string; status: "ACTIVE" | "SUSPENDED"; registrationNumber: string | null }> = [
  { code: "ARLIS_NDERTIM", name: "ARLIS - NDERTIM", status: "ACTIVE", registrationNumber: "K82116012N" },
  { code: "ARLIS_ADMINISTRIM", name: "ARLIS ADMINISTRIM", status: "ACTIVE", registrationNumber: "L81813036S" },
  { code: "ARSOL_ENERGY", name: "ARSOL ENERGY", status: "ACTIVE", registrationNumber: "M12219043J" },
  { code: "IDEAL_CONSTRUCTION", name: "IDEAL Construction", status: "ACTIVE", registrationNumber: "L31713001S" },
  { code: "KLAIS", name: "Klais", status: "ACTIVE", registrationNumber: "L11508009D" },
  { code: "KF_POGRADECI", name: "K.F POGRADECI", status: "ACTIVE", registrationNumber: "M03707601D" },
  { code: "UNICO_CONSTRUCTION", name: "UNICO CONSTRUCTION", status: "ACTIVE", registrationNumber: "M31319042E" },
  { code: "SARANDA_MARINA_INVEST", name: "Saranda Marina Invest", status: "ACTIVE", registrationNumber: "M32223018E" },
  { code: "BUILDING_CONSTRUCTION_INVEST", name: "BUILDING CONSTRUCTION INVEST", status: "ACTIVE", registrationNumber: "M11324001O" },
  { code: "SUNRAY_ENERGY", name: "SUNRAY ENERGY", status: "SUSPENDED", registrationNumber: "M21810028H" },
  { code: "EKSO", name: "EKSO", status: "SUSPENDED", registrationNumber: "M31516014N" },
  { code: "THE_EOTEL", name: "THE EOTel", status: "SUSPENDED", registrationNumber: "M31726012H" },
  { code: "SKYLINE_TOWERS", name: "SKYLINE TOWERS", status: "SUSPENDED", registrationNumber: "M32009014L" },
];

/** The group's owner (D-03 §6): the Owner of the group in NESTO, one person. */
export const GROUP_OWNER = { firstName: "Armand", lastName: "Lilo" } as const;

/**
 * Each legal entity's administrator in the registry (D-03 §7, §13). NESTO keeps
 * a company's registry facts but no relationship to the people who represent it
 * in law, and D-03 adds none (§13, §41): the seed records none of these and
 * reports them as skipped. They are kept here, ready for when NESTO has one.
 * Four of them — Klaisi Çela, Kopi Gusho, Xhensila Pupa, Gentiana Lilo — have no
 * other relationship in the demo, so they are not people in it yet either.
 */
export const LEGAL_ADMINISTRATORS: ReadonlyArray<{ of: "GROUP" | CompanyCode; firstName: string; lastName: string }> = [
  { of: "GROUP", firstName: "Klaisi", lastName: "Çela" },
  { of: "ARLIS_NDERTIM", firstName: "Xhejsi", lastName: "Lilo" },
  { of: "ARLIS_ADMINISTRIM", firstName: "Xhejsi", lastName: "Lilo" },
  { of: "ARSOL_ENERGY", firstName: "Xhejsi", lastName: "Lilo" },
  { of: "IDEAL_CONSTRUCTION", firstName: "Xhejsi", lastName: "Lilo" },
  { of: "KLAIS", firstName: "Adela", lastName: "Dervishaj" },
  { of: "KF_POGRADECI", firstName: "Kopi", lastName: "Gusho" },
  { of: "UNICO_CONSTRUCTION", firstName: "Migena", lastName: "Bajro" },
  { of: "SARANDA_MARINA_INVEST", firstName: "Xhensila", lastName: "Pupa" },
  { of: "BUILDING_CONSTRUCTION_INVEST", firstName: "Xhejsi", lastName: "Lilo" },
  { of: "SUNRAY_ENERGY", firstName: "Gentiana", lastName: "Lilo" },
  { of: "EKSO", firstName: "Adela", lastName: "Dervishaj" },
  { of: "THE_EOTEL", firstName: "Migena", lastName: "Bajro" },
  { of: "SKYLINE_TOWERS", firstName: "Xhensila", lastName: "Pupa" },
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
