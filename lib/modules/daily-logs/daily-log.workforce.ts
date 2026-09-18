import type { UserContext } from "@/lib/context/types";
import { prisma } from "@/lib/database/prisma";
import { addEntry, prepare } from "./daily-log.entries";
import { workforceSchema } from "./daily-log.schema";
import { dateOf } from "./daily-log.time";

/**
 * The day's own workforce, suggested (E-04 §43, §44, §182).
 *
 * The site engineer writing the log should not count heads the company already
 * knows: its crews on this project, and the people assigned to it who are in no
 * crew. A crew's headcount is the people the site sheet marked present that
 * day, or — when nobody marked the sheet — the crew's members that day. Nothing
 * is written until the writer picks what to add; a crew already on the log is
 * not offered again. Workers without a login are counted like everybody else.
 */

export type WorkforceSuggestion = {
  key: string;
  crewId: string | null;
  organizationName: string;
  crewName: string | null;
  trade: string | null;
  headcount: number;
  basis: "ATTENDANCE" | "CREW" | "ASSIGNED";
};

export async function workforceSuggestions(context: UserContext, dailyLogId: string): Promise<WorkforceSuggestion[]> {
  const { log } = await prepare(context, dailyLogId, "workforce");
  const day = dateOf(log.workDate);
  const onDay = new Date(`${day}T00:00:00.000Z`);
  const covering = { startDate: { lte: onDay }, OR: [{ endDate: null }, { endDate: { gte: onDay } }] };

  const [crews, recorded, present, assigned] = await Promise.all([
    prisma.workforceCrew.findMany({
      where: { companyId: context.companyId, projectId: log.projectId, status: "ACTIVE" },
      orderBy: { name: "asc" },
      select: { id: true, name: true, trade: { select: { name: true } }, members: { where: covering, select: { employeeProfileId: true } } },
    }),
    prisma.dailyLogWorkforceEntry.findMany({ where: { dailyLogId: log.id, companyId: context.companyId, crewId: { not: null } }, select: { crewId: true } }),
    prisma.attendanceRecord.groupBy({
      by: ["crewId"],
      where: { companyId: context.companyId, projectId: log.projectId, date: new Date(`${day}T12:00:00.000Z`), status: "PRESENT", crewId: { not: null } },
      _count: { _all: true },
    }),
    prisma.employeeProjectAssignment.findMany({
      where: { companyId: context.companyId, projectId: log.projectId, ...covering, employeeProfile: { employmentStatus: { not: "ENDED" } } },
      select: { employeeProfileId: true, trade: { select: { name: true } }, employeeProfile: { select: { trade: { select: { name: true } } } } },
    }),
  ]);

  const organizationName = context.company.name;
  const taken = new Set(recorded.map((row) => row.crewId));
  const marked = new Map(present.map((row) => [row.crewId, row._count._all]));
  const inCrew = new Set(crews.flatMap((crew) => crew.members.map((member) => member.employeeProfileId)));
  const suggestions: WorkforceSuggestion[] = [];

  for (const crew of crews) {
    if (taken.has(crew.id)) continue;
    const attended = marked.get(crew.id);
    const headcount = attended ?? crew.members.length;
    if (headcount < 1) continue;
    suggestions.push({ key: `crew:${crew.id}`, crewId: crew.id, organizationName, crewName: crew.name, trade: crew.trade?.name ?? null, headcount, basis: attended ? "ATTENDANCE" : "CREW" });
  }

  // Assigned here and in none of its crews that day, counted by trade.
  const byTrade = new Map<string, number>();
  for (const row of assigned) {
    if (inCrew.has(row.employeeProfileId)) continue;
    const trade = row.trade?.name ?? row.employeeProfile.trade?.name ?? "";
    byTrade.set(trade, (byTrade.get(trade) ?? 0) + 1);
  }
  for (const [trade, headcount] of [...byTrade.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    suggestions.push({ key: `trade:${trade}`, crewId: null, organizationName, crewName: null, trade: trade || null, headcount, basis: "ASSIGNED" });
  }
  return suggestions;
}

/** Adds the suggestions the writer picked, as ordinary workforce entries they can still edit. */
export async function applyWorkforceSuggestions(context: UserContext, dailyLogId: string, keys: string[]): Promise<{ added: number }> {
  const chosen = (await workforceSuggestions(context, dailyLogId)).filter((suggestion) => keys.includes(suggestion.key));
  for (const suggestion of chosen) {
    const note = suggestion.basis === "ATTENDANCE" ? "From the site sheet" : suggestion.basis === "CREW" ? "From the crew list" : "Assigned to the project";
    await addEntry(
      context,
      dailyLogId,
      "workforce",
      workforceSchema.parse({ organizationName: suggestion.organizationName, trade: suggestion.trade, crewName: suggestion.crewName, crewId: suggestion.crewId, headcount: suggestion.headcount, notes: note }),
    );
  }
  return { added: chosen.length };
}
