export function initials(firstName?: string | null, lastName?: string | null): string {
  const a = firstName?.trim()?.[0] ?? "";
  const b = lastName?.trim()?.[0] ?? "";
  return (a + b).toUpperCase() || "?";
}

export function fullName(firstName?: string | null, lastName?: string | null): string {
  return [firstName, lastName].filter(Boolean).join(" ").trim();
}

/**
 * "Legal · VELAR - NDERTIM" — the account menu's second line (Profile Menu §4,
 * §82-§85). The separator appears only between two values, never dangling.
 */
export function roleAndCompany(role?: string | null, company?: string | null): string {
  return [role?.trim(), company?.trim()].filter(Boolean).join(" · ");
}

/** "Good morning" / "Good afternoon" / "Good evening" for the welcome header. */
export function greeting(date = new Date()): string {
  const hour = date.getHours();
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

/** A dash rather than an empty cell, so a table never looks broken. */
export function orDash(value: string | number | null | undefined): string {
  if (value === null || value === undefined || value === "") return "—";
  return String(value);
}
