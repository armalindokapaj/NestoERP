/**
 * Project types (E-05A §18.3).
 *
 * A code-defined list, because NESTO had no configurable taxonomy to reuse and
 * a company-editable one is more than discovery needs. The stored value is the
 * key, never the label, so renaming "Mixed Use" is a one-line change here and
 * no migration. `OTHER` exists so a project that fits nothing is still typed.
 */
export const PROJECT_TYPE_KEYS = [
  "RESIDENTIAL",
  "COMMERCIAL",
  "HOSPITAL",
  "HOTEL",
  "INDUSTRIAL",
  "INFRASTRUCTURE",
  "MIXED_USE",
  "OTHER",
] as const;

export type ProjectTypeKey = (typeof PROJECT_TYPE_KEYS)[number];

export const PROJECT_TYPE_LABELS: Record<ProjectTypeKey, string> = {
  RESIDENTIAL: "Residential",
  COMMERCIAL: "Commercial",
  HOSPITAL: "Hospital",
  HOTEL: "Hotel",
  INDUSTRIAL: "Industrial",
  INFRASTRUCTURE: "Infrastructure",
  MIXED_USE: "Mixed use",
  OTHER: "Other",
};

export function isProjectTypeKey(value: string | null | undefined): value is ProjectTypeKey {
  return (PROJECT_TYPE_KEYS as readonly string[]).includes(value ?? "");
}

/** The label for a stored key; an unknown key reads as itself rather than vanishing. */
export function projectTypeLabel(value: string | null | undefined): string | null {
  if (!value) return null;
  return isProjectTypeKey(value) ? PROJECT_TYPE_LABELS[value] : value;
}

/** Keys whose label contains the search text, so "hosp" finds hospital projects (E-05A §16). */
export function projectTypesMatching(search: string): ProjectTypeKey[] {
  const needle = search.trim().toLowerCase();
  if (!needle) return [];
  return PROJECT_TYPE_KEYS.filter((key) => PROJECT_TYPE_LABELS[key].toLowerCase().includes(needle));
}
