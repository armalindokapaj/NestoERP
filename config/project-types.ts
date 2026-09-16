/**
 * The project types every company starts with (E-05A §30, §62).
 *
 * Only a starting point. Each company keeps its own list in `project_types` —
 * renaming, adding, ordering and retiring types from Projects → Project types —
 * because NESTO is meant to run more than construction firms, and a hospital
 * builder and a software house do not type their projects alike. Nothing reads
 * this list at runtime except to create a new company's rows; migration
 * `20260917090000_project_types_e05a` wrote the same eight for the companies
 * that already existed.
 */
export const DEFAULT_PROJECT_TYPES = [
  "Residential",
  "Commercial",
  "Hospital",
  "Hotel",
  "Industrial",
  "Infrastructure",
  "Mixed use",
  "Other",
] as const;

/** The rows a new company is created with, in the order the list shows them. */
export function defaultProjectTypeRows(companyId: string) {
  return DEFAULT_PROJECT_TYPES.map((name, index) => ({ companyId, name, sortOrder: index + 1 }));
}

export const PROJECT_TYPE_NAME_MAX = 60;
