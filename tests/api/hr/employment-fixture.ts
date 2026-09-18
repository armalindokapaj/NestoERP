import { snapshotEmploymentsWith } from "../../support/employment-snapshot";
import { prisma } from "../../helpers";

/** Snapshot and restore of an employment and everything a change touches (E-03); see `tests/support/employment-snapshot.ts`. */
export function snapshotEmployments(employmentIds: string[]): Promise<() => Promise<void>> {
  return snapshotEmploymentsWith(prisma, employmentIds);
}
