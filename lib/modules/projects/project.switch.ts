/**
 * Where switching to another project lands (MOB-05 §58).
 *
 * Someone on Tasks of one project who switches to another expects Tasks of that
 * one. The section is kept when it is one of the current project's tabs — the
 * switcher lists projects of the same company, whose role gives the same tabs —
 * and only its list is kept: a unit or work package belongs to the old project.
 * A section that belongs to one project alone (its 3D experience, its editor)
 * is never carried over; the target's Overview opens instead.
 */
const NOT_CARRIED = new Set(["3d", "edit", "media"]);

export function switchProjectHref(pathname: string, currentProjectId: string, targetProjectId: string, availableSegments: readonly string[]): string {
  const base = `/projects/${currentProjectId}`;
  const target = `/projects/${targetProjectId}`;
  if (!pathname.startsWith(`${base}/`)) return target;
  const segment = pathname.slice(base.length + 1).split("/")[0];
  if (!segment || NOT_CARRIED.has(segment) || !availableSegments.includes(segment)) return target;
  return `${target}/${segment}`;
}
