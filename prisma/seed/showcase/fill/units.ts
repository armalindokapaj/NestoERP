/**
 * Buildings, floors and units for every Arvela project but Kalaja Residence,
 * which the standard seed already lays out: offices in Porta Tower, warehouse
 * bays in Nyja, flats and penthouses on the Lungomare, serviced residences in
 * Ksamil, flats over shops on the Durrës promenade, Kodra's villas and Rinas'
 * offices in design. Every unit is published from the start, as units are.
 */
import { Prisma, type FloorLevelType, type PrismaClient, type UnitOrientation, type UnitPosition, type UnitTypeCategory } from "@prisma/client";

import { defaultUnitTypeRows } from "../../../../config/unit-types";
import { floorKeyOf, structureKey, unitLabel, workedOutAreas } from "../../../../lib/modules/project-structure/structure.rules";
import { buildSnapshot } from "../../../../lib/modules/project-structure/unit-publishing.rules";
import { loadPublishStates } from "../../../../lib/modules/project-structure/unit-publishing.state";
import { placeholderPdf } from "../../document-objects";
import { floorPlanSvg, jpeg, unitFile } from "../../unit-publishing";
import { at, castOf, dec, random, type Clock } from "./kit";

export type UnitPlan = {
  code: string;
  type: string;
  internal: number;
  balcony?: number;
  terrace?: number;
  garden?: number;
  common?: number;
  bedrooms?: number;
  bathrooms?: number;
  storage?: number;
  orientation?: UnitOrientation;
  position?: UnitPosition;
  attributes?: Record<string, string | boolean>;
  name?: string;
};
type LevelPlan = { type: FloorLevelType; number: number | null; name: string; elevation: number | null; units: UnitPlan[] };
type BuildingPlan = { code: string; name: string; description: string; levels: LevelPlan[] };
export type ProjectLayout = { projectId: string; companyId: string; key: string; createdBy: string; laidOut: number; buildings: BuildingPlan[] };

/* -------------------------------------------------------------------------- */
/* Layout builders                                                             */
/* -------------------------------------------------------------------------- */

const pad = (value: number) => String(value).padStart(2, "0");

type FlatPlan = Omit<UnitPlan, "code" | "type"> & { type?: string };

/** A floor of flats coded the way Kalaja's are: A-101, A-102 … A-1001. */
const flats = (block: string, level: number, plans: FlatPlan[]): UnitPlan[] =>
  plans.map((plan, index) => ({ type: "APARTMENT", ...plan, code: `${block}-${level}${pad(index + 1)}` }));

const parking = (prefix: string, count: number, from = 1, evReady = 2): UnitPlan[] =>
  Array.from({ length: count }, (_, index) => ({ code: `${prefix}${pad(from + index)}`, type: "PARKING", internal: 12.5, attributes: { covered: true, evReady: index < evReady } }));

const storage = (prefix: string, count: number): UnitPlan[] =>
  Array.from({ length: count }, (_, index) => ({ code: `${prefix}${pad(index + 1)}`, type: "STORAGE", internal: index % 2 === 0 ? 6 : 8.5, attributes: { ceilingHeight: "2.60" } }));

const shop = (code: string, internal: number, frontage: string, orientation: UnitOrientation = "S"): UnitPlan => ({
  code,
  type: "SHOP",
  internal,
  common: Math.round(internal * 0.08 * 100) / 100,
  bathrooms: 1,
  orientation,
  position: "FRONT",
  attributes: { frontage, ceilingHeight: "4.20" },
});

const office = (code: string, internal: number, orientation: UnitOrientation, position: UnitPosition = "OTHER"): UnitPlan => ({
  code,
  type: "OFFICE",
  internal,
  common: Math.round(internal * 0.12 * 100) / 100,
  bathrooms: internal > 250 ? 2 : 1,
  orientation,
  position,
  attributes: { ceilingHeight: "3.10" },
});

const level = (type: FloorLevelType, number: number | null, name: string, elevation: number | null, units: UnitPlan[] = []): LevelPlan => ({ type, number, name, elevation, units });

/** A typical flat floor: two corners with views, two in the middle. */
const SEA_FLATS: FlatPlan[] = [
  { internal: 96.4, balcony: 14.2, common: 9.1, bedrooms: 2, bathrooms: 2, storage: 1, orientation: "SW", position: "CORNER" },
  { internal: 68.5, balcony: 9.8, common: 6.4, bedrooms: 1, bathrooms: 1, orientation: "S", position: "FRONT" },
  { internal: 71.2, balcony: 8.6, common: 6.6, bedrooms: 1, bathrooms: 1, orientation: "N", position: "REAR" },
  { internal: 121.8, balcony: 16.4, common: 10.2, bedrooms: 3, bathrooms: 2, storage: 1, orientation: "SE", position: "CORNER" },
];

const PROMENADE_FLATS: FlatPlan[] = [
  { internal: 58.6, balcony: 7.2, common: 5.4, bedrooms: 1, bathrooms: 1, orientation: "W", position: "FRONT" },
  { internal: 84.3, balcony: 11.5, common: 7.6, bedrooms: 2, bathrooms: 1, orientation: "SW", position: "CORNER" },
  { internal: 47.8, balcony: 6.0, common: 4.4, bedrooms: 1, bathrooms: 1, orientation: "E", position: "REAR" },
  { internal: 92.1, balcony: 12.8, common: 8.3, bedrooms: 2, bathrooms: 2, storage: 1, orientation: "NW", position: "CORNER" },
  { internal: 109.4, balcony: 15.0, common: 9.6, bedrooms: 3, bathrooms: 2, storage: 1, orientation: "S", position: "FRONT" },
];

const RESIDENCES: FlatPlan[] = [
  { internal: 38.5, balcony: 9.0, common: 3.8, bedrooms: 0, bathrooms: 1, orientation: "W", position: "FRONT", name: "Studio" },
  { internal: 54.2, balcony: 11.4, common: 5.1, bedrooms: 1, bathrooms: 1, orientation: "W", position: "FRONT" },
  { internal: 56.8, balcony: 10.6, common: 5.3, bedrooms: 1, bathrooms: 1, orientation: "SW", position: "CORNER" },
  { internal: 78.9, balcony: 14.8, common: 7.0, bedrooms: 2, bathrooms: 2, orientation: "NW", position: "CORNER" },
  { internal: 41.0, balcony: 8.2, common: 4.0, bedrooms: 0, bathrooms: 1, orientation: "E", position: "REAR", name: "Studio" },
];

/* -------------------------------------------------------------------------- */
/* The projects                                                                */
/* -------------------------------------------------------------------------- */

function porta(): BuildingPlan[] {
  const levels: LevelPlan[] = [
    level("BASEMENT", -2, "Basement 2", -6.4, parking("B2-", 20, 1, 4)),
    level("BASEMENT", -1, "Basement 1", -3.2, [...parking("B1-", 18, 1, 4), ...storage("S", 6)]),
    level("GROUND", 0, "Ground Floor", 0, [shop("G01", 148, "12.40", "S"), shop("G02", 96, "8.20", "E"), shop("G03", 122, "10.60", "W")]),
  ];
  for (let floor = 1; floor <= 18; floor += 1) {
    const elevation = Math.round((4.6 + (floor - 1) * 3.6) * 100) / 100;
    const units =
      floor <= 8
        ? [office(`${floor}01`, 186, "SW", "CORNER"), office(`${floor}02`, 142, "S", "FRONT"), office(`${floor}03`, 142, "N", "REAR"), office(`${floor}04`, 210, "NE", "CORNER")]
        : floor <= 11
          ? [68, 74, 94, 72, 70, 88].map((area, index) => office(`${floor}${pad(index + 1)}`, area, (["S", "S", "SW", "N", "N", "NE"] as const)[index]!, index === 2 || index === 5 ? "CORNER" : "OTHER"))
          : floor <= 17
            ? [office(`${floor}01`, 330, "SW", "CORNER"), office(`${floor}02`, 360, "NE", "CORNER")]
            : [{ ...office("1801", 712, "MULTI", "OTHER"), name: "Full floor" }];
    levels.push(level("STANDARD", floor, `Floor ${floor}`, elevation, units));
  }
  levels.push(level("ROOF", null, "Roof", 69.4));
  return [{ code: "PT", name: "Porta Tower", description: "Eighteen floors of offices over two basements of parking, with shops on the boulevard.", levels }];
}

function nyja(): BuildingPlan[] {
  const bay = (code: string, internal: number): UnitPlan => ({ code, type: "WAREHOUSE", internal, common: Math.round(internal * 0.03), position: "OTHER", attributes: { ceilingHeight: "12.00" } });
  return [
    {
      code: "WA",
      name: "Warehouse A",
      description: "Eight bays of 1,500 m² with dock doors on the yard, phase 1.",
      levels: [
        level("GROUND", 0, "Ground Floor", 0, [1480, 1495, 1510, 1520, 1520, 1510, 1495, 1480].map((area, index) => bay(pad(index + 1), area))),
        level("MEZZANINE", 1, "Mezzanine", 4.5, Array.from({ length: 8 }, (_, index) => ({ ...office(`M${pad(index + 1)}`, 118, "N", "OTHER"), name: `Bay ${index + 1} offices` }))),
      ],
    },
    {
      code: "WB",
      name: "Warehouse B",
      description: "Six larger bays, phase 2, released once Warehouse A is let.",
      levels: [level("GROUND", 0, "Ground Floor", 0, [2080, 2100, 2120, 2120, 2100, 2080].map((area, index) => bay(pad(index + 1), area)))],
    },
    {
      code: "SB",
      name: "Service Building",
      description: "Reception, a drivers' café and offices at the gate.",
      levels: [
        level("GROUND", 0, "Ground Floor", 0, [shop("G01", 140, "11.00", "E"), shop("G02", 86, "7.40", "E")]),
        level("STANDARD", 1, "Floor 1", 4.2, [office("101", 96, "E"), office("102", 88, "W"), office("103", 112, "S", "CORNER"), office("104", 74, "N")]),
        level("STANDARD", 2, "Floor 2", 7.8, [office("201", 96, "E"), office("202", 88, "W"), office("203", 112, "S", "CORNER"), office("204", 74, "N")]),
      ],
    },
    {
      code: "TY",
      name: "Truck Yard",
      description: "Marked truck and trailer bays along the highway side.",
      levels: [level("GROUND", 0, "Yard", 0, Array.from({ length: 24 }, (_, index) => ({ code: pad(index + 1), type: "PARKING", internal: 45, attributes: { covered: false, evReady: index < 4 } })))],
    },
  ];
}

function lungomare(): BuildingPlan[] {
  return (["A", "B"] as const).map((block) => {
    const levels: LevelPlan[] = [
      level("BASEMENT", -1, "Basement 1", -3.2, [...parking("P", 14), ...storage("S", 6)]),
      level("GROUND", 0, "Ground Floor", 0, [shop("G01", 112, "9.80"), shop("G02", 86, "7.60"), shop("G03", 128, "11.20")]),
    ];
    for (let floor = 1; floor <= 9; floor += 1) levels.push(level("STANDARD", floor, `Floor ${floor}`, Math.round(floor * 3.15 * 100) / 100, flats(block, floor, SEA_FLATS)));
    levels.push(
      level("STANDARD", 10, "Floor 10", 31.5, [
        { code: `${block}-1001`, type: "PENTHOUSE", internal: 164.5, terrace: 72.0, common: 12.4, bedrooms: 3, bathrooms: 3, storage: 1, orientation: "SW", position: "CORNER" },
        { code: `${block}-1002`, type: "PENTHOUSE", internal: 148.2, terrace: 64.5, common: 11.6, bedrooms: 3, bathrooms: 2, storage: 1, orientation: "SE", position: "CORNER" },
      ]),
      level("ROOF", null, "Roof", 34.8),
    );
    return { code: block, name: `Block ${block}`, description: block === "A" ? "On the promenade, every flat with a sea view." : "Behind Block A, sea views from the fifth floor up.", levels };
  });
}

function ksamil(): BuildingPlan[] {
  const residences = (block: string, description: string): BuildingPlan => {
    const levels: LevelPlan[] = [level("GROUND", 0, "Ground Floor", 0, flats(block, 0, RESIDENCES).map((unit) => ({ ...unit, code: unit.code.replace(`${block}-0`, `${block}-G`) })))];
    for (let floor = 1; floor <= 4; floor += 1) levels.push(level("STANDARD", floor, `Floor ${floor}`, Math.round(floor * 3.2 * 100) / 100, flats(block, floor, RESIDENCES)));
    levels.push(
      level("STANDARD", 5, "Floor 5", 16.0, [
        { code: `${block}-501`, type: "PENTHOUSE", internal: 118.6, terrace: 58.0, common: 9.2, bedrooms: 3, bathrooms: 2, orientation: "W", position: "CORNER" },
        { code: `${block}-502`, type: "PENTHOUSE", internal: 104.3, terrace: 46.5, common: 8.4, bedrooms: 2, bathrooms: 2, orientation: "SW", position: "CORNER" },
      ]),
    );
    return { code: block, name: `Residences ${block}`, description, levels };
  };
  return [
    {
      code: "HT",
      name: "Hotel",
      description: "140 rooms and suites, run by Arvela Hospitality; not for sale.",
      levels: [level("BASEMENT", -1, "Basement 1", -3.6, parking("P", 20, 1, 6)), level("GROUND", 0, "Lobby", 0), ...Array.from({ length: 6 }, (_, index) => level("STANDARD", index + 1, `Floor ${index + 1}`, Math.round((4.8 + index * 3.3) * 100) / 100)), level("ROOF", null, "Roof terrace", 24.6)],
    },
    residences("R1", "First release: serviced residences facing Ksamil's islands."),
    residences("R2", "Second release, on sale from this autumn."),
    { code: "SR", name: "Shops", description: "A row of shops on the beach road.", levels: [level("GROUND", 0, "Ground Floor", 0, Array.from({ length: 6 }, (_, index) => shop(pad(index + 1), [64, 58, 72, 88, 58, 64][index]!, ["6.20", "5.80", "6.60", "8.40", "5.80", "6.20"][index]!, "W")))] },
  ];
}

function promenada(): BuildingPlan[] {
  return (["A", "B"] as const).map((block) => {
    const levels: LevelPlan[] = [
      level("BASEMENT", -1, "Basement 1", -3.2, parking("P", 16)),
      level("GROUND", 0, "Ground Floor", 0, [shop("G01", 96, "8.40", "W"), shop("G02", 74, "6.80", "W"), shop("G03", 118, "10.20", "SW"), shop("G04", 82, "7.20", "W")]),
    ];
    for (let floor = 1; floor <= 8; floor += 1) levels.push(level("STANDARD", floor, `Floor ${floor}`, Math.round(floor * 3.15 * 100) / 100, flats(block, floor, PROMENADE_FLATS)));
    levels.push(
      level("STANDARD", 9, "Floor 9", 28.35, [
        { code: `${block}-901`, type: "PENTHOUSE", internal: 152.0, terrace: 68.0, common: 11.8, bedrooms: 3, bathrooms: 3, orientation: "SW", position: "CORNER" },
        { code: `${block}-902`, type: "PENTHOUSE", internal: 138.6, terrace: 54.0, common: 10.9, bedrooms: 3, bathrooms: 2, orientation: "NW", position: "CORNER" },
      ]),
    );
    return { code: block, name: `Block ${block}`, description: block === "A" ? "On the promenade: shops below, flats with sea views above." : "Block B, a street back, on sale from spring.", levels };
  });
}

function kodra(): BuildingPlan[] {
  return (["A", "B", "C"] as const).map((row, rowIndex) => ({
    code: row,
    name: `Row ${row}`,
    description: `Eight villas on the ${["upper", "middle", "lower"][rowIndex]} terrace of the hill.`,
    levels: [
      level(
        "GROUND",
        0,
        "Villas",
        0,
        Array.from({ length: 8 }, (_, index) => ({
          code: `${row}-${pad(index + 1)}`,
          type: "VILLA",
          internal: [268, 284, 296, 312, 276, 288, 302, 318][index]!,
          terrace: [42, 48, 56, 64, 44, 50, 58, 72][index]!,
          garden: [180, 210, 240, 260, 190, 220, 250, 300][index]!,
          bedrooms: index % 4 === 3 ? 5 : 4,
          bathrooms: index % 4 === 3 ? 4 : 3,
          storage: 1,
          orientation: (["S", "SW", "S", "SE"] as const)[index % 4],
          position: index === 0 || index === 7 ? ("CORNER" as const) : ("OTHER" as const),
        })),
      ),
    ],
  }));
}

function rinas(): BuildingPlan[] {
  const levels: LevelPlan[] = [level("GROUND", 0, "Ground Floor", 0, [shop("G01", 240, "16.00", "E"), shop("G02", 210, "14.00", "E"), shop("G03", 210, "14.00", "E"), shop("G04", 260, "17.50", "E")].map((unit) => ({ ...unit, name: "Showroom" })))];
  for (let floor = 1; floor <= 4; floor += 1) levels.push(level("STANDARD", floor, `Floor ${floor}`, 4.6 + (floor - 1) * 3.6, [120, 96, 96, 140, 96, 120].map((area, index) => office(`${floor}${pad(index + 1)}`, area, (["E", "E", "S", "SW", "W", "N"] as const)[index]!))));
  return [{ code: "B1", name: "Block 1", description: "Showrooms on the airport road with four floors of offices; in design.", levels }];
}

export const LAYOUTS: ProjectLayout[] = [
  { projectId: "project_b", companyId: "company_demo_b", key: "prt", createdBy: "user_architecture_manager_b", laidOut: -300, buildings: porta() },
  { projectId: "project_c", companyId: "company_demo_c", key: "nyj", createdBy: "user_engineer_c", laidOut: -240, buildings: nyja() },
  { projectId: "project_d", companyId: "company_demo_d", key: "lgm", createdBy: "user_architect_d", laidOut: -330, buildings: lungomare() },
  { projectId: "project_e", companyId: "company_demo_e", key: "ksb", createdBy: "user_architecture_manager", laidOut: -270, buildings: ksamil() },
  { projectId: "project_showcase_promenada", companyId: "company_demo_b", key: "prd", createdBy: "user_architecture_manager_b", laidOut: -520, buildings: promenada() },
  { projectId: "project_showcase_kodra", companyId: "company_demo_b", key: "kdv", createdBy: "user_architecture_manager_b", laidOut: -1500, buildings: kodra() },
  { projectId: "project_showcase_rinas", companyId: "company_demo_b", key: "rbp", createdBy: "user_architecture_manager_b", laidOut: -60, buildings: rinas() },
];

/** The unit types a company adds for its own kind of stock. */
const EXTRA_TYPES: Array<{ companyId: string; code: string; name: string; category: UnitTypeCategory }> = [{ companyId: "company_demo_c", code: "WAREHOUSE", name: "Warehouse bay", category: "COMMERCIAL" }];

export const unitIdOf = (key: string, code: string) => `unit_${key}_${code.toLowerCase().replace(/[^a-z0-9]+/g, "_")}`;

/* -------------------------------------------------------------------------- */
/* Writing it                                                                  */
/* -------------------------------------------------------------------------- */

export async function seedShowcaseUnits(prisma: PrismaClient, clock: Clock) {
  for (const companyId of new Set(LAYOUTS.map((layout) => layout.companyId))) {
    await prisma.projectUnitType.createMany({ data: defaultUnitTypeRows(companyId), skipDuplicates: true });
  }
  for (const type of EXTRA_TYPES) {
    await prisma.projectUnitType.createMany({ data: [{ companyId: type.companyId, code: type.code, name: type.name, category: type.category, sortOrder: 20 }], skipDuplicates: true });
  }

  let units = 0;
  for (const layout of LAYOUTS) {
    const types = new Map((await prisma.projectUnitType.findMany({ where: { companyId: layout.companyId }, select: { id: true, code: true, category: true } })).map((row) => [row.code, row]));
    const laidOut = at(clock, layout.laidOut);
    for (const [buildingIndex, building] of layout.buildings.entries()) {
      const buildingId = `bld_${layout.key}_${building.code.toLowerCase()}`;
      await prisma.projectBuilding.create({
        data: { id: buildingId, companyId: layout.companyId, projectId: layout.projectId, name: building.name, nameKey: structureKey(building.name), code: building.code, codeKey: structureKey(building.code), sortOrder: buildingIndex + 1, description: building.description, createdBy: layout.createdBy, createdAt: laidOut },
      });
      for (const [levelIndex, plan] of building.levels.entries()) {
        const floorId = `flr_${layout.key}_${building.code.toLowerCase()}_${levelIndex + 1}`;
        await prisma.projectFloor.create({
          data: { id: floorId, companyId: layout.companyId, projectId: layout.projectId, buildingId, levelType: plan.type, number: plan.number, name: plan.name, floorKey: floorKeyOf(plan.type, plan.number, plan.name), sortOrder: levelIndex + 1, elevation: plan.elevation === null ? null : dec(plan.elevation), createdBy: layout.createdBy, createdAt: laidOut },
        });
        if (plan.units.length === 0) continue;
        await prisma.projectUnit.createMany({
          data: plan.units.map((unit, index) => {
            const type = types.get(unit.type);
            if (!type) throw new Error(`Showcase fill: ${layout.companyId} has no unit type ${unit.type}.`);
            const text = (value: number | undefined) => (value === undefined ? null : value.toFixed(2));
            const worked = workedOutAreas(type.category, { internalArea: text(unit.internal), balconyArea: text(unit.balcony), terraceArea: text(unit.terrace), commonAreaAllocation: text(unit.common), grossArea: null });
            const saleable = type.category === "PARKING" || type.category === "STORAGE" ? text(unit.internal) : worked.grossArea;
            // Stored as the Units table shows it, "PT-1201", so every code is unique in its project.
            const code = unitLabel(building.code, unit.code);
            return {
              id: unitIdOf(layout.key, code),
              companyId: layout.companyId,
              projectId: layout.projectId,
              floorId,
              unitCode: code,
              unitCodeKey: structureKey(code),
              name: unit.name ?? null,
              unitTypeId: type.id,
              orientation: unit.orientation ?? null,
              position: unit.position ?? null,
              internalArea: dec(unit.internal),
              balconyArea: unit.balcony === undefined ? null : dec(unit.balcony),
              outdoorArea: unit.balcony === undefined && unit.terrace === undefined ? null : dec((unit.balcony ?? 0) + (unit.terrace ?? 0)),
              terraceArea: unit.terrace === undefined ? null : dec(unit.terrace),
              gardenArea: unit.garden === undefined ? null : dec(unit.garden),
              commonAreaAllocation: unit.common === undefined ? null : dec(unit.common),
              netArea: worked.netArea === null ? null : new Prisma.Decimal(worked.netArea),
              grossArea: worked.grossArea === null ? null : new Prisma.Decimal(worked.grossArea),
              saleableArea: saleable === null ? null : new Prisma.Decimal(saleable),
              bedrooms: unit.bedrooms ?? null,
              bathrooms: unit.bathrooms ?? null,
              storage: unit.storage ?? null,
              attributes: unit.attributes ?? undefined,
              sortOrder: index + 1,
              createdBy: layout.createdBy,
              createdAt: laidOut,
              publicationStatus: "PUBLISHED" as const,
              publicationStatusChangedAt: laidOut,
            };
          }),
        });
        units += plan.units.length;
      }
    }
  }

  const files = await addUnitFiles(prisma, clock);
  await publishAll(prisma);
  return { units, files };
}

/**
 * A Sales Plan and a floor plan on the units the sales team shows first: the
 * corner flats and penthouses, a typical office, a warehouse bay, a villa.
 */
async function addUnitFiles(prisma: PrismaClient, clock: Clock): Promise<number> {
  const showcase: Record<string, string[]> = {
    prt: ["PT-101", "PT-904", "PT-1201", "PT-1801", "PT-G01"],
    nyj: ["WA-01", "WA-04", "SB-103"],
    lgm: ["A-101", "A-104", "A-501", "A-1001", "B-504", "A-G01"],
    ksb: ["R1-G01", "R1-104", "R2-201", "R2-204", "R2-501", "SR-04"],
    prd: ["A-102", "A-305", "A-901", "B-202", "A-G03"],
    kdv: ["A-01", "B-04", "C-08"],
  };
  const hues = ["#3b6ea0", "#a0583b", "#5b8a3b", "#7a4f8a", "#2f7f86", "#8a6f3b"];
  let files = 0;
  for (const layout of LAYOUTS) {
    const codes = showcase[layout.key] ?? [];
    if (codes.length === 0) continue;
    const cast = await castOf(prisma, layout.companyId);
    const rand = random(`files:${layout.key}`);
    for (const [index, code] of codes.entries()) {
      const unitId = unitIdOf(layout.key, code);
      const uploaded = at(clock, layout.laidOut + 20 + rand.int(0, 30));
      const slug = `${layout.key}_${code.toLowerCase().replace(/[^a-z0-9]+/g, "")}`;
      const plan = await unitFile(prisma, { id: `doc_unit_${slug}_sales_plan`, companyId: layout.companyId, unitId, name: `${code} Sales Plan.pdf`, bytes: placeholderPdf(`${code} Sales Plan`), memberId: cast.member("architect"), createdBy: cast.user("architect"), uploaded });
      await prisma.projectUnit.update({ where: { id: unitId }, data: { salesPlanDocumentId: plan } });
      const image = await unitFile(prisma, { id: `doc_unit_${slug}_plan_image`, companyId: layout.companyId, unitId, name: `${code} floor plan.jpg`, bytes: await jpeg(floorPlanSvg(`${code} — floor plan`, hues[index % hues.length]!)), memberId: cast.member("architect"), createdBy: cast.user("architect"), uploaded });
      await prisma.unitMedia.create({ data: { companyId: layout.companyId, projectId: layout.projectId, unitId, documentId: image, category: "FLOOR_PLAN_IMAGE", isPrimary: true, sortOrder: 1, createdByMemberId: cast.member("architect"), createdAt: uploaded } });
      files += 2;
    }
  }
  return files;
}

/** Version 1 of every new unit, published when it was laid out (or when its files went up). */
async function publishAll(prisma: PrismaClient) {
  for (const layout of LAYOUTS) {
    const units = await prisma.projectUnit.findMany({ where: { projectId: layout.projectId, currentPublicationId: null }, select: { id: true, createdAt: true, salesPlanDocumentId: true } });
    const states = await loadPublishStates(prisma as unknown as Prisma.TransactionClient, layout.companyId, units.map((unit) => unit.id));
    const rows: Prisma.UnitPublicationCreateManyInput[] = units.map((unit) => {
      const snapshot = buildSnapshot(states.get(unit.id)!.facts);
      return {
        id: `pub_${unit.id}_v1`,
        companyId: layout.companyId,
        projectId: layout.projectId,
        unitId: unit.id,
        versionNumber: 1,
        publishedAt: unit.createdAt,
        publishedByMemberId: null,
        snapshot: snapshot as unknown as Prisma.InputJsonValue,
        salesPlanDocumentId: snapshot.salesPlan?.documentId ?? null,
        salesPlanDocumentVersionId: snapshot.salesPlan?.documentVersionId ?? null,
        primaryMediaDocumentId: snapshot.primaryImage?.documentId ?? null,
        primaryMediaDocumentVersionId: snapshot.primaryImage?.documentVersionId ?? null,
        createdAt: unit.createdAt,
      };
    });
    await prisma.unitPublication.createMany({ data: rows });
    await prisma.$executeRawUnsafe(`update project_units set "currentPublicationId" = 'pub_' || id || '_v1', "hasUnpublishedChanges" = false where "projectId" = $1 and "currentPublicationId" is null`, layout.projectId);
  }
}
