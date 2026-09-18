/**
 * Buildings, floors and units of Tirana Lake and Square 21 (D-01 §20, §21, §54,
 * §55; E-05B, E-05D).
 *
 * A demonstration subset, not the built area: Tirana Lake's first phase — a
 * residential tower, an office tower and a commercial podium, 77 units — and
 * Square 21's two blocks, 52 units. Apartments are sold by typology (1+1 to
 * 5+1, §55); areas, layouts and every price are synthetic.
 *
 * Every unit a buyer can see is published the way the product publishes one: a
 * Sales Plan and a primary floor plan, both canonical documents filed against
 * the unit, then the publish readiness check and a snapshot (E-05D). Parking
 * stays unpublished. Stable ids; a rerun adds nothing.
 */
import { Prisma, type PrismaClient, type UnitOrientation, type UnitPosition } from "@prisma/client";

import { defaultUnitTypeRows } from "../../../config/unit-types";
import { floorKeyOf, structureKey } from "../../../lib/modules/project-structure/structure.rules";
import { placeholderPdf } from "../document-objects";
import { floorPlanSvg, jpeg, publish, unitFile } from "../unit-publishing";
import { memberId } from "./access";
import { companyId } from "./organization";
import { userId } from "./people";
import type { ProjectCode } from "./public-facts";
import { projectId } from "./projects";

const BCI = "BUILDING_CONSTRUCTION_INVEST" as const;
const DAY = 86_400_000;
const daysAgo = (days: number) => new Date(Date.now() - days * DAY);
const dec = (value: number | null) => (value === null ? null : new Prisma.Decimal(value.toFixed(2)));

/** The typologies ARMAAR's apartments are sold by (§55). */
const TYPOLOGIES = [
  { code: "APT11", name: "Apartment 1+1", bedrooms: 1 },
  { code: "APT21", name: "Apartment 2+1", bedrooms: 2 },
  { code: "APT31", name: "Apartment 3+1", bedrooms: 3 },
  { code: "APT41", name: "Apartment 4+1", bedrooms: 4 },
  { code: "PH51", name: "Penthouse 5+1", bedrooms: 5 },
] as const;
type TypeCode = (typeof TYPOLOGIES)[number]["code"] | "OFFICE" | "SHOP" | "PARKING";

type Plan = { type: TypeCode; area: number; position?: UnitPosition; orientation?: UnitOrientation; balcony?: number };

const TOWER_FLOOR: Plan[] = [
  { type: "APT21", area: 98, position: "CORNER", orientation: "NE", balcony: 12 },
  { type: "APT11", area: 64, position: "FRONT", orientation: "E", balcony: 8 },
  { type: "APT11", area: 62, position: "REAR", orientation: "W", balcony: 8 },
  { type: "APT31", area: 128, position: "CORNER", orientation: "SW", balcony: 16 },
];
const SQUARE_FLOOR: Plan[] = [
  { type: "APT21", area: 92, position: "CORNER", orientation: "N", balcony: 10 },
  { type: "APT11", area: 61, position: "FRONT", orientation: "E", balcony: 7 },
  { type: "APT21", area: 88, position: "REAR", orientation: "W", balcony: 10 },
  { type: "APT31", area: 118, position: "CORNER", orientation: "S", balcony: 14 },
];

export type SeededUnit = { id: string; code: string; project: ProjectCode; type: TypeCode; area: number; floor: number; publish: boolean };

type Level = { key: string; name: string; levelType: "BASEMENT" | "GROUND" | "STANDARD" | "ROOF"; number: number | null; units: Array<{ code: string } & Plan> };
type Building = { key: string; name: string; code: string; description: string; levels: Level[] };

function towerA(): Building {
  const levels: Level[] = [
    { key: "b1", name: "Basement 1", levelType: "BASEMENT", number: -1, units: Array.from({ length: 10 }, (_, n) => ({ code: `P-A${String(n + 1).padStart(2, "0")}`, type: "PARKING" as const, area: 12.5 })) },
    { key: "0", name: "Ground Floor", levelType: "GROUND", number: 0, units: Array.from({ length: 4 }, (_, n) => ({ code: `SH-A0${n + 1}`, type: "SHOP" as const, area: [96, 84, 78, 110][n]!, position: "FRONT" as const, orientation: "S" as const })) },
  ];
  for (let floor = 1; floor <= 10; floor += 1) {
    levels.push({ key: String(floor), name: `Floor ${floor}`, levelType: "STANDARD", number: floor, units: TOWER_FLOOR.map((plan, slot) => ({ code: `A-${floor}0${slot + 1}`, ...plan })) });
  }
  levels.push({ key: "11", name: "Floor 11", levelType: "STANDARD", number: 11, units: [1, 2].map((slot) => ({ code: `A-110${slot}`, type: "APT41" as const, area: 168, position: "CORNER" as const, orientation: slot === 1 ? ("NE" as const) : ("SW" as const), balcony: 22 })) });
  levels.push({ key: "12", name: "Floor 12", levelType: "STANDARD", number: 12, units: [{ code: "A-1201", type: "PH51" as const, area: 236, position: "CORNER" as const, orientation: "S" as const, balcony: 64 }] });
  return { key: "a", name: "Tower A — Residences", code: "A", description: "Residential tower on the lake front.", levels };
}

function towerB(): Building {
  const levels: Level[] = [{ key: "0", name: "Ground Floor", levelType: "GROUND", number: 0, units: [1, 2].map((n) => ({ code: `SH-B0${n}`, type: "SHOP" as const, area: n === 1 ? 88 : 72, position: "FRONT" as const, orientation: "N" as const })) }];
  for (let floor = 1; floor <= 6; floor += 1) {
    levels.push({ key: String(floor), name: `Floor ${floor}`, levelType: "STANDARD", number: floor, units: [1, 2].map((slot) => ({ code: `OF-B${floor}0${slot}`, type: "OFFICE" as const, area: slot === 1 ? 240 : 185, position: slot === 1 ? ("CORNER" as const) : ("FRONT" as const), orientation: slot === 1 ? ("NE" as const) : ("E" as const) })) });
  }
  return { key: "b", name: "Tower B — Offices", code: "B", description: "Office tower over a retail ground floor.", levels };
}

function podium(): Building {
  return {
    key: "p",
    name: "Podium — Retail",
    code: "P",
    description: "Commercial podium between the towers, opening onto the promenade.",
    levels: [{ key: "0", name: "Ground Floor", levelType: "GROUND", number: 0, units: Array.from({ length: 6 }, (_, n) => ({ code: `SH-P0${n + 1}`, type: "SHOP" as const, area: [140, 96, 96, 120, 180, 210][n]!, position: "FRONT" as const, orientation: "S" as const })) }],
  };
}

function squareBlock(block: 1 | 2): Building {
  const levels: Level[] = [{ key: "0", name: "Ground Floor", levelType: "GROUND", number: 0, units: [1, 2].map((n) => ({ code: `SH-${block}0${n}`, type: "SHOP" as const, area: n === 1 ? 82 : 68, position: "FRONT" as const, orientation: "E" as const })) }];
  for (let floor = 1; floor <= 6; floor += 1) {
    levels.push({ key: String(floor), name: `Floor ${floor}`, levelType: "STANDARD", number: floor, units: SQUARE_FLOOR.map((plan, slot) => ({ code: `${block}-${floor}0${slot + 1}`, ...plan })) });
  }
  return { key: `b${block}`, name: `Block ${block}`, code: String(block), description: `Residential block ${block} on the square.`, levels };
}

const LAYOUT: Record<"TIRANA_LAKE" | "SQUARE_21", Building[]> = {
  TIRANA_LAKE: [towerA(), towerB(), podium()],
  SQUARE_21: [squareBlock(1), squareBlock(2)],
};

const HUES = ["#3b6ea0", "#a0583b", "#5b8a3b", "#7a4f8a", "#8a7a3b"];

export async function seedArmaarUnits(prisma: PrismaClient): Promise<SeededUnit[]> {
  const company = companyId(BCI);
  await prisma.projectUnitType.createMany({ data: defaultUnitTypeRows(company), skipDuplicates: true });
  await prisma.projectUnitType.createMany({
    data: TYPOLOGIES.map((typology, index) => ({ companyId: company, code: typology.code, name: typology.name, category: "RESIDENTIAL" as const, sortOrder: 20 + index })),
    skipDuplicates: true,
  });
  const typeId = new Map((await prisma.projectUnitType.findMany({ where: { companyId: company }, select: { id: true, code: true } })).map((row) => [row.code, row.id]));

  const architect = memberId("bci.architect", BCI);
  const architectUser = userId("bci.architect");
  const publisher = memberId("bci.director", BCI);
  const seeded: SeededUnit[] = [];
  // One drawing per typology and size, reused for every unit that has it.
  const drawings = new Map<string, Uint8Array>();

  for (const [projectCode, buildings] of Object.entries(LAYOUT) as Array<["TIRANA_LAKE" | "SQUARE_21", Building[]]>) {
    const project = projectId(projectCode);
    const prefix = projectCode === "TIRANA_LAKE" ? "tl" : "sq21";
    const finished = projectCode === "SQUARE_21";

    for (const [buildingIndex, building] of buildings.entries()) {
      const buildingId = `armaar_bld_${prefix}_${building.key}`;
      await prisma.projectBuilding.upsert({
        where: { id: buildingId },
        update: {},
        create: { id: buildingId, companyId: company, projectId: project, name: building.name, nameKey: structureKey(building.name), code: building.code, codeKey: structureKey(building.code), sortOrder: buildingIndex + 1, description: building.description, createdBy: architectUser },
      });

      for (const [levelIndex, level] of building.levels.entries()) {
        const floorId = `armaar_flr_${prefix}_${building.key}_${level.key}`;
        await prisma.projectFloor.upsert({
          where: { id: floorId },
          update: {},
          create: { id: floorId, companyId: company, projectId: project, buildingId, levelType: level.levelType, number: level.number, name: level.name, floorKey: floorKeyOf(level.levelType, level.number, level.name), sortOrder: levelIndex + 1, elevation: dec((level.number ?? 0) * 3.2), createdBy: architectUser },
        });

        await prisma.projectUnit.createMany({
          skipDuplicates: true,
          data: level.units.map((unit, index) => {
            const typology = TYPOLOGIES.find((candidate) => candidate.code === unit.type);
            const residential = Boolean(typology);
            return {
              id: unitIdOf(prefix, unit.code),
              companyId: company,
              projectId: project,
              floorId,
              unitCode: unit.code,
              unitCodeKey: structureKey(unit.code),
              name: residential ? `${typology!.name} ${unit.code}` : unit.type === "PARKING" ? `Parking ${unit.code}` : unit.type === "OFFICE" ? `Office ${unit.code}` : `Shop ${unit.code}`,
              unitTypeId: typeId.get(unit.type)!,
              position: unit.position ?? null,
              orientation: unit.orientation ?? null,
              internalArea: dec(unit.area),
              grossArea: dec(unit.area * 1.12),
              saleableArea: dec(unit.area * 1.18 + (unit.balcony ?? 0) * 0.5),
              balconyArea: dec(unit.balcony ?? null),
              outdoorArea: dec(unit.balcony ?? null),
              commonAreaAllocation: residential ? dec(unit.area * 0.09) : null,
              rooms: residential ? typology!.bedrooms + 1 : unit.type === "OFFICE" ? 6 : null,
              bedrooms: residential ? typology!.bedrooms : null,
              bathrooms: residential ? (typology!.bedrooms >= 3 ? 2 : 1) : unit.type === "PARKING" ? null : 1,
              sortOrder: index + 1,
              createdBy: architectUser,
            };
          }),
        });

        for (const unit of level.units) {
          const id = unitIdOf(prefix, unit.code);
          const sellable = unit.type !== "PARKING";
          // Tirana Lake's penthouse and its two 4+1s are still being drawn: not published yet.
          const draft = projectCode === "TIRANA_LAKE" && (unit.type === "PH51" || unit.type === "APT41");
          const toPublish = sellable && !draft;
          seeded.push({ id, code: unit.code, project: projectCode, type: unit.type, area: unit.area, floor: level.number ?? 0, publish: toPublish });
          if (!toPublish) continue;

          const current = await prisma.projectUnit.findUniqueOrThrow({ where: { id }, select: { publicationStatus: true } });
          if (current.publicationStatus === "PUBLISHED") continue;
          const uploaded = daysAgo(finished ? 1200 : 200);
          const slug = unit.code.toLowerCase().replace(/[^a-z0-9]/g, "");
          const plan = await unitFile(prisma, { id: `armaar_doc_${prefix}_${slug}_sales_plan`, companyId: company, unitId: id, name: `${unit.code} Sales Plan.pdf`, bytes: placeholderPdf(`${unit.code} Sales Plan`), memberId: architect, createdBy: architectUser, uploaded });
          await prisma.projectUnit.update({ where: { id }, data: { salesPlanDocumentId: plan } });
          const drawingKey = `${unit.type}:${unit.area}`;
          if (!drawings.has(drawingKey)) drawings.set(drawingKey, await jpeg(floorPlanSvg(`${unit.type === "SHOP" ? "Shop" : unit.type === "OFFICE" ? "Office" : TYPOLOGIES.find((t) => t.code === unit.type)!.name} — ${unit.area} m²`, HUES[drawings.size % HUES.length]!)));
          const image = await unitFile(prisma, { id: `armaar_doc_${prefix}_${slug}_plan_image`, companyId: company, unitId: id, name: `${unit.code} floor plan.jpg`, bytes: drawings.get(drawingKey)!, memberId: architect, createdBy: architectUser, uploaded });
          await prisma.unitMedia.create({ data: { companyId: company, projectId: project, unitId: id, documentId: image, category: "FLOOR_PLAN_IMAGE", isPrimary: true, sortOrder: 1, createdByMemberId: architect, createdAt: uploaded } });
          await publish(prisma, id, 1, publisher, new Date(uploaded.getTime() + 3 * DAY), company);
        }
      }
    }
  }
  return seeded;
}

export function unitIdOf(prefix: string, code: string): string {
  return `armaar_unit_${prefix}_${code.toLowerCase().replace(/[^a-z0-9]/g, "")}`;
}
