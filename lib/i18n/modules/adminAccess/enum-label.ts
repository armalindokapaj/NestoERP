/**
 * A label for a value that arrives from data or a service (a status, a
 * category, an event type). The dictionary entry when there is one, otherwise
 * the fallback, so an unknown value still reads as itself.
 */
export function enumLabel(t: (key: never) => string, prefix: string, value: string | null | undefined, fallback?: string): string {
  if (value === null || value === undefined || value === "") return fallback ?? "";
  const key = `${prefix}.${value}`;
  const text = t(key as never);
  return text === key ? (fallback ?? value) : text;
}
