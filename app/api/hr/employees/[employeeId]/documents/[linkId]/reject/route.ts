import { apiOk, readJson, withContext } from "@/lib/api/respond";
import { rejectEmployeeDocumentSchema } from "@/lib/modules/hr/documents/employee-document.schema";
import { rejectEmployeeDocument } from "@/lib/modules/hr/documents/employee-document.service";

type Params = { params: Promise<{ employeeId: string; linkId: string }> };

/** POST /api/hr/employees/:employeeId/documents/:linkId/reject — not accepted, with the reason the employee will read (E-02 §77). */
export async function POST(request: Request, { params }: Params) {
  const { employeeId, linkId } = await params;
  return withContext(async (context) => {
    const input = rejectEmployeeDocumentSchema.parse(await readJson(request));
    return apiOk({ data: await rejectEmployeeDocument(context, employeeId, linkId, input) });
  });
}
