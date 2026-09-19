// Site/terrain slots are exempt from section cuts — a Section must never erase
// the ground the building stands on. Name- and role-based, no per-slot toggle.
import type { DetailModelSlotRole } from "@/lib/3d/runtime/types";

const SITE_SLOT_NAME_RE = /^\s*(site|terrain|landscape|surroundings?|context)\b/i;

export interface SectionScopeSlot {
  slotRole?: DetailModelSlotRole;
  slotName?: string;
}

export function isSlotCutBySections(slot: SectionScopeSlot): boolean {
  if (slot.slotRole === "surroundings" || slot.slotRole === "context") return false;
  if (slot.slotName && SITE_SLOT_NAME_RE.test(slot.slotName)) return false;
  return true;
}

export const SECTION_SITE_EXEMPT_HINT =
  'Sections never cut site context: slots with the Surroundings/Context role, or whose name starts with "Site", "Terrain", "Landscape", "Surroundings" or "Context".';

