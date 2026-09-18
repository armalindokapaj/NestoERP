import type { Prisma } from "@prisma/client";

import type { UserContext } from "@/lib/context/types";

/**
 * The organization's door for a membership's placement (E-13 §24-§29, ADR 0003;
 * E-03 §187, ADR 0004).
 *
 * A membership's department is its home branch, and a home branch always has
 * the person's MEMBER place in the department's team, which is the
 * organization's record; and somebody employed here has their department and
 * title in HR's employment history, which records every change rather than
 * losing the old one. So wherever Team places a membership or retitles it —
 * moving a member, accepting an invitation — it hands the change to this door,
 * in the same transaction, after writing the membership; the door reads the
 * membership as it now stands. The caller passes it in: Team imports neither
 * the organization nor HR, which already import Team's doors (the same shape
 * as `PersonDoor`, docs/domain-dependencies.md).
 */
export type PlacementDoor = (
  tx: Prisma.TransactionClient,
  input: {
    companyId: string;
    userId: string;
    fromDepartmentId: string | null;
    toDepartmentId: string | null;
    /** The member who made the change, audited as such; null when the person joined by accepting an invitation. */
    actor: UserContext | null;
  },
) => Promise<void>;
