import { can } from "@/lib/access/can";
import { assertModule, assertPermission } from "@/lib/access/guards";
import type { UserContext } from "@/lib/context/types";
import { prisma } from "@/lib/database/prisma";
import {
  buildActionScopeWhere,
  buildHazardScopeWhere,
  buildIncidentScopeWhere,
  buildInspectionScopeWhere,
  buildObservationScopeWhere,
  buildPermitScopeWhere,
  buildRiskAssessmentScopeWhere,
  buildStopWorkScopeWhere,
  buildToolboxScopeWhere,
} from "../hse.scope";
import {
  OPEN_ACTION_STATUSES,
  OPEN_ENVIRONMENTAL_STATUSES,
  OPEN_HAZARD_STATUSES,
  OPEN_INCIDENT_STATUSES,
} from "../hse.status";
import type {
  HseAttentionDTO,
  HseKpiDTO,
  HseOverviewDTO,
  ProjectHseSummaryDTO,
} from "../hse.types";

/**
 * The HSE overview (PRD #22 §30, §31, §361).
 *
 * Ordered the way a safety manager reads a morning: **an active stop-work
 * first**, because it means people have been sent off a job right now, then
 * critical hazards, then serious incidents, then permits that have run out
 * under somebody still working to them (PRD #22 §361).
 *
 * Every count runs through the module's scope resolvers, so a site engineer's
 * overview counts their sites and not the company's — a KPI that quietly
 * totalled everything would leak how much is happening elsewhere
 * (PRD #22 §310).
 */

const MODULE = "hse" as const;

function startOfMonth(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

function startOfWeek(): Date {
  const now = new Date();
  const day = now.getUTCDay();
  // Monday-based: a toolbox-talk week starts when the site does.
  const offset = day === 0 ? 6 : day - 1;
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - offset),
  );
}

function startOfToday(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

export async function getHseOverview(context: UserContext): Promise<HseOverviewDTO> {
  assertModule(context, MODULE);
  assertPermission(context, "hse.dashboard.view");

  const now = new Date();
  const monthStart = startOfMonth();
  const weekStart = startOfWeek();
  const todayEnd = new Date(startOfToday().getTime() + 86_400_000);

  const [kpis, attention, recentIncidents, openCriticalHazards, activeStopWorks, expiring] =
    await Promise.all([
      buildKpis(context, { now, monthStart, weekStart, todayEnd }),
      buildAttention(context, now),
      recentIncidentList(context),
      criticalHazardList(context),
      can(context, "hse.stop_work.view")
        ? import("../stop-work/stop-work.service").then((m) => m.activeStopWorks(context))
        : Promise.resolve([]),
      can(context, "hse.permit.view")
        ? import("../permits/permit.service").then((m) => m.expiringPermits(context))
        : Promise.resolve([]),
    ]);

  return {
    kpis,
    attention,
    recentIncidents,
    openCriticalHazards,
    activeStopWorks,
    expiringPermits: expiring,
  };
}

/* -------------------------------------------------------------------------- */
/* KPIs                                                                        */
/* -------------------------------------------------------------------------- */

async function buildKpis(
  context: UserContext,
  dates: { now: Date; monthStart: Date; weekStart: Date; todayEnd: Date },
): Promise<HseKpiDTO[]> {
  const kpis: HseKpiDTO[] = [];

  // Each block is gated on its own permission, so a reader with only hazard
  // access gets a shorter overview rather than a row of zeroes that implies
  // nothing is happening (PRD #22 §30).
  if (can(context, "hse.hazard.view")) {
    const hazardScope = buildHazardScopeWhere(context);
    const [open, critical] = await Promise.all([
      prisma.hseHazard.count({
        where: { ...hazardScope, status: { in: OPEN_HAZARD_STATUSES } },
      }),
      prisma.hseHazard.count({
        where: {
          ...hazardScope,
          status: { in: OPEN_HAZARD_STATUSES },
          riskLevel: { in: ["HIGH", "CRITICAL"] },
        },
      }),
    ]);

    kpis.push({ key: "openHazards", label: "Open hazards", value: open, href: "/hse/hazards?view=open" });
    kpis.push({
      key: "criticalHazards",
      label: "High / critical hazards",
      value: critical,
      href: "/hse/hazards?view=critical",
    });
  }

  if (can(context, "hse.incident.view")) {
    const incidentScope = buildIncidentScopeWhere(context);
    const [incidents, nearMisses] = await Promise.all([
      prisma.hseIncident.count({
        where: {
          ...incidentScope,
          incidentType: { not: "NEAR_MISS" },
          occurredAt: { gte: dates.monthStart },
        },
      }),
      prisma.hseIncident.count({
        where: {
          ...incidentScope,
          incidentType: "NEAR_MISS",
          occurredAt: { gte: dates.monthStart },
        },
      }),
    ]);

    kpis.push({
      key: "incidentsThisMonth",
      label: "Incidents this month",
      value: incidents,
      href: "/hse/incidents",
    });
    kpis.push({
      key: "nearMissesThisMonth",
      label: "Near misses this month",
      value: nearMisses,
      href: "/hse/incidents?view=near-miss",
    });
  }

  if (can(context, "hse.inspection.view")) {
    const inspectionScope = buildInspectionScopeWhere(context);
    const [due, failed] = await Promise.all([
      prisma.hseInspection.count({
        where: { ...inspectionScope, status: { in: ["DRAFT", "SCHEDULED", "IN_PROGRESS"] } },
      }),
      prisma.hseInspection.count({
        where: { ...inspectionScope, result: { in: ["FAIL", "CONDITIONAL"] } },
      }),
    ]);

    kpis.push({
      key: "inspectionsDue",
      label: "Inspections due",
      value: due,
      href: "/hse/inspections?view=due",
    });
    kpis.push({
      key: "failedInspections",
      label: "Failed inspections",
      value: failed,
      href: "/hse/inspections?view=failed",
    });
  }

  if (can(context, "hse.action.view")) {
    const actionScope = buildActionScopeWhere(context);
    const [open, overdue] = await Promise.all([
      prisma.hseAction.count({
        where: { ...actionScope, status: { in: OPEN_ACTION_STATUSES } },
      }),
      prisma.hseAction.count({
        where: {
          ...actionScope,
          status: { in: OPEN_ACTION_STATUSES },
          dueDate: { lt: startOfToday() },
        },
      }),
    ]);

    kpis.push({ key: "openActions", label: "Open actions", value: open, href: "/hse/actions?view=open" });
    kpis.push({
      key: "overdueActions",
      label: "Overdue actions",
      value: overdue,
      href: "/hse/actions?view=overdue",
    });
  }

  if (can(context, "hse.permit.view")) {
    const permitScope = buildPermitScopeWhere(context);
    const [active, expiringToday] = await Promise.all([
      prisma.hseWorkPermit.count({
        where: { ...permitScope, status: "ACTIVE", validUntil: { gte: dates.now } },
      }),
      prisma.hseWorkPermit.count({
        where: {
          ...permitScope,
          status: { in: ["ACTIVE", "APPROVED"] },
          validUntil: { gte: dates.now, lt: dates.todayEnd },
        },
      }),
    ]);

    kpis.push({
      key: "activePermits",
      label: "Active permits",
      value: active,
      href: "/hse/permits?view=active",
    });
    kpis.push({
      key: "permitsExpiringToday",
      label: "Permits expiring today",
      value: expiringToday,
      href: "/hse/permits?view=expiring",
    });
  }

  if (can(context, "hse.toolbox.view")) {
    const talks = await prisma.toolboxTalk.count({
      where: {
        ...buildToolboxScopeWhere(context),
        status: "COMPLETED",
        talkDate: { gte: dates.weekStart },
      },
    });

    kpis.push({
      key: "toolboxThisWeek",
      label: "Toolbox talks this week",
      value: talks,
      href: "/hse/toolbox-talks",
    });
  }

  if (can(context, "hse.environment.view")) {
    const observations = await prisma.environmentalObservation.count({
      where: {
        ...buildObservationScopeWhere(context),
        status: { in: OPEN_ENVIRONMENTAL_STATUSES },
      },
    });

    kpis.push({
      key: "openObservations",
      label: "Open environmental",
      value: observations,
      href: "/hse/environment?view=open",
    });
  }

  if (can(context, "hse.stop_work.view")) {
    const stopped = await prisma.stopWorkRecord.count({
      where: { ...buildStopWorkScopeWhere(context), status: "ACTIVE" },
    });

    kpis.push({
      key: "stopWorkActive",
      label: "Stop-work in force",
      value: stopped,
      href: "/hse/stop-work",
    });
  }

  return kpis;
}

/* -------------------------------------------------------------------------- */
/* Attention                                                                   */
/* -------------------------------------------------------------------------- */

/** The order a safety manager reads a morning in (PRD #22 §361). */
async function buildAttention(
  context: UserContext,
  now: Date,
): Promise<HseAttentionDTO[]> {
  const attention: HseAttentionDTO[] = [];

  if (can(context, "hse.stop_work.view")) {
    const stopped = await prisma.stopWorkRecord.count({
      where: { ...buildStopWorkScopeWhere(context), status: "ACTIVE" },
    });
    if (stopped > 0) {
      attention.push({
        id: "stop-work",
        priority: "CRITICAL",
        title: `${stopped} stop-work${stopped === 1 ? "" : "s"} in force`,
        detail: "Work is halted until somebody releases it.",
        href: "/hse/stop-work",
      });
    }
  }

  if (can(context, "hse.hazard.view")) {
    const critical = await prisma.hseHazard.count({
      where: {
        ...buildHazardScopeWhere(context),
        riskLevel: "CRITICAL",
        status: { in: OPEN_HAZARD_STATUSES },
      },
    });
    if (critical > 0) {
      attention.push({
        id: "critical-hazards",
        priority: "CRITICAL",
        title: `${critical} critical hazard${critical === 1 ? "" : "s"} open`,
        detail: "Scored 17 or higher on the risk matrix.",
        href: "/hse/hazards?view=critical",
      });
    }
  }

  if (can(context, "hse.incident.view")) {
    const serious = await prisma.hseIncident.count({
      where: {
        ...buildIncidentScopeWhere(context),
        severity: "CRITICAL",
        status: { in: OPEN_INCIDENT_STATUSES },
      },
    });
    if (serious > 0) {
      attention.push({
        id: "critical-incidents",
        priority: "CRITICAL",
        title: `${serious} critical incident${serious === 1 ? "" : "s"} open`,
        detail: "Not yet investigated and closed.",
        href: "/hse/incidents?view=serious",
      });
    }
  }

  if (can(context, "hse.permit.view")) {
    // Stored ACTIVE, window closed: somebody may be working to a permit that
    // expired under them (PRD #22 §151, §360).
    const expired = await prisma.hseWorkPermit.count({
      where: { ...buildPermitScopeWhere(context), status: "ACTIVE", validUntil: { lt: now } },
    });
    if (expired > 0) {
      attention.push({
        id: "expired-permits",
        priority: "CRITICAL",
        title: `${expired} active permit${expired === 1 ? "" : "s"} past expiry`,
        detail: "The validity window has closed. Close or reissue them.",
        href: "/hse/permits?view=active",
      });
    }
  }

  if (can(context, "hse.action.view")) {
    const overdue = await prisma.hseAction.count({
      where: {
        ...buildActionScopeWhere(context),
        priority: "CRITICAL",
        status: { in: OPEN_ACTION_STATUSES },
        dueDate: { lt: startOfToday() },
      },
    });
    if (overdue > 0) {
      attention.push({
        id: "overdue-critical-actions",
        priority: "HIGH",
        title: `${overdue} critical action${overdue === 1 ? "" : "s"} overdue`,
        detail: "Past their due date and not yet verified.",
        href: "/hse/actions?view=overdue",
      });
    }
  }

  if (can(context, "hse.approval.view")) {
    // The same records the queue itself would list, not every pending row in
    // the company (PRD #22 §181, PRD #47 §62).
    const { countPendingApprovals } = await import("../approvals/approval.service");
    const pending = await countPendingApprovals(context);
    if (pending > 0) {
      attention.push({
        id: "pending-approvals",
        priority: "MEDIUM",
        title: `${pending} waiting for a decision`,
        detail: "Inspections, risk assessments, permits and incident closures.",
        href: "/hse/approvals",
      });
    }
  }

  if (can(context, "hse.risk.view")) {
    const reviewDue = await prisma.hseRiskAssessment.count({
      where: {
        ...buildRiskAssessmentScopeWhere(context),
        status: "APPROVED",
        reviewDate: { lte: now },
      },
    });
    if (reviewDue > 0) {
      attention.push({
        id: "risk-review-due",
        priority: "MEDIUM",
        title: `${reviewDue} risk assessment${reviewDue === 1 ? "" : "s"} due for review`,
        // Nothing expires by itself: a person decides (PRD #22 §359).
        detail: "Past their review date. Still valid until somebody says otherwise.",
        href: "/hse/risk-assessments?view=review-due",
      });
    }
  }

  return attention;
}

/* -------------------------------------------------------------------------- */
/* Lists                                                                       */
/* -------------------------------------------------------------------------- */

async function recentIncidentList(context: UserContext) {
  if (!can(context, "hse.incident.view")) return [];

  const { listIncidents } = await import("../incidents/incident.service");
  const result = await listIncidents(context, {
    page: 1,
    limit: 5,
    view: "open",
    sort: "occurred-desc",
  } as Parameters<typeof listIncidents>[1]);

  return result.data;
}

async function criticalHazardList(context: UserContext) {
  if (!can(context, "hse.hazard.view")) return [];

  const { listHazards } = await import("../hazards/hazard.service");
  const result = await listHazards(context, {
    page: 1,
    limit: 5,
    view: "critical",
    sort: "risk-desc",
  } as Parameters<typeof listHazards>[1]);

  return result.data;
}

/* -------------------------------------------------------------------------- */
/* Project HSE                                                                 */
/* -------------------------------------------------------------------------- */

/** One project's safety position (PRD #22 §31, §215). */
export async function getProjectHseSummary(
  context: UserContext,
  projectId: string,
): Promise<ProjectHseSummaryDTO> {
  assertModule(context, MODULE);

  const now = new Date();

  const [
    inspections,
    passed,
    openHazards,
    criticalHazards,
    incidents,
    nearMisses,
    overdueActions,
    activePermits,
    stopWorkActive,
  ] = await Promise.all([
    can(context, "hse.inspection.view")
      ? prisma.hseInspection.count({
          where: { ...buildInspectionScopeWhere(context), projectId },
        })
      : 0,
    can(context, "hse.inspection.view")
      ? prisma.hseInspection.count({
          where: { ...buildInspectionScopeWhere(context), projectId, result: "PASS" },
        })
      : 0,
    can(context, "hse.hazard.view")
      ? prisma.hseHazard.count({
          where: {
            ...buildHazardScopeWhere(context),
            projectId,
            status: { in: OPEN_HAZARD_STATUSES },
          },
        })
      : 0,
    can(context, "hse.hazard.view")
      ? prisma.hseHazard.count({
          where: {
            ...buildHazardScopeWhere(context),
            projectId,
            riskLevel: "CRITICAL",
            status: { in: OPEN_HAZARD_STATUSES },
          },
        })
      : 0,
    can(context, "hse.incident.view")
      ? prisma.hseIncident.count({
          where: {
            ...buildIncidentScopeWhere(context),
            projectId,
            incidentType: { not: "NEAR_MISS" },
          },
        })
      : 0,
    can(context, "hse.incident.view")
      ? prisma.hseIncident.count({
          where: {
            ...buildIncidentScopeWhere(context),
            projectId,
            incidentType: "NEAR_MISS",
          },
        })
      : 0,
    can(context, "hse.action.view")
      ? prisma.hseAction.count({
          where: {
            ...buildActionScopeWhere(context),
            projectId,
            status: { in: OPEN_ACTION_STATUSES },
            dueDate: { lt: startOfToday() },
          },
        })
      : 0,
    can(context, "hse.permit.view")
      ? prisma.hseWorkPermit.count({
          where: {
            ...buildPermitScopeWhere(context),
            projectId,
            status: "ACTIVE",
            validUntil: { gte: now },
          },
        })
      : 0,
    can(context, "hse.stop_work.view")
      ? prisma.stopWorkRecord.count({
          where: { ...buildStopWorkScopeWhere(context), projectId, status: "ACTIVE" },
        })
      : 0,
  ]);

  return {
    inspections,
    // Null rather than 0% when nothing has been inspected: "0% pass rate" and
    // "no inspections yet" are different facts.
    passRate: inspections > 0 ? Math.round((passed / inspections) * 100) : null,
    openHazards,
    criticalHazards,
    incidents,
    nearMisses,
    overdueActions,
    activePermits,
    stopWorkActive,
  };
}

export function canViewProjectHse(context: UserContext): boolean {
  return (
    can(context, "hse.hazard.view") ||
    can(context, "hse.incident.view") ||
    can(context, "hse.inspection.view") ||
    can(context, "hse.permit.view")
  );
}
