/**
 * Calendar time (PRD #39 §72-§75). The functions live in
 * `lib/core/time/zoned-time.ts` so other domains (HSE, AUD-09 §7) read
 * company-zone times without depending on the calendar module.
 */
export * from "@/lib/core/time/zoned-time";
