import { Prisma, type PrismaClient } from "@prisma/client";

import { defaultUnitTypeRows } from "../../config/unit-types";
import { floorKeyOf, structureKey } from "../../lib/modules/project-structure/structure.rules";
import { clearUnitPublishing } from "./unit-publishing";
import { clearUnitFinance } from "./unit-finance";
import { clearUnitSales } from "./unit-sales";

/**
 * Project structure demo data (E-05B §3, §145).
 *
 * Riverside Residences is "96 apartments across three blocks": Blocks A, B and
 * C, each with a basement of parking and storage, two shops on the ground
 * floor and four apartments on each of floors 1–8 — so Floor 1 exists in all
 * three blocks. Block A also has a roof level with nothing on it. Central
 * Office Tower is left without a structure, for the empty state and for the
 * browser tests to build one. Company B's Munich Workspace Fitout has one
 * building of offices, for isolation. Re-running replaces all three.
 */

const COMPANY_A = "company_demo_a";
const COMPANY_B = "company_demo_b";
const RIVERSIDE = "project_a";
const CENTRAL_TOWER = "project_b";
const MUNICH = "project_b_one";

export const STRUCTURE_SEED = {
  riverside: RIVERSIDE,
  emptyProject: CENTRAL_TOWER,
  companyBProject: MUNICH,
  buildings: { a: "bld_riverside_a", b: "bld_riverside_b", c: "bld_riverside_c", munich: "bld_munich_main" },
  floors: { aBasement: "flr_riverside_a_b1", aGround: "flr_riverside_a_0", a1: "flr_riverside_a_1", a8: "flr_riverside_a_8", aRoof: "flr_riverside_a_roof", b1: "flr_riverside_b_1", munichGround: "flr_munich_0" },
  units: { a101: "unit_riverside_a_101", a104: "unit_riverside_a_104", b101: "unit_riverside_b_101", aParking1: "unit_riverside_a_p01", munichOffice1: "unit_munich_of001" },
} as const;

/** The four apartments of a typical floor: a corner, the front, the rear and the other corner. */
const TYPICAL = [
  { slot: 1, position: "CORNER", orientation: "NE", bedrooms: 2, bathrooms: 2, rooms: 3, internal: "92.40", gross: "104.10", balcony: "12.00", common: "8.60", saleable: "113.00" },
  { slot: 2, position: "FRONT", orientation: "E", bedrooms: 1, bathrooms: 1, rooms: 2, internal: "64.20", gross: "72.80", balcony: "8.50", common: "5.80", saleable: "78.50" },
  { slot: 3, position: "REAR", orientation: "W", bedrooms: 1, bathrooms: 1, rooms: 2, internal: "61.80", gross: "70.10", balcony: "8.00", common: "5.60", saleable: "75.40" },
  { slot: 4, position: "CORNER", orientation: "SW", bedrooms: 3, bathrooms: 2, rooms: 4, internal: "118.60", gross: "132.90", balcony: "14.50", common: "9.20", saleable: "142.30" },
] as const;

const dec = (value: string | null) => (value === null ? null : new Prisma.Decimal(value));

export async function seedStructureRecords(prisma: PrismaClient, members: Map<string, string>) {
  const actor = members.get("user_pm") ? (await prisma.companyMember.findUniqueOrThrow({ where: { id: members.get("user_pm")! }, select: { userId: true } })).userId : "seed";
  const actorB = members.get("user_owner_b") ? (await prisma.companyMember.findUniqueOrThrow({ where: { id: members.get("user_owner_b")! }, select: { userId: true } })).userId : "seed";

  // Every company starts with the default unit types; a fresh database has none
  // until now, because the migration ran before the companies existed.
  for (const companyId of [COMPANY_A, COMPANY_B, "company_demo_suspended"]) {
    if (await prisma.company.findUnique({ where: { id: companyId }, select: { id: true } })) {
      await prisma.projectUnitType.createMany({ data: defaultUnitTypeRows(companyId), skipDuplicates: true });
    }
  }
  const typesOf = async (companyId: string) => new Map((await prisma.projectUnitType.findMany({ where: { companyId }, select: { id: true, code: true } })).map((row) => [row.code, row.id]));
  const typesA = await typesOf(COMPANY_A);
  const typesB = await typesOf(COMPANY_B);

  // Whatever a previous seed or a test left on these projects makes way.
  const projects = [RIVERSIDE, CENTRAL_TOWER, MUNICH];
  // Their contracts and collection, sales, publications, media, files and requests first: they point at the units (E-05D, E-05E, E-05F).
  await clearUnitFinance(prisma, projects);
  await clearUnitSales(prisma, projects);
  await clearUnitPublishing(prisma, projects);
  await prisma.projectUnit.deleteMany({ where: { projectId: { in: projects } } });
  await prisma.projectFloor.deleteMany({ where: { projectId: { in: projects } } });
  await prisma.projectBuilding.deleteMany({ where: { projectId: { in: projects } } });

  const B = STRUCTURE_SEED.buildings;
  let units = 0;
  let floors = 0;

  const building = (companyId: string, projectId: string, id: string, name: string, code: string, sortOrder: number, createdBy: string, description?: string) =>
    prisma.projectBuilding.create({ data: { id, companyId, projectId, name, nameKey: structureKey(name), code, codeKey: structureKey(code), sortOrder, description, createdBy } });

  const floor = async (companyId: string, projectId: string, buildingId: string, id: string, levelType: "BASEMENT" | "GROUND" | "STANDARD" | "ROOF", number: number | null, name: string, sortOrder: number, createdBy: string, elevation?: string) => {
    floors += 1;
    return prisma.projectFloor.create({ data: { id, companyId, projectId, buildingId, levelType, number, name, floorKey: floorKeyOf(levelType, number, name), sortOrder, elevation: elevation ? dec(elevation) : null, createdBy } });
  };

  type UnitSeed = Omit<Prisma.ProjectUnitCreateManyInput, "companyId" | "projectId" | "floorId" | "unitCodeKey" | "sortOrder" | "createdBy">;
  const unitsOn = async (companyId: string, projectId: string, floorId: string, rows: UnitSeed[], createdBy: string) => {
    units += rows.length;
    await prisma.projectUnit.createMany({
      data: rows.map((row, index) => ({ ...row, companyId, projectId, floorId, unitCodeKey: structureKey(row.unitCode), sortOrder: index + 1, createdBy })),
    });
  };

  /* Riverside Residences: three blocks ------------------------------------- */

  for (const [blockIndex, block] of (["A", "B", "C"] as const).entries()) {
    const buildingId = B[block.toLowerCase() as "a" | "b" | "c"];
    const lower = block.toLowerCase();
    await building(COMPANY_A, RIVERSIDE, buildingId, `Block ${block}`, block, blockIndex + 1, actor, `Residential block ${block} on the river frontage.`);

    let order = 0;
    const basement = await floor(COMPANY_A, RIVERSIDE, buildingId, `flr_riverside_${lower}_b1`, "BASEMENT", -1, "Basement 1", ++order, actor, "-3.20");
    await unitsOn(
      COMPANY_A,
      RIVERSIDE,
      basement.id,
      [
        ...[1, 2, 3, 4, 5, 6].map((n) => ({
          ...(block === "A" && n === 1 ? { id: STRUCTURE_SEED.units.aParking1 } : {}),
          unitCode: `P-${block}0${n}`,
          name: `Parking ${block}0${n}`,
          unitTypeId: typesA.get("PARKING")!,
          internalArea: dec("12.50"),
          saleableArea: dec("12.50"),
          attributes: { covered: true, evReady: n <= 2 },
        })),
        ...[1, 2].map((n) => ({ unitCode: `S-${block}0${n}`, name: `Storage ${block}0${n}`, unitTypeId: typesA.get("STORAGE")!, internalArea: dec("6.00"), saleableArea: dec("6.00") })),
      ],
      actor,
    );

    const ground = await floor(COMPANY_A, RIVERSIDE, buildingId, `flr_riverside_${lower}_0`, "GROUND", 0, "Ground Floor", ++order, actor, "0.00");
    await unitsOn(
      COMPANY_A,
      RIVERSIDE,
      ground.id,
      [1, 2].map((n) => ({
        unitCode: `SH-${block}0${n}`,
        name: `Shop ${block}0${n}`,
        unitTypeId: typesA.get("SHOP")!,
        position: "FRONT" as const,
        orientation: "S" as const,
        internalArea: dec(n === 1 ? "84.00" : "71.50"),
        grossArea: dec(n === 1 ? "92.00" : "78.00"),
        saleableArea: dec(n === 1 ? "92.00" : "78.00"),
        bathrooms: 1,
        attributes: { frontage: n === 1 ? "9.40" : "7.80", ceilingHeight: "4.20" },
      })),
      actor,
    );

    for (let level = 1; level <= 8; level += 1) {
      const standard = await floor(COMPANY_A, RIVERSIDE, buildingId, `flr_riverside_${lower}_${level}`, "STANDARD", level, `Floor ${level}`, ++order, actor, (3.1 * level).toFixed(2));
      await unitsOn(
        COMPANY_A,
        RIVERSIDE,
        standard.id,
        TYPICAL.map((plan) => {
          const code = `${block}-${level}0${plan.slot}`;
          const seededId = block === "A" && level === 1 && plan.slot === 1 ? STRUCTURE_SEED.units.a101 : block === "A" && level === 1 && plan.slot === 4 ? STRUCTURE_SEED.units.a104 : block === "B" && level === 1 && plan.slot === 1 ? STRUCTURE_SEED.units.b101 : undefined;
          return {
            ...(seededId ? { id: seededId } : {}),
            unitCode: code,
            name: `Apartment ${level}0${plan.slot}`,
            unitTypeId: typesA.get("APARTMENT")!,
            position: plan.position,
            orientation: plan.orientation,
            internalArea: dec(plan.internal),
            grossArea: dec(plan.gross),
            balconyArea: dec(plan.balcony),
            outdoorArea: dec(plan.balcony),
            commonAreaAllocation: dec(plan.common),
            saleableArea: dec(plan.saleable),
            rooms: plan.rooms,
            bedrooms: plan.bedrooms,
            bathrooms: plan.bathrooms,
          };
        }),
        actor,
      );
    }

    if (block === "A") await floor(COMPANY_A, RIVERSIDE, buildingId, STRUCTURE_SEED.floors.aRoof, "ROOF", null, "Roof", ++order, actor, "26.40");
  }

  /* Company B: one building of offices ------------------------------------- */

  await building(COMPANY_B, MUNICH, B.munich, "Main Building", "MB", 1, actorB);
  const munichGround = await floor(COMPANY_B, MUNICH, B.munich, STRUCTURE_SEED.floors.munichGround, "GROUND", 0, "Erdgeschoss", 1, actorB);
  await unitsOn(
    COMPANY_B,
    MUNICH,
    munichGround.id,
    [1, 2, 3].map((n) => ({
      ...(n === 1 ? { id: STRUCTURE_SEED.units.munichOffice1 } : {}),
      unitCode: `OF-00${n}`,
      name: `Office 00${n}`,
      unitTypeId: typesB.get("OFFICE")!,
      internalArea: dec("148.00"),
      saleableArea: dec("160.00"),
      rooms: 4,
      bathrooms: 1,
    })),
    actorB,
  );
  await floor(COMPANY_B, MUNICH, B.munich, "flr_munich_1", "STANDARD", 1, "1. Obergeschoss", 2, actorB);

  return { buildings: 4, floors, units };
}
