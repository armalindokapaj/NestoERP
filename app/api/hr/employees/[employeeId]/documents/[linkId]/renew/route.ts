import { apiOk, readJson, withContext } from "@/lib/api/respond";
import { fileEmployeeDocumentSchema } from "@/lib/modules/hr/documents/employee-document.schema";
import { fileEmployeeDocument } from "@/lib/modules/hr/documents/employee-document.service";

type Params = { params: Promise<{ employeeId: string; linkId: string }> };

/**
 * POST /api/hr/employees/:employeeId/documents/:linkId/renew — file the renewed document (a new
 * file, uploaded on the employment): it becomes current, this one is superseded and kept (E-02 §91).
 */
export async function POST(request: Request, { params }: Params) {
  const { employeeId, linkId } = await params;
  return withContext(async (context) => {
    const input = fileEmployeeDocumentSchema.parse({ ...((await readJson(request)) as Record<string, unknown>), replacesId: linkId });
    return apiOk({ data: await fileEmployeeDocument(context, employeeId, input) }, { status: 201 });
  });
}
