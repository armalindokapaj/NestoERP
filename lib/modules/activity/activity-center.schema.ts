import { z } from "zod";

import { ACTIVITY_TYPES } from "./activity-center.service";

/** Activity Center query string (Activity Center §37-§41, §73). Legacy lowercase tab names are accepted. */
export const activityQuerySchema = z.object({
  type: z
    .string()
    .optional()
    .transform((value) => {
      const upper = (value ?? "ALL").toUpperCase().replace(/S$/, "");
      return (ACTIVITY_TYPES as readonly string[]).includes(upper) ? (upper as (typeof ACTIVITY_TYPES)[number]) : "ALL";
    }),
  companyId: z.string().max(64).optional(),
  moduleKey: z.string().max(40).optional(),
  priority: z.enum(["NORMAL", "IMPORTANT", "CRITICAL"]).optional(),
  readState: z.enum(["UNREAD", "READ"]).optional(),
  q: z.string().max(200).optional(),
  from: z.string().date().optional(),
  to: z.string().date().optional(),
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(50).optional(),
});

export type ActivityQuery = z.infer<typeof activityQuerySchema>;

export function activityFilters(input: ActivityQuery) {
  return {
    ...input,
    from: input.from ? new Date(`${input.from}T00:00:00`) : null,
    to: input.to ? new Date(`${input.to}T23:59:59.999`) : null,
  };
}
