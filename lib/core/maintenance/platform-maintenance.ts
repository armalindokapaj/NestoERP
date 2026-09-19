import { prisma } from "@/lib/database/prisma";

export type MaintenanceState = {
  enabled: boolean;
  readOnly: boolean;
  disableUploads: boolean;
  disableNewLogins: boolean;
  disable3DProcessing: boolean;
  reason: string | null;
};

const KEYS = [
  "maintenance.enabled",
  "maintenance.readOnly",
  "maintenance.disableUploads",
  "maintenance.disableNewLogins",
  "maintenance.disable3DProcessing",
] as const;

/** Live platform safety state. Platform routes deliberately do not call it. */
export async function getMaintenanceState(): Promise<MaintenanceState> {
  const rows = await prisma.platformSetting.findMany({ where: { key: { in: [...KEYS] } }, select: { key: true, value: true, reason: true, updatedAt: true } });
  const state: MaintenanceState = { enabled: false, readOnly: false, disableUploads: false, disableNewLogins: false, disable3DProcessing: false, reason: null };
  for (const row of rows) {
    const part = row.key.slice("maintenance.".length) as Exclude<keyof MaintenanceState, "reason">;
    if (part in state) state[part] = row.value === true;
    if (row.value === true && (!state.reason || row.key === "maintenance.enabled")) state.reason = row.reason;
  }
  return state;
}
