export function initials(firstName?: string | null, lastName?: string | null): string {
  const a = firstName?.trim()?.[0] ?? "";
  const b = lastName?.trim()?.[0] ?? "";
  return (a + b).toUpperCase() || "?";
}

export function fullName(firstName?: string | null, lastName?: string | null): string {
  return [firstName, lastName].filter(Boolean).join(" ").trim();
}

/** "Good morning" / "Good afternoon" / "Good evening" for the welcome header. */
export function greeting(date = new Date()): string {
  const hour = date.getHours();
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

export function formatDate(value: Date | string): string {
  const date = typeof value === "string" ? new Date(value) : value;
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(date);
}
