import type { Metadata } from "next";

import Link from "@/components/navigation/nav-link";
import { requirePlatformContext } from "@/lib/context/platform-context";
import { cn } from "@/lib/utils/cn";
import { RecoveryDocuments } from "./_sections/documents";
import { RecoveryExperiences } from "./_sections/experiences";
import { RecoveryMedia } from "./_sections/media";
import { RecoveryTenants } from "./_sections/tenants";

export const metadata: Metadata = { title: "Recovery" };

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

const SECTIONS = [
  { key: "tenants", label: "Companies & groups" },
  { key: "documents", label: "Documents" },
  { key: "media", label: "Project media" },
  { key: "experiences", label: "3D experiences" },
] as const;

/**
 * Everything the Platform Admin can bring back, in one place: deleted
 * companies and groups, archived documents, media taken off a project and
 * deleted 3D experiences. The section lives in `?section=`, so refresh and Back
 * keep it.
 */
export default async function RecoveryPage({ searchParams }: Props) {
  await requirePlatformContext();
  const raw = await searchParams;
  const requested = Array.isArray(raw.section) ? raw.section[0] : raw.section;
  const section = SECTIONS.find((item) => item.key === requested)?.key ?? "tenants";
  return (
    <div className="space-y-5">
      <nav aria-label="Recovery sections" className="border-b border-line">
        <ul className="flex min-w-max gap-1 overflow-x-auto">
          {SECTIONS.map((item) => (
            <li key={item.key}>
              <Link href={item.key === "tenants" ? "/admin/system/recovery" : `/admin/system/recovery?section=${item.key}`} scroll={false} aria-current={item.key === section ? "page" : undefined} data-testid={`recovery-tab-${item.key}`} className={cn("-mb-px flex h-10 items-center border-b-2 px-3 text-table transition-colors", item.key === section ? "border-accent font-semibold text-fg" : "border-transparent text-fg-muted hover:border-line-strong hover:text-fg")}>
                {item.label}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
      {section === "documents" ? <RecoveryDocuments searchParams={searchParams} /> : section === "media" ? <RecoveryMedia /> : section === "experiences" ? <RecoveryExperiences /> : <RecoveryTenants />}
    </div>
  );
}
