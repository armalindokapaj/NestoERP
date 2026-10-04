import { prisma } from "@/lib/database/prisma";
import { resolveShellLogo } from "@/lib/workspace/branding";

/**
 * The mark the viewer's loading screen draws: the group's logo, else the
 * company's, else none (the screen shows the name's initials). Callers have
 * already admitted the reader to the project; this only names its owner.
 */
export async function getViewerBrand(projectId: string): Promise<{ name: string; logoUrl: string | null }> {
  const row = await prisma.project.findUnique({
    where: { id: projectId },
    select: { company: { select: { name: true, logoUrl: true, parentGroup: { select: { name: true, logoUrl: true } } } } },
  });
  const company = row?.company;
  if (!company) return { name: "", logoUrl: null };
  const logoUrl = resolveShellLogo({ groupLogoUrl: company.parentGroup?.logoUrl ?? null, companyLogoUrl: company.logoUrl, inGroup: false });
  return { name: company.parentGroup?.name ?? company.name, logoUrl };
}
