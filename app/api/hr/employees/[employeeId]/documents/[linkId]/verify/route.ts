import { apiOk, readJson, withContext } from "@/lib/api/respond";
import { verifyEmployeeDocumentSchema } from "@/lib/modules/hr/documents/employee-document.schema";
import { verifyEmployeeDocument } from "@/lib/modules/hr/documents/employee-document.service";

type Params = { params: Promise<{ employeeId: string; linkId: string }> };

/** POST /api/hr/employees/:employeeId/documents/:linkId/verify — checked and accepted, by somebody who is not the employee (E-02 §72-§76). */
export async function POST(request: Request, { params }: Params) {
  const { employeeId, linkId } = await params;
  return withContext(async (context) => {
    const input = verifyEmployeeDocumentSchema.parse(await readJson(request));
    return apiOk({ data: await verifyEmployeeDocument(context, employeeId, linkId, input) });
  });
}
