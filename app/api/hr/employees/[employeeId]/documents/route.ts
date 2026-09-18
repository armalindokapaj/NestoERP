import { apiOk, readJson, withContext } from "@/lib/api/respond";
import { fileEmployeeDocumentSchema } from "@/lib/modules/hr/documents/employee-document.schema";
import { fileEmployeeDocument, listEmployeeDocuments } from "@/lib/modules/hr/documents/employee-document.service";

type Params = { params: Promise<{ employeeId: string }> };

/**
 * GET  /api/hr/employees/:employeeId/documents — the employee's documents this reader may open,
 *      the summaries shared with colleagues, and files not yet filed (E-02 §94-§99, §116).
 * POST /api/hr/employees/:employeeId/documents — file a document uploaded on the employment,
 *      or renew one with `replacesId` (§54, §91). The bytes go through /api/documents/uploads (§117).
 */
export async function GET(_request: Request, { params }: Params) {
  const { employeeId } = await params;
  return withContext(async (context) => apiOk({ data: await listEmployeeDocuments(context, employeeId) }));
}

export async function POST(request: Request, { params }: Params) {
  const { employeeId } = await params;
  return withContext(async (context) => {
    const input = fileEmployeeDocumentSchema.parse(await readJson(request));
    return apiOk({ data: await fileEmployeeDocument(context, employeeId, input) }, { status: 201 });
  });
}
