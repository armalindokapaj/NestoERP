import { Inbox } from "lucide-react";
import { getTranslations } from "@/lib/i18n/server";

import { DataTable, type TableColumn } from "@/components/data/data-table";
import { ListToolbar } from "@/components/data/list-toolbar";
import { Pagination } from "@/components/data/pagination";
import { StatusBadge } from "@/components/modules/status-badge";
import { EmptyState } from "@/components/ui/empty-state";
import type { ModuleRecordRow, RecordSection } from "@/lib/modules/records/types";
import { paginationMeta } from "@/lib/modules/shared/list-query";

/**
 * The list body every department module section renders (PRD #7 §17, §18).
 *
 * Columns, filters and empty copy come from the section's registry entry; the
 * table, toolbar, pagination and states are the shared ones. No module builds
 * its own (PRD #7 §93).
 */
export async function RecordList({
  section,
  rows,
  total,
  page,
  limit,
  basePath,
  searchParams,
}: {
  section: RecordSection;
  rows: ModuleRecordRow[];
  total: number;
  page: number;
  limit: number;
  basePath: string;
  searchParams: Record<string, string | string[] | undefined>;
}) {
  const [t, tUi] = await Promise.all([getTranslations("common"), getTranslations("ui")]);
  const columns: TableColumn<ModuleRecordRow>[] = section.columns.map((column, index) => ({
    key: column.key,
    label: column.label,
    hideBelow: column.hideBelow,
    align: column.align,
    primary: index === 0,
    render: (row) => {
      const field = row.fields.find((entry) => entry.key === column.key);
      if (!field) return "—";
      if (field.status) return <StatusBadge status={field.value} />;
      return field.value;
    },
  }));

  const hasFilters = Object.entries(searchParams).some(
    ([key, value]) => key !== "page" && typeof value === "string" && value !== "",
  );

  function buildHref(next: number) {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(searchParams)) {
      if (typeof value === "string" && key !== "page" && value) params.set(key, value);
    }
    if (next > 1) params.set("page", String(next));
    const query = params.toString();
    return query ? `${basePath}?${query}` : basePath;
  }

  return (
    <div className="space-y-4">
      <ListToolbar
        searchPlaceholder={t("searchNoun", { noun: section.plural.toLowerCase() })}
        filters={section.filters ?? []}
      />

      {rows.length === 0 ? (
        hasFilters ? (
          // A filtered empty list is a different state from an empty module,
          // and the useful action here is clearing the filters (PRD #7 §77).
          <EmptyState
            icon={<Inbox />}
            title={t("noMatch", { noun: section.plural.toLowerCase() })}
            description={t("noMatchBody")}
            action={{ label: tUi("clearFilters"), href: basePath }}
          />
        ) : (
          <EmptyState
            icon={<Inbox />}
            title={section.emptyTitle}
            description={section.emptyDescription}
          />
        )
      ) : (
        <>
          <DataTable
            caption={section.plural}
            columns={columns}
            records={rows}
            rowKey={(row) => row.id}
            rowHref={(row) => `${basePath}/${row.id}`}
          />
          <Pagination meta={paginationMeta(total, page, limit)} buildHref={buildHref} />
        </>
      )}
    </div>
  );
}
