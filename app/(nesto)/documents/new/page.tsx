import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { DocumentUploader } from "@/components/documents/document-uploader";
import { Breadcrumbs } from "@/components/ui/breadcrumbs";
import { can } from "@/lib/access/can";
import { requireModule } from "@/lib/context/current-user";
import { maxUploadMegabytes } from "@/lib/modules/documents/document.files";
import { documentFormOptions } from "@/lib/modules/documents/document.options";
import {
  canReachDocumentParent,
  type DocumentParentRef,
} from "@/lib/modules/documents/document.parent-access";
import { DOCUMENT_RECORD_TYPES } from "@/lib/modules/documents/document.schema";
import { prisma } from "@/lib/database/prisma";

export const metadata: Metadata = { title: "Add Document" };

/**
 * Upload a document (PRD #13 §86–§92).
 *
 * `?projectId=` / `?clientId=` lock the context when the form is opened from a
 * record page. The service revalidates the parent against the caller's scope,
 * so a hand-edited parameter cannot file against a record they cannot see
 * (PRD #13 §91, §236).
 */
export default async function NewDocumentPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const context = await requireModule("documents");
  if (!can(context, "document.create")) notFound();

  const params = await searchParams;
  const options = await documentFormOptions(context);

  const requestedProjectId = typeof params.projectId === "string" ? params.projectId : "";
  const requestedClientId = typeof params.clientId === "string" ? params.clientId : "";
  const requestedEntityType = typeof params.entityType === "string" ? params.entityType : "";
  const requestedEntityId = typeof params.entityId === "string" ? params.entityId : "";

  // Only a parent the picker itself can list is locked in, so the preselection
  // can never disagree with what the service will accept.
  const project = options.projects.find((option) => option.value === requestedProjectId);
  const client = options.clients.find((option) => option.value === requestedClientId);

  /*
   * A record parent is locked in without being looked up here: the service
   * runs that record type's registered resolver, which reads it through its own
   * module's scope. Validating it twice, in two places, is how the two answers
   * eventually diverge (PRD #13 §91, §236).
   */
  const record = await resolveRecordContext(context, requestedEntityType, requestedEntityId);

  const lockedContext = project
    ? { kind: "project" as const, id: project.value, label: project.label }
    : client
      ? { kind: "client" as const, id: client.value, label: client.label }
      : record;

  // Nothing to file against and no company grant: the page would be a dead end.
  if (!lockedContext && options.projects.length === 0 && options.clients.length === 0 && !options.canFileToCompany) {
    notFound();
  }

  return (
    <div className="space-y-5">
      <Breadcrumbs
        items={[{ label: "Documents", href: "/documents" }, { label: "Add document" }]}
      />

      <div>
        <h1 className="text-page font-semibold text-fg">Add document</h1>
        <p className="mt-1.5 text-body text-fg-muted">
          Files upload straight to private storage and are reachable only through the record
          they belong to.
        </p>
      </div>

      <DocumentUploader
        projects={options.projects}
        clients={options.clients}
        canFileToCompany={options.canFileToCompany}
        lockedContext={lockedContext}
        maxMegabytes={maxUploadMegabytes()}
        cancelHref={cancelHref(lockedContext)}
        doneHref={cancelHref(lockedContext)}
      />
    </div>
  );
}

function cancelHref(
  locked?: { kind: "project" | "client" | "record"; id: string; entityType?: string },
): string {
  if (locked?.kind === "project") return `/projects/${locked.id}/documents`;
  if (locked?.kind === "client") return `/clients/${locked.id}/documents`;
  if (locked?.kind === "record" && locked.entityType) {
    return `${RECORD_ROUTES[locked.entityType] ?? "/documents/all"}/${locked.id}/documents`;
  }
  return "/documents/all";
}

const RECORD_ROUTES: Record<string, string> = {
  task: "/tasks",
  invoice: "/finance/invoices",
  expense: "/finance/expenses",
  budget: "/finance/budgets",
  commitment: "/finance/commitments",
};

/**
 * Resolves the label for a record parent, so the locked context reads as
 * something a person recognises rather than an id.
 *
 * Returning `undefined` for an unknown or unreachable record simply leaves the
 * form unlocked — the service refuses the attachment either way.
 */
async function resolveRecordContext(
  context: Awaited<ReturnType<typeof requireModule>>,
  entityType: string,
  entityId: string,
) {
  if (!entityType || !entityId) return undefined;
  if (!(DOCUMENT_RECORD_TYPES as readonly string[]).includes(entityType)) return undefined;

  const label = await recordLabel(context, entityType, entityId);
  if (!label) return undefined;

  return { kind: "record" as const, id: entityId, label, entityType };
}

/** A human-readable name for the record a document is being filed against. */
async function recordLabel(
  context: Awaited<ReturnType<typeof requireModule>>,
  entityType: string,
  entityId: string,
): Promise<string | null> {
  const ref: DocumentParentRef = {
    projectId: null,
    clientId: null,
    module: entityType === "task" ? "tasks" : "finance",
    entityType,
    entityId,
  };

  // The same reachability check the write path runs, so the form never names a
  // record the service would then refuse.
  if (!(await canReachDocumentParent(context, ref))) return null;

  switch (entityType) {
    case "task": {
      const task = await prisma.task.findUnique({
        where: { id: entityId },
        select: { title: true },
      });
      return task ? `Task · ${task.title}` : null;
    }
    case "invoice": {
      const invoice = await prisma.invoice.findUnique({
        where: { id: entityId },
        select: { invoiceNumber: true },
      });
      return invoice ? `Invoice · ${invoice.invoiceNumber}` : null;
    }
    case "expense": {
      const expense = await prisma.expense.findUnique({
        where: { id: entityId },
        select: { description: true, expenseNumber: true },
      });
      return expense ? `Expense · ${expense.expenseNumber ?? expense.description}` : null;
    }
    case "budget": {
      const budget = await prisma.projectBudget.findUnique({
        where: { id: entityId },
        select: { version: true, project: { select: { code: true } } },
      });
      return budget ? `Budget · ${budget.project.code} v${budget.version}` : null;
    }
    case "commitment": {
      const commitment = await prisma.commitment.findUnique({
        where: { id: entityId },
        select: { reference: true, description: true },
      });
      return commitment
        ? `Commitment · ${commitment.reference ?? commitment.description}`
        : null;
    }
    default:
      return null;
  }
}
