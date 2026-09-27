import type { Section, Unit } from "@/lib/3d/viewer/types";
import { makeFloorId } from "@/lib/3d/viewer/units";

const FLOOR_WORDS = ["floors", "floor", "kati", "kat", "niveli", "nivel", "levels", "level", "storey", "story", "etazhi", "etazh"];
const WORDS = FLOOR_WORDS.join("|");

const LEADING = new RegExp(`(?:^|[^a-z0-9])(?:${WORDS})(?:\\s*[:.#]|[-–—])?\\s*(-?\\d{1,3})(?![0-9])`, "i");
const TRAILING = new RegExp(`(?:^|[^a-z0-9])(-?\\d{1,3})\\s*(?:st|nd|rd|th)?\\s*(?:${WORDS})(?![a-z])`, "i");

export function parseSectionFloorNumber(name: string): number | null {
  const normalized = name.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  const match = LEADING.exec(normalized) ?? TRAILING.exec(normalized);
  if (!match) return null;
  const floor = Number.parseInt(match[1], 10);
  return Number.isFinite(floor) ? floor : null;
}

export function resolveFloorSection(sections: Section[], unit: Unit): Section | null {
  return resolveSectionForFloor(sections, unit.buildingName, unit.floor);
}

export function resolveSectionForFloor(sections: Section[], buildingName: string, floor: number): Section | null {
  const visible = sections.filter((s) => !s.hidden);
  const floorId = makeFloorId(buildingName, floor);
  const explicit = visible.find((s) => s.floorId === floorId);
  if (explicit) return explicit;

  const named = visible.filter((s) => parseSectionFloorNumber(s.name) === floor);
  if (named.length === 0) return null;
  return named.find((s) => s.scope === "building" && s.buildingName === buildingName) ?? named[0];
}
