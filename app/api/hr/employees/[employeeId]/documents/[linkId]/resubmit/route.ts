import { apiOk, readJson, withContext } from "@/lib/api/respond";
import { resubmitEmployeeDocumentSchema } from "@/lib/modules/hr/documents/employee-document.schema";
import { resubmitEmployeeDocument } from "@/lib/modules/hr/documents/employee-document.service";

type Params = { params: Promise<{ employeeId: string; linkId: string }> };

/** POST /api/hr/employees/:employeeId/documents/:linkId/resubmit — a rejected document back to the verifier, usually with a new file version (E-02 §79). */
export async function POST(request: Request, { params }: Params) {
  const { employeeId, linkId } = await params;
  return withContext(async (context) => {
    const input = resubmitEmployeeDocumentSchema.parse(await readJson(request));
    return apiOk({ data: await resubmitEmployeeDocument(context, employeeId, linkId, input) });
  });
}
