import { z } from "zod";

import { companySizes, contactTopics } from "@/config/marketing";
import type { SiteCopy } from "@/lib/i18n/site";

export type ContactErrors = SiteCopy["contact"]["form"]["errors"];

/**
 * The one form on the public site.
 *
 * Validated with the same schema on the client and on the server: the browser
 * copy exists to be helpful, the server copy exists because the browser cannot
 * be trusted. The options come from config/marketing.ts, so a topic added to
 * the select is a topic the server will accept — and nothing else is.
 *
 * Built from the messages it should answer in rather than holding its own: the
 * form passes the copy its page was rendered in, and the action the copy of
 * whoever posted, so a visitor is told what to fix in their own language.
 */
export function createContactSchema(errors: ContactErrors) {
  return z.object({
    name: z.string().trim().min(2, errors.nameRequired).max(80, errors.nameTooLong),
    email: z
      .string()
      .trim()
      .min(1, errors.emailRequired)
      .email(errors.emailInvalid)
      .max(160, errors.emailTooLong),
    company: z.string().trim().min(2, errors.companyRequired).max(120, errors.companyTooLong),
    size: z.enum(companySizes, { message: errors.sizeRequired }),
    topic: z.enum(contactTopics, { message: errors.topicRequired }),
    message: z
      .string()
      .trim()
      .min(20, errors.messageTooShort)
      .max(2000, errors.messageTooLong),
    /**
     * Honeypot. Hidden from people, irresistible to naive bots — a submission
     * that fills it is accepted politely and discarded, rather than bounced,
     * so the sender learns nothing about why.
     */
    website: z.string().max(0).optional(),
  });
}

export type ContactInput = z.infer<ReturnType<typeof createContactSchema>>;
