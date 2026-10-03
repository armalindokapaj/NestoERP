import { z } from "zod";

export const credentialsSchema = z.object({
  username: z.string().trim().min(1, "Enter your username"),
  password: z.string().min(1, "Password is required"),
});

export type CredentialsInput = z.infer<typeof credentialsSchema>;

/**
 * A new password (PRD #6 §56, PRD #50 §13).
 *
 * Length is the requirement that actually matters; composition rules push
 * people toward predictable substitutions without adding real strength.
 *
 * There is no reset-by-link schema beside this one: V0.1 has no self-service
 * reset, so the only ways a password changes are its holder choosing a new one
 * and an administrator issuing a temporary one (PRD #50 §3, §19, §20).
 */
export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, "Enter your current password"),
    password: z
      .string()
      .min(10, "Use at least 10 characters")
      .max(200, "That password is too long"),
    confirmPassword: z.string().min(1, "Confirm your new password"),
  })
  .refine((values) => values.password === values.confirmPassword, {
    message: "Both passwords must match",
    path: ["confirmPassword"],
  });

export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;
