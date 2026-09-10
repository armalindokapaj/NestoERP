import type { RecordSection } from "./types";

/**
 * No core entity renders through the generic module shell any more.
 *
 * Tasks (PRD #11), Clients (PRD #12) and Documents (PRD #13) each began life
 * here as list/detail sections over the shared record machinery, and each has
 * since been given its own service, API, validation and pages. The registry is
 * now exactly what it was meant to be: the department modules still waiting for
 * their own PRD (PRD #7 §93).
 *
 * The file stays rather than being deleted, because the export is part of the
 * registry's contract and the next module to graduate will leave the same
 * shape behind.
 */
export const CORE_SECTIONS: RecordSection[] = [];
