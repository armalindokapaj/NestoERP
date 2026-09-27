import type { Unit } from "@/lib/3d/viewer/types";

/** Floor grouping for the floor rail and unit lists (Rozaris lib/units). */

export interface FloorGroup {
  buildingName: string;
  floor: number;
  floorId: string;
  units: Unit[];
}

export interface BuildingGroup {
  name: string;
  floors: FloorGroup[];
}

export function makeFloorId(buildingName: string, floor: number): string {
  return `${buildingName}::${floor}`;
}

export function groupUnitsByFloor(units: Unit[]): BuildingGroup[] {
  const byBuilding = new Map<string, Map<number, Unit[]>>();
  for (const u of units) {
    if (!byBuilding.has(u.buildingName)) byBuilding.set(u.buildingName, new Map());
    const byFloor = byBuilding.get(u.buildingName)!;
    if (!byFloor.has(u.floor)) byFloor.set(u.floor, []);
    byFloor.get(u.floor)!.push(u);
  }
  return Array.from(byBuilding.entries())
    .map(([name, byFloor]) => ({
      name,
      floors: Array.from(byFloor.entries())
        .map(([floor, floorUnits]): FloorGroup => ({
          buildingName: name,
          floor,
          floorId: makeFloorId(name, floor),
          units: floorUnits,
        }))
        .sort((a, b) => b.floor - a.floor),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}
