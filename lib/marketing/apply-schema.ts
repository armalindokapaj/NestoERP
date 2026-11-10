import { z } from "zod";

import { applicantRoles, applicationDepartments, applicationKinds, companySizes, startWindows } from "@/config/marketing";
import type { SiteCopy } from "@/lib/i18n/site";

export type ApplicationErrors = SiteCopy["apply"]["errors"];

/**
 * Applying for a workspace (/apply; UI-05 §6).
 *
 * The same schema checks each step in the browser and the whole application
 * on the server: the browser copy is there to help, the server copy because a
 * browser cannot be trusted. The options come from config/marketing.ts, so an
 * answer the form offers is an answer the server accepts — and nothing else is.
 */
export function createApplicationSchema(errors: ApplicationErrors) {
  return z.object({
    company: z.string().trim().min(2, errors.companyRequired).max(120, errors.companyTooLong),
    country: z.string().trim().min(2, errors.countryRequired).max(60, errors.countryRequired),
    city: z.string().trim().min(1, errors.cityRequired).max(60, errors.cityRequired),
    kind: z.enum(applicationKinds, { message: errors.kindRequired }),
    size: z.enum(companySizes, { message: errors.sizeRequired }),
    name: z.string().trim().min(2, errors.nameRequired).max(80, errors.nameTooLong),
    email: z.string().trim().min(1, errors.emailRequired).email(errors.emailInvalid).max(160, errors.emailTooLong),
    phone: z.string().trim().max(40, errors.phoneTooLong),
    role: z.enum(applicantRoles, { message: errors.roleRequired }),
    departments: z.array(z.enum(applicationDepartments)).max(applicationDepartments.length),
    projects: z.number().int().min(1).max(99),
    users: z.number().int().min(5).max(500),
    start: z.enum(startWindows, { message: errors.startRequired }),
    consent: z.literal(true, { message: errors.consentRequired }),
    /** Honeypot: hidden from people; a submission that fills it is accepted politely and discarded. */
    website: z.string().max(0).optional(),
  });
}

export type ApplicationInput = z.infer<ReturnType<typeof createApplicationSchema>>;

/** The fields each step asks, in order — the form checks a step's fields before moving on. */
export const APPLICATION_STEPS = {
  company: ["company", "country", "city", "kind", "size"],
  you: ["name", "email", "phone", "role"],
  run: ["departments", "projects", "users", "start"],
  review: ["consent"],
} as const satisfies Record<string, readonly (keyof ApplicationInput)[]>;

export type ApplicationStep = keyof typeof APPLICATION_STEPS;

/** A reference the applicant can quote: NST, the year, and six characters nobody can guess. */
export function applicationReference(now = new Date(), random = crypto.randomUUID()): string {
  return `NST-${now.getUTCFullYear()}-${random.replaceAll("-", "").slice(0, 6).toUpperCase()}`;
}
