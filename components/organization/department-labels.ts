import type { PositionDTO } from "@/lib/modules/organization/departments/department.types";

/** How a department position reads (E-13 §25). Client-safe. */
export const POSITION_LABEL: Record<PositionDTO, string> = { GROUP_HEAD: "Group head", COMPANY_MANAGER: "Manager", MEMBER: "Member" };
