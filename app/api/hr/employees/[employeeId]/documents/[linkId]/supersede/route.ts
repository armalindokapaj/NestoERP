import { apiOk, readJson, withContext } from "@/lib/api/respond";
import { supersedeEmployeeDocumentSchema } from "@/lib/modules/hr/documents/employee-document.schema";
import { supersedeEmployeeDocument } from "@/lib/modules/hr/documents/employee-document.service";

type Params = { params: Promise<{ employeeId: string; linkId: string }> };

/** POST /api/hr/employees/:employeeId/documents/:linkId/supersede — no longer applies; kept, not current, optionally replaced by another (E-02 §66). */
export async function POST(request: Request, { params }: Params) {
  const { employeeId, linkId } = await params;
  return withContext(async (context) => {
    const input = supersedeEmployeeDocumentSchema.parse(await readJson(request));
    return apiOk({ data: await supersedeEmployeeDocument(context, employeeId, linkId, input) });
  });
}
