import type { EmploymentStatus } from "@prisma/client";

import { can } from "@/lib/access/can";
import type { UserContext } from "@/lib/context/types";
import type { EmploymentCapabilitiesDTO } from "./employment.types";

/**
 * Which employment changes this reader may offer (E-03 §63, §163). A hint for
 * the page; every change re-checks its permissions, its timing's and the
 * employment's state on the server.
 */
export function employmentCapabilities(context: UserContext | null, status: EmploymentStatus): EmploymentCapabilitiesDTO {
  const running = status !== "ENDED";
  const has = (permission: Parameters<typeof can>[1]) => context !== null && can(context, permission);
  return {
    canChangePosition: running && has("hr.employment.update"),
    canTransferDepartment: running && has("hr.employment.update"),
    canTransferCompany: running && status !== "PLANNED" && has("hr.employment.transfer_entity"),
    canChangeManager: running && has("hr.employee.manager.assign"),
    canChangeLocation: running && has("hr.employment.update"),
    canChangeEmploymentType: running && has("hr.employment.update"),
    canChangeStatus: has("hr.employee.status.update"),
    canSchedule: has("hr.employment.schedule"),
    canCorrect: has("hr.employment_history.correct"),
    canViewPrivateReason: has("hr.employment_history.view_private"),
  };
}
