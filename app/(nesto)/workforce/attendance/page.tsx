import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { selectClass } from "@/components/forms/record-form";
import { ModulePage } from "@/components/modules/module-page";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { AttendanceSheet, AttendanceSheetFilter } from "@/components/workforce/attendance-sheet";
import { can } from "@/lib/access/can";
import { AccessError } from "@/lib/access/guards";
import { resolveModuleExperience } from "@/lib/access/module-access";
import { requireModule } from "@/lib/context/current-user";
import { getTranslations } from "@/lib/i18n/server";
import { todayDay } from "@/lib/modules/hr/employment/employment.dates";
import { listCrews } from "@/lib/modules/workforce/crew.service";
import { getAttendanceSheet } from "@/lib/modules/workforce/site-attendance.service";
import { projectChoices, siteChoices } from "@/lib/modules/workforce/workforce.directory";
import { sheetScopeSchema } from "@/lib/modules/workforce/workforce.schema";
import type { AttendanceSheetDTO } from "@/lib/modules/workforce/workforce.types";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("workforce"))("meta.attendance") };
}

const one = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value) || undefined;

/**
 * Attendance on site (E-04 §123, §124, §236): a day, and a crew or a project
 * and site; then everybody working there is marked at once — from a phone on
 * site as much as from a desk.
 */
export default async function SiteAttendancePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const context = await requireModule("workforce");
  if (!can(context, "workforce.attendance.view")) redirect("/access-denied");
  const params = await searchParams;
  const t = await getTranslations("workforce");
  const [projects, crews] = await Promise.all([projectChoices(context), listCrews(context)]);
  const sites = await siteChoices(context, projects.map((project) => project.id));

  const date = one(params.date) ?? todayDay();
  const siteId = one(params.siteId);
  const projectId = one(params.projectId) ?? sites.find((site) => site.id === siteId)?.projectId;
  const crewId = one(params.crewId);

  let sheet: AttendanceSheetDTO | null = null;
  let problem: string | null = null;
  if (projectId || crewId) {
    const scope = sheetScopeSchema.safeParse({ date, projectId, siteId, crewId });
    if (!scope.success) problem = scope.error.issues[0]?.message ?? t("attendance.chooseScope");
    else {
      try {
        sheet = await getAttendanceSheet(context, scope.data);
      } catch (error) {
        if (!(error instanceof AccessError)) throw error;
        problem = error.message;
      }
    }
  }

  const projectName = new Map(projects.map((project) => [project.id, project.name]));

  return (
    <ModulePage experience={resolveModuleExperience(context, "workforce")} activeSection="attendance">
      <div className="space-y-4">
        <AttendanceSheetFilter className="nesto-card grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-[auto_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_auto] lg:items-end" aria-label={t("attendance.chooseSheet")}>
          <label className="flex flex-col gap-1 text-meta font-medium text-fg-muted">
            {t("attendance.day")}
            <Input type="date" name="date" defaultValue={date} max={todayDay()} required />
          </label>
          <label className="flex flex-col gap-1 text-meta font-medium text-fg-muted">
            {t("attendance.crew")}
            <select name="crewId" defaultValue={crewId ?? ""} className={selectClass}>
              <option value="">{t("attendance.anyCrew")}</option>
              {crews.map((crew) => (
                <option key={crew.id} value={crew.id}>
                  {crew.project ? `${crew.name} · ${crew.project.name}` : crew.name}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-meta font-medium text-fg-muted">
            {t("attendance.project")}
            <select name="projectId" defaultValue={projectId ?? ""} className={selectClass}>
              <option value="">{crewId ? t("attendance.crewsProject") : t("attendance.chooseProject")}</option>
              {projects.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.name}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-meta font-medium text-fg-muted">
            {t("attendance.site")}
            <select name="siteId" defaultValue={siteId ?? ""} className={selectClass}>
              <option value="">{t("attendance.wholeProject")}</option>
              {projects
                .filter((project) => sites.some((site) => site.projectId === project.id))
                .map((project) => (
                  <optgroup key={project.id} label={projectName.get(project.id)}>
                    {sites
                      .filter((site) => site.projectId === project.id)
                      .map((site) => (
                        <option key={site.id} value={site.id}>
                          {site.name}
                        </option>
                      ))}
                  </optgroup>
                ))}
            </select>
          </label>
          <Button type="submit" data-testid="open-sheet">
            {t("attendance.openSheet")}
          </Button>
        </AttendanceSheetFilter>
        {problem ? (
          <p role="alert" className="rounded-md border border-danger/30 bg-danger-soft px-3 py-2 text-table text-danger-strong">
            {problem}
          </p>
        ) : null}
        {sheet ? (
          <AttendanceSheet sheet={sheet} />
        ) : problem ? null : (
          <p className="nesto-card px-5 py-8 text-center text-table text-fg-muted">{t("attendance.choosePrompt")}</p>
        )}
      </div>
    </ModulePage>
  );
}
