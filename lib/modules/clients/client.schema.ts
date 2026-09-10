import { z } from "zod";

import {
  optionalBoolean,
  optionalDate,
  optionalId,
  optionalText,
} from "@/lib/modules/shared/fields";
import { EDITABLE_CLIENT_STATUSES, EDITABLE_CONTACT_STATUSES } from "./client.status";

/**
 * Client and contact validation (PRD #12 §151–§154).
 *
 * `companyId`, `createdBy`, `archivedAt` and `preArchiveStatus` are absent from
 * every input schema on purpose: they are server-controlled and must never be
 * accepted from the browser (PRD #12 §123, §124).
 */

const CLIENT_TYPES = ["INDIVIDUAL", "COMPANY", "PUBLIC_ENTITY", "OTHER"] as const;

/**
 * Only http(s) is accepted. A `javascript:` or `data:` URL rendered as a link
 * would be an injection vector, not a website (PRD #12 §47, §140).
 */
const websiteField = z
  .string()
  .trim()
  .max(300)
  .optional()
  .transform((value) => (value === "" ? undefined : value))
  .refine(
    (value) => {
      if (!value) return true;
      try {
        const url = new URL(value);
        return url.protocol === "http:" || url.protocol === "https:";
      } catch {
        return false;
      }
    },
    { message: "Enter a full web address starting with http:// or https://" },
  );

const clientFields = {
  code: optionalText(50),
  name: z
    .string()
    .trim()
    .min(2, "Client name must be at least 2 characters")
    .max(200, "Client name must be 200 characters or fewer"),
  legalName: optionalText(250),
  type: z.enum(CLIENT_TYPES),
  email: z
    .string()
    .trim()
    .max(254)
    .optional()
    .transform((value) => (value === "" ? undefined : value))
    .refine((value) => !value || z.string().email().safeParse(value).success, {
      message: "Enter a valid email address",
    }),
  phone: optionalText(40),
  website: websiteField,
  address: optionalText(300),
  city: optionalText(120),
  country: optionalText(120),
  status: z.enum(EDITABLE_CLIENT_STATUSES as [string, ...string[]]).default("ACTIVE"),
};

/** The optional primary contact created alongside the client (PRD #12 §49). */
const primaryContactFields = {
  contactFirstName: optionalText(120),
  contactLastName: optionalText(120),
  contactJobTitle: optionalText(160),
  contactEmail: optionalText(254),
  contactPhone: optionalText(40),
};

export const createClientSchema = z
  .object({ ...clientFields, ...primaryContactFields, acceptDuplicate: optionalBoolean })
  .refine(
    (value) =>
      // A half-filled contact is a mistake, not a contact.
      (!value.contactFirstName && !value.contactLastName) ||
      (Boolean(value.contactFirstName) && Boolean(value.contactLastName)),
    { message: "Enter both a first and last name for the contact.", path: ["contactLastName"] },
  );

export const updateClientSchema = z.object({
  ...clientFields,
  acceptDuplicate: optionalBoolean,
  versionUpdatedAt: optionalDate,
});

export type CreateClientInput = z.infer<typeof createClientSchema>;
export type UpdateClientInput = z.infer<typeof updateClientSchema>;

export const duplicateCheckSchema = z.object({
  name: optionalText(200),
  legalName: optionalText(250),
  email: optionalText(254),
  phone: optionalText(40),
  excludeClientId: optionalId,
});

export type DuplicateCheckPayload = z.infer<typeof duplicateCheckSchema>;

/* -------------------------------------------------------------------------- */
/* Contacts                                                                    */
/* -------------------------------------------------------------------------- */

const contactFields = {
  firstName: z
    .string()
    .trim()
    .min(1, "First name is required")
    .max(120, "First name must be 120 characters or fewer"),
  lastName: z
    .string()
    .trim()
    .min(1, "Last name is required")
    .max(120, "Last name must be 120 characters or fewer"),
  jobTitle: optionalText(160),
  email: z
    .string()
    .trim()
    .max(254)
    .optional()
    .transform((value) => (value === "" ? undefined : value))
    .refine((value) => !value || z.string().email().safeParse(value).success, {
      message: "Enter a valid email address",
    }),
  phone: optionalText(40),
  isPrimary: optionalBoolean,
  status: z.enum(EDITABLE_CONTACT_STATUSES as [string, ...string[]]).default("ACTIVE"),
};

export const createContactSchema = z.object(contactFields);
export const updateContactSchema = z.object({
  ...contactFields,
  versionUpdatedAt: optionalDate,
});

export type CreateContactInput = z.infer<typeof createContactSchema>;
export type UpdateContactInput = z.infer<typeof updateContactSchema>;

/* -------------------------------------------------------------------------- */
/* List query                                                                  */
/* -------------------------------------------------------------------------- */

export const CLIENT_SORT_KEYS = [
  "updated-desc",
  "created-desc",
  "name-asc",
  "name-desc",
  "projects-desc",
  "type-asc",
  "status-asc",
] as const;

export type ClientSortKey = (typeof CLIENT_SORT_KEYS)[number];

export const clientListQuerySchema = z.object({
  search: z.string().trim().max(200).optional(),
  type: z.array(z.enum(CLIENT_TYPES)).optional(),
  status: z.array(z.enum(["ACTIVE", "INACTIVE"])).optional(),
  country: z.string().trim().max(120).optional(),
  projectId: z.string().optional(),
  hasActiveProject: z.boolean().optional(),
  page: z.number().int().min(1).default(1),
  limit: z.number().int().min(1).max(100).default(25),
  sort: z.enum(CLIENT_SORT_KEYS).default("updated-desc"),
  /** Archived clients live in their own section (PRD #12 §26). */
  archived: z.boolean().default(false),
});

export type ClientListQuery = z.infer<typeof clientListQuerySchema>;
