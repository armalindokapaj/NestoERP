export type MatchableProjectUnit = {
  id: string;
  unitCode: string;
};

export function normalizeUnitMatchKey(value: string): string {
  return value.replace(/^unit_?/i, "").replace(/[^a-z0-9]/gi, "").toLowerCase();
}

export function autoMatchUnitNodes(
  detectedNodes: string[],
  units: MatchableProjectUnit[],
  currentSelections: Record<string, string>,
): Record<string, string> {
  const next = { ...currentSelections };
  const unitsByCode = new Map(units.map((unit) => [normalizeUnitMatchKey(unit.unitCode), unit.id]));

  for (const meshName of detectedNodes) {
    if (next[meshName]) continue;
    const unitId = unitsByCode.get(normalizeUnitMatchKey(meshName));
    if (unitId) next[meshName] = unitId;
  }

  return next;
}
