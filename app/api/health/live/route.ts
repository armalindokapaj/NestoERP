import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/**
 * Liveness (PRD #32 §116-§118).
 *
 * Answers one question — is this process alive — with no dependency checks, so
 * a slow database never causes an orchestrator to kill a healthy instance.
 * Deliberately minimal: a public probe reveals nothing (PRD #30 §268).
 */
export function GET() {
  return NextResponse.json({ status: "ok" });
}
