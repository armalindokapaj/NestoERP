import Link from "next/link";
import { Files } from "lucide-react";

import { DocumentTable } from "@/components/documents/document-table";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { can } from "@/lib/access/can";
import type { UserContext } from "@/lib/context/types";
import { documentListQuerySchema } from "@/lib/modules/documents/document.schema";
import * as documents from "@/lib/modules/documents/document.service";

/**
 * Files filed against a safety record (PRD #22 §185–§193).
 *
 * The canonical Document records, under `module: "hse"`. A photograph of an
 * unguarded edge is reachable because the reader can reach the hazard it hangs
 * off, which the parent-access resolver decides — and it fails closed for
 * anything unregistered (PRD #22 §186, §187).
 */
export type HseDocumentParent =
  | "hse_inspection"
  | "hazard"
  | "incident"
  | "risk_assessment"
  | "hse_action"
  | "toolbox_talk"
  | "work_permit"
  | "environmental_observation"
  | "stop_work";

export async function HseRecordDocuments({
  context,
  entityType,
  entityId,
  emptyDescription,
}: {
  context: UserContext;
  entityType: HseDocumentParent;
  entityId: string;
  emptyDescription?: string;
}) {
  const query = documentListQuerySchema.parse({
    moduleKey: "hse",
    entityType,
    entityId,
    limit: 100,
  });

  const result = await documents.listDocuments(context, query);
  const uploadHref = `/documents/new?module=hse&entityType=${entityType}&entityId=${entityId}`;
  const mayUpload = can(context, "hse.document.create") && can(context, "document.create");

  if (result.data.length === 0) {
    return (
      <EmptyState
        icon={<Files />}
        title="No documents on file."
        description={
          emptyDescription ??
          "Photographs, signed sheets and supporting records filed against this appear here."
        }
        action={mayUpload ? { label: "Add document", href: uploadHref } : undefined}
      />
    );
  }

  return (
    <div className="space-y-4">
      {mayUpload ? (
        <div className="flex justify-end">
          <Button asChild size="sm">
            <Link href={uploadHref}>Add document</Link>
          </Button>
        </div>
      ) : null}
      <DocumentTable documents={result.data} />
    </div>
  );
}
