import { z } from "zod";

import { companySizes, contactTopics } from "@/config/marketing";

/**
 * The one form on the public site.
 *
 * Validated with the same schema on the client and on the server: the browser
 * copy exists to be helpful, the server copy exists because the browser cannot
 * be trusted. The options come from config/marketing.ts, so a topic added to
 * the select is a topic the server will accept — and nothing else is.
 */
const topicValues = contactTopics.map((topic) => topic.value) as [string, ...string[]];
const sizeValues = companySizes.map((size) => size.value) as [string, ...string[]];

export const contactSchema = z.object({
  name: z.string().trim().min(2, "Enter your name").max(80, "That name is too long"),
  email: z
    .string()
    .trim()
    .min(1, "Enter your work email")
    .email("Enter a valid email address")
    .max(160),
  company: z.string().trim().min(2, "Enter your company").max(120, "That name is too long"),
  size: z.enum(sizeValues, { message: "Choose a company size" }),
  topic: z.enum(topicValues, { message: "Choose what this is about" }),
  message: z
    .string()
    .trim()
    .min(20, "A sentence or two, so we can answer properly")
    .max(2000, "Please keep it under 2000 characters"),
  /**
   * Honeypot. Hidden from people, irresistible to naive bots — a submission
   * that fills it is accepted politely and discarded, rather than bounced,
   * so the sender learns nothing about why.
   */
  website: z.string().max(0).optional(),
});

export type ContactInput = z.infer<typeof contactSchema>;
