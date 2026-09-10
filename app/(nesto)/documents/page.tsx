import type { Metadata } from "next";
import { FileText } from "lucide-react";

import { ModuleShell, resolveTab } from "@/components/modules/module-shell";
import { FilterBar } from "@/components/ui/filter-bar";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRow,
} from "@/components/ui/table";
import { modules } from "@/config/modules";
import { requirePermission } from "@/lib/auth/session";
import { demoDocuments, type DemoDocument } from "@/lib/mock/demo-data";

const MODULE_KEY = "documents" as const;

export const metadata: Metadata = {
  title: modules[MODULE_KEY].label,
};

function DocumentTable({ documents }: { documents: DemoDocument[] }) {
  return (
    <div className="nesto-card overflow-hidden">
      <Table>
        <TableHead>
          <tr>
            <TableHeaderCell>Document</TableHeaderCell>
            <TableHeaderCell className="hidden md:table-cell">Type</TableHeaderCell>
            <TableHeaderCell className="hidden lg:table-cell">Project</TableHeaderCell>
            <TableHeaderCell className="hidden xl:table-cell">Updated by</TableHeaderCell>
            <TableHeaderCell>Updated</TableHeaderCell>
          </tr>
        </TableHead>
        <TableBody>
          {documents.map((document) => (
            <TableRow key={document.id}>
              <TableCell>
                <span className="font-medium">{document.name}</span>
                <p className="text-meta text-fg-subtle">{document.size}</p>
              </TableCell>
              <TableCell className="hidden md:table-cell">
                <Badge>{document.type}</Badge>
              </TableCell>
              <TableCell className="hidden text-fg-muted lg:table-cell">{document.project}</TableCell>
              <TableCell className="hidden text-fg-muted xl:table-cell">{document.updatedBy}</TableCell>
              <TableCell className="text-fg-muted">{document.updatedAt}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

export default async function DocumentsPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  await requirePermission(modules[MODULE_KEY].viewPermission);
  const { tab } = await searchParams;
  const activeTab = resolveTab(MODULE_KEY, tab);

  const recent = demoDocuments.slice(0, 4);
  const shared = demoDocuments.filter((document) => document.shared);

  return (
    <ModuleShell
      moduleKey={MODULE_KEY}
      activeTab={activeTab}
      filters={
        <FilterBar
          searchPlaceholder="Search documents…"
          disabled
          filters={[
            { label: "Type", options: ["Drawing", "Report", "Contract", "Certificate"] },
            { label: "Project", options: ["Riverside Ph.2", "Northgate", "Harbour View"] },
          ]}
        />
      }
    >
      {activeTab === "all" ? <DocumentTable documents={demoDocuments} /> : null}
      {activeTab === "recent" ? <DocumentTable documents={recent} /> : null}
      {activeTab === "shared" ? (
        shared.length > 0 ? (
          <DocumentTable documents={shared} />
        ) : (
          <EmptyState
            icon={<FileText />}
            title="Nothing shared with you yet."
            description="Documents shared across the company will appear here."
          />
        )
      ) : null}

      <p className="mt-4 text-meta text-fg-subtle">
        Document records are demo data. File upload and versioning arrive with
        file storage in a later version.
      </p>
    </ModuleShell>
  );
}
