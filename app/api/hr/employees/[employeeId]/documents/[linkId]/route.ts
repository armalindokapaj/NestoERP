import { apiOk, readJson, withContext } from "@/lib/api/respond";
import { updateEmployeeDocumentSchema } from "@/lib/modules/hr/documents/employee-document.schema";
import { getEmployeeDocument, updateEmployeeDocument } from "@/lib/modules/hr/documents/employee-document.service";

type Params = { params: Promise<{ employeeId: string; linkId: string }> };

/**
 * GET   /api/hr/employees/:employeeId/documents/:linkId — one document, if this reader may open it.
 * PATCH /api/hr/employees/:employeeId/documents/:linkId — its category, title, dates or reach (E-02 §27, §97).
 *       Its verification moves only by the actions beside this route (§31).
 */
export async function GET(_request: Request, { params }: Params) {
  const { employeeId, linkId } = await params;
  return withContext(async (context) => apiOk({ data: await getEmployeeDocument(context, employeeId, linkId) }));
}

export async function PATCH(request: Request, { params }: Params) {
  const { employeeId, linkId } = await params;
  return withContext(async (context) => {
    const input = updateEmployeeDocumentSchema.parse(await readJson(request));
    return apiOk({ data: await updateEmployeeDocument(context, employeeId, linkId, input) });
  });
}
