import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

import { appLink } from "@/lib/config/app-url";

/**
 * Invitation tokens (PRD #14 §67, §237, §238, §239).
 *
 * The raw token exists in exactly one place — the emailed link. What is stored
 * is its SHA-256, so a database leak cannot be replayed into a membership, and
 * a lookup is a hash comparison rather than a scan (PRD #14 §238).
 */

/** 32 random bytes, URL-safe. Long enough that guessing is not a strategy. */
export function generateInviteToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashInviteToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/**
 * Constant-time comparison, for the rare path that compares two hashes in
 * application code rather than in the database.
 */
export function tokensMatch(a: string, b: string): boolean {
  const left = Buffer.from(a, "utf8");
  const right = Buffer.from(b, "utf8");
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

/** Invitations expire, so a forwarded link does not stay useful (PRD #14 §68). */
export function inviteExpiry(now: Date = new Date()): Date {
  const days = Number.parseInt(process.env.TEAM_INVITE_EXPIRY_DAYS ?? "", 10);
  const validDays = Number.isFinite(days) && days > 0 ? days : 7;
  const expires = new Date(now);
  expires.setDate(expires.getDate() + validDays);
  return expires;
}

export function isInviteExpired(expiresAt: Date, now: Date = new Date()): boolean {
  return expiresAt.getTime() <= now.getTime();
}

/**
 * The link a person receives.
 *
 * Built from the configured application origin, never from a request header: a
 * spoofed `Host` must not be able to redirect an invitation to somebody else's
 * site (PRD #14 §241).
 */
export function inviteUrl(token: string): string {
  return appLink(`/invite/${token}`);
}

/** Email matching is normalised so case cannot create a second account (PRD #14 §318). */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}
