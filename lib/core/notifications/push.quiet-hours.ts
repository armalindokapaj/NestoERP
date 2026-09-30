/**
 * Quiet hours (MOB-10 §91-§94), as a pure function of a clock.
 *
 * The window is minutes from local midnight in the person's own IANA time zone
 * — never the server's — and may cross midnight (22:00 → 07:00).
 */
export type QuietHours = { enabled: boolean; startMinute: number; endMinute: number; timezone: string; allowCritical: boolean };

/** Minutes since local midnight, and the offset needed to get back to UTC, for one zone. */
function localMinutes(at: Date, timezone: string): number {
  try {
    const parts = new Intl.DateTimeFormat("en-GB", { timeZone: timezone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(at);
    const hour = Number(parts.find((part) => part.type === "hour")?.value ?? 0);
    const minute = Number(parts.find((part) => part.type === "minute")?.value ?? 0);
    return hour * 60 + minute;
  } catch {
    // An unknown zone falls back to UTC rather than throwing inside delivery.
    return at.getUTCHours() * 60 + at.getUTCMinutes();
  }
}

export function insideQuietHours(settings: QuietHours, at: Date): boolean {
  if (!settings.enabled || settings.startMinute === settings.endMinute) return false;
  const now = localMinutes(at, settings.timezone);
  return settings.startMinute < settings.endMinute
    ? now >= settings.startMinute && now < settings.endMinute
    : now >= settings.startMinute || now < settings.endMinute;
}

/**
 * The instant quiet hours end, or null when `at` is not inside them. Found by
 * stepping a minute at a time, at most a day: exact across daylight-saving
 * changes, which arithmetic on offsets is not.
 */
export function quietHoursEnd(settings: QuietHours, at: Date): Date | null {
  if (!insideQuietHours(settings, at)) return null;
  const minute = 60_000;
  const start = Math.floor(at.getTime() / minute) * minute;
  for (let step = 1; step <= 24 * 60; step += 1) {
    const candidate = new Date(start + step * minute);
    if (!insideQuietHours(settings, candidate)) return candidate;
  }
  return null;
}
