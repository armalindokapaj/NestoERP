import { z } from "zod";

/**
 * Account basics (PRD #38 §20).
 *
 * Messages are stable codes rather than prose: the profile page is part of the
 * translated frame, so it turns a code into the reader's language.
 */

export const updateProfileSchema = z.object({
  firstName: z.string().trim().min(1, "FIRST_NAME_REQUIRED").max(80, "FIRST_NAME_TOO_LONG"),
  lastName: z.string().trim().min(1, "LAST_NAME_REQUIRED").max(80, "LAST_NAME_TOO_LONG"),
  phone: z
    .string()
    .trim()
    .max(40, "PHONE_TOO_LONG")
    .optional()
    .transform((value) => (value ? value : null)),
});

export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;

export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, "CURRENT_PASSWORD_REQUIRED").max(200, "PASSWORD_TOO_LONG"),
    // The same rule a reset applies (lib/auth/schema.ts).
    newPassword: z.string().min(10, "PASSWORD_TOO_SHORT").max(200, "PASSWORD_TOO_LONG"),
    confirmPassword: z.string().min(1, "CONFIRM_REQUIRED"),
  })
  .refine((value) => value.newPassword === value.confirmPassword, {
    message: "PASSWORDS_MISMATCH",
    path: ["confirmPassword"],
  })
  .refine((value) => value.newPassword !== value.currentPassword, {
    message: "PASSWORD_UNCHANGED",
    path: ["newPassword"],
  });

export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;
