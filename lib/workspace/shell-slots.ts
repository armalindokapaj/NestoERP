import { cookies } from "next/headers";

import { logger, serialiseError } from "@/lib/core/observability/logger";
import { Metric, recordDuration } from "@/lib/core/observability/metrics";

/**
 * The shell's optional slots, server side (NAV-02 SHELL-01, API-03).
 *
 * The workspace chooser, the critical banner and the development access panel
 * are read after authentication but never awaited by the shell frame. Each
 * read is turned into a result that cannot reject — a slot that fails shows
 * its own retry, and a rejection never escapes as an unhandled one — and its
 * outcome and duration are counted by slot, never by who asked.
 */

export type ShellSlot = "workspaces" | "banner" | "diagnostics";

export type SlotResult<T> = { ok: true; data: T } | { ok: false };

/** `stream`: the shell's own render; `retry`: the slot's retry endpoint. */
export type SlotPhase = "stream" | "retry";

export function settleSlot<T>(slot: ShellSlot, work: () => Promise<T>, phase: SlotPhase = "stream"): Promise<SlotResult<T>> {
  const startedAt = performance.now();
  return testDelay(slot, phase)
    .then(work)
    .then(
      (data): SlotResult<T> => {
        recordDuration(Metric.SHELL_SLOT_MS, Metric.SHELL_SLOT, startedAt, { slot, phase, outcome: data === null ? "empty" : "success" });
        return { ok: true, data };
      },
      (error: unknown): SlotResult<T> => {
        // A failure is not an empty result: it is counted and logged as one (S18).
        recordDuration(Metric.SHELL_SLOT_MS, Metric.SHELL_SLOT, startedAt, { slot, phase, outcome: "failure" });
        logger.error("shell.slot.failed", { slot, phase, ...serialiseError(error) });
        return { ok: false };
      },
    );
}

/**
 * Test-only: a production build started with `NESTO_TEST_SHELL_DELAYS=1`
 * holds a slot's read for as long as the `nesto-test-shell-delay` cookie says,
 * and can make it fail: `workspaces=1500,banner=800:fail,workspaces-retry=0`
 * (`-retry` for the retry endpoint), at most ten seconds. It is how the
 * browser tests prove the frame does not wait for a slow slot, and that a
 * late first answer cannot overwrite a retry (§16 PERF-04 step 6, S01-S05).
 * Deployments never set the variable; `verify:production-guards` keeps the
 * gate in place.
 */
export const SHELL_DELAY_COOKIE = "nesto-test-shell-delay";

async function testDelay(slot: ShellSlot, phase: SlotPhase): Promise<void> {
  if (process.env.NESTO_TEST_SHELL_DELAYS !== "1") return;
  await testHold(phase === "retry" ? `${slot}-retry` : slot);
}

/**
 * Test-only, behind the same variable: holds one page section before it
 * renders, from a `section-<name>=1500` rule in the same cookie. It is how the
 * browser tests prove a slow optional section adds nothing to its siblings
 * (NAV-03 PERF-01 Streaming, S01).
 */
export async function testSectionDelay(section: string): Promise<void> {
  if (process.env.NESTO_TEST_SHELL_DELAYS !== "1") return;
  await testHold(`section-${section}`);
}

/** Reached only through the two gated hooks above. */
async function testHold(name: string): Promise<void> {
  let value: string | undefined;
  try {
    value = (await cookies()).get(SHELL_DELAY_COOKIE)?.value;
  } catch {
    return;
  }
  const rule = value?.split(",").map((part) => part.split("=")).find(([key]) => key === name)?.[1];
  if (!rule) return;
  const [delay, outcome] = rule.split(":");
  const ms = Math.min(10_000, Math.max(0, Number(delay) || 0));
  if (ms > 0) await new Promise((resolve) => setTimeout(resolve, ms));
  if (outcome === "fail") throw new Error(`test hook: ${name} fails`);
}
