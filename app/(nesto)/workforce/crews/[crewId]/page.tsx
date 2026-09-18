import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { RecordContextHeader } from "@/components/modules/record-header";
import { Table, TableBody, TableCell, TableHead, TableHeaderCell, TableRow } from "@/components/ui/table";
import { AssignCrewButton, CrewFormButton, CrewStatusButton, EndMembershipButton } from "@/components/workforce/workforce-actions";
import { AccessError } from "@/lib/access/guards";
import { requireModule } from "@/lib/context/current-user";
import { accountStatusLabels } from "@/lib/modules/hr/hr.status";
import { getCrew } from "@/lib/modules/workforce/crew.service";
import { tradeChoices } from "@/lib/modules/workforce/trade.service";
import { projectChoices, siteChoices, workerChoices } from "@/lib/modules/workforce/workforce.directory";
import { seesWholeCompany } from "@/lib/modules/workforce/workforce.permissions";
import type { CrewMemberDTO } from "@/lib/modules/workforce/workforce.types";
import { orDash } from "@/lib/utils/format";

export const metadata: Metadata = { title: "Crew" };

/**
 * One crew (E-04 §29, §30): its foreman, who is in it now and who is due to
 * join, and everybody who has been — a membership is ended, never erased.
 */
export default async function CrewPage({ params }: { params: Promise<{ crewId: string }> }) {
  const context = await requireModule("workforce");
  const { crewId } = await params;
  const crew = await getCrew(context, crewId).catch((error: unknown) => {
    if (error instanceof AccessError && error.code === "NOT_FOUND") notFound();
    throw error;
  });
  const manage = crew.capabilities.canManage;
  const projects = manage ? await projectChoices(context) : [];
  const [sites, trades, workers] = manage ? await Promise.all([siteChoices(context, projects.map((project) => project.id)), tradeChoices(context.companyId, crew.trade?.id), workerChoices(context)]) : [[], [], []];
  const archived = crew.status === "ARCHIVED";

  return (
    <div className="space-y-5">
      <RecordContextHeader
        breadcrumbs={[{ label: "Workforce", href: "/workforce" }, { label: "Crews", href: "/workforce/crews" }, { label: crew.name }]}
        title={crew.name}
        subtitle={[crew.project?.name, crew.site?.name].filter(Boolean).join(" · ") || "Company crew"}
        status={crew.status}
        actions={
          manage ? (
            <div className="flex flex-wrap items-center gap-2">
              {archived ? null : <AssignCrewButton crewId={crew.id} workers={workers} label="Add worker" variant="primary" />}
              <CrewFormButton
                crew={{ id: crew.id, name: crew.name, projectId: crew.project?.id ?? null, siteId: crew.site?.id ?? null, tradeId: crew.trade?.id ?? null, supervisorEmployeeId: crew.supervisor?.employeeId ?? null, notes: crew.notes }}
                projects={projects}
                sites={sites}
                trades={trades}
                supervisors={workers}
                projectRequired={!seesWholeCompany(context)}
              />
              <CrewStatusButton crewId={crew.id} archived={archived} />
            </div>
          ) : null
        }
      />

      <dl className="nesto-card grid gap-4 p-5 sm:grid-cols-3">
        <div>
          <dt className="text-meta text-fg-subtle">Foreman</dt>
          <dd className="text-body text-fg">{crew.supervisor ? <Link className="hover:underline" href={`/people/${crew.supervisor.personId}?tab=workforce`}>{crew.supervisor.name}</Link> : "Nobody yet"}</dd>
        </div>
        <div>
          <dt className="text-meta text-fg-subtle">Trade</dt>
          <dd className="text-body text-fg">{crew.trade?.name ?? "Mixed"}</dd>
        </div>
        <div>
          <dt className="text-meta text-fg-subtle">People today</dt>
          <dd className="text-body tabular-nums text-fg">{crew.memberCount}</dd>
        </div>
        {crew.notes ? (
          <div className="sm:col-span-3">
            <dt className="text-meta text-fg-subtle">Notes</dt>
            <dd className="whitespace-pre-line text-body text-fg">{crew.notes}</dd>
          </div>
        ) : null}
      </dl>

      <Members title="Members" members={crew.members} manage={manage} empty="Nobody is in this crew." />
      {crew.history.length ? <Members title="Former members" members={crew.history} manage={false} empty="" /> : null}
    </div>
  );
}

function Members({ title, members, manage, empty }: { title: string; members: CrewMemberDTO[]; manage: boolean; empty: string }) {
  return (
    <section className="nesto-card p-0" aria-label={title}>
      <h2 className="border-b border-line px-5 py-3.5 text-card font-semibold text-fg">{title}</h2>
      {members.length === 0 ? (
        <p className="px-5 py-6 text-table text-fg-muted">{empty}</p>
      ) : (
        <Table flush aria-label={title}>
          <TableHead>
            <TableRow>
              <TableHeaderCell>Name</TableHeaderCell>
              <TableHeaderCell>Trade</TableHeaderCell>
              <TableHeaderCell>Role</TableHeaderCell>
              <TableHeaderCell>From</TableHeaderCell>
              <TableHeaderCell>Until</TableHeaderCell>
              <TableHeaderCell>NESTO account</TableHeaderCell>
              {manage ? <TableHeaderCell className="sr-only">Actions</TableHeaderCell> : null}
            </TableRow>
          </TableHead>
          <TableBody>
            {members.map((member) => (
              <TableRow key={member.membershipId} data-testid="crew-member" data-worker-name={member.name}>
                <TableCell className="font-medium">
                  <Link className="hover:underline" href={`/people/${member.personId}?tab=workforce`}>
                    {member.name}
                  </Link>
                </TableCell>
                <TableCell>{orDash(member.trade)}</TableCell>
                <TableCell>{orDash(member.role)}</TableCell>
                <TableCell className="tabular-nums">{member.startDate}</TableCell>
                <TableCell className="tabular-nums">{member.endDate ?? "—"}{member.endReason ? <span className="block text-meta text-fg-subtle">{member.endReason}</span> : null}</TableCell>
                <TableCell>{member.accountStatus === "HAS_ACCOUNT" ? "Yes" : accountStatusLabels[member.accountStatus]}</TableCell>
                {manage ? (
                  <TableCell className="text-right">
                    {member.endDate === null ? <EndMembershipButton employeeId={member.employeeId} membershipId={member.membershipId} what={`${member.name}'s membership`} url="crew-assignments" /> : null}
                  </TableCell>
                ) : null}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </section>
  );
}
