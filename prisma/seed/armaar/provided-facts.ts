/**
 * What NESTO's owner supplied for ARMAAR's configuration (D-03 §3, §8, §11) —
 * the only place it lives.
 *
 * USER_PROVIDED: neither in the public source set (`public-facts.ts`) nor
 * invented. The heads of six of the group's functions and the manager of one
 * project, by name. Everything the seed puts around these people — their logins,
 * employment dates, and the work recorded under their names — stays synthetic,
 * and nothing private is made up for them (§14).
 */
import type { GroupDepartmentKey } from "../../../config/group-departments";
import type { ProjectCode } from "./public-facts";

export const PROVIDED_SOURCE = {
  label: "NESTO Demo PRD D-03, supplied by NESTO's owner for ARMAAR's configuration",
  providedAt: "2026-09-19",
} as const;

export type NamedPerson = { firstName: string; lastName: string };

/** The group's department heads (D-03 §8), in the order D-03 lists them. */
export const DEPARTMENT_HEADS: ReadonlyArray<NamedPerson & { department: GroupDepartmentKey }> = [
  { department: "procurement", firstName: "Adela", lastName: "Dervishaj" },
  { department: "finance", firstName: "Edvin", lastName: "Gace" },
  { department: "architecture", firstName: "Besar", lastName: "Zifla" },
  { department: "hse", firstName: "Arted", lastName: "Ballaj" },
  { department: "legal", firstName: "Migena", lastName: "Bajro" },
  { department: "hr", firstName: "Xhejsi", lastName: "Lilo" },
];

/** A project's manager (D-03 §11). */
export const PROJECT_MANAGERS: ReadonlyArray<NamedPerson & { project: ProjectCode }> = [
  { project: "EYES_OF_TIRANA", firstName: "Tedi", lastName: "Gogu" },
];
