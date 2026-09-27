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

/**
 * Update-only fields (AUD-09 §4, FV-05): absent keeps the saved value, `""` or
 * `null` clears it, a value replaces it.
 *
 * AUD-09: candidate for lib/forms (the omit / clear / set triple).
 */
const patchText = (max: number) =>
  z
    .union([z.string().trim().max(max, `Keep this under ${max.toLocaleString("en")} characters.`), z.null()])
    .optional()
    .transform((value) => (value === undefined ? undefined : value === "" || value === null ? null : value));

const patchEmail = patchText(254).refine((value) => !value || z.string().email().safeParse(value).success, {
  message: "Enter a valid email address",
});

const patchWebsite = patchText(300).refine(
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

/**
 * A client edit is a partial update (AUD-09 §4, FV-05, FV-10). A field left
 * out keeps its saved value — in particular the status, which used to fall
 * back to the create default (Active) and so reactivate an inactive client
 * whenever a request did not mention it. The edit form sends every field, so
 * for it nothing changes. A field that is sent is validated as on create;
 * unknown keys are stripped (PRD #12 §123).
 */
export const updateClientSchema = z.object({
  code: patchText(50),
  name: clientFields.name.optional(),
  legalName: patchText(250),
  type: z.enum(CLIENT_TYPES, { message: "Choose a client type." }).optional(),
  email: patchEmail,
  phone: patchText(40),
  website: patchWebsite,
  address: patchText(300),
  city: patchText(120),
  country: patchText(120),
  status: z.enum(EDITABLE_CLIENT_STATUSES as [string, ...string[]], { message: "Choose a status." }).optional(),
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

/**
 * A contact edit is a partial update too (AUD-09 §4, FV-05): absent keeps,
 * `""`/`null` clears, a value replaces. `isPrimary` is explicit: the edit form
 * sends `false` for an unticked box (a hidden input before the checkbox), so
 * "not ticked" and "not mentioned" are no longer the same request.
 */
export const updateContactSchema = z.object({
  firstName: contactFields.firstName.optional(),
  lastName: contactFields.lastName.optional(),
  jobTitle: patchText(160),
  email: patchEmail,
  phone: patchText(40),
  isPrimary: optionalBoolean,
  status: z.enum(EDITABLE_CONTACT_STATUSES as [string, ...string[]], { message: "Choose a status." }).optional(),
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
