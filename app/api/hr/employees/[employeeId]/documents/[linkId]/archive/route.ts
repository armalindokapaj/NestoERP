import { apiOk, readJson, withContext } from "@/lib/api/respond";
import { archiveEmployeeDocumentSchema } from "@/lib/modules/hr/documents/employee-document.schema";
import { archiveEmployeeDocument } from "@/lib/modules/hr/documents/employee-document.service";

type Params = { params: Promise<{ employeeId: string; linkId: string }> };

/** POST /api/hr/employees/:employeeId/documents/:linkId/archive — off the employee's file, with a reason; the file and its history stay (E-02 §67). */
export async function POST(request: Request, { params }: Params) {
  const { employeeId, linkId } = await params;
  return withContext(async (context) => {
    const input = archiveEmployeeDocumentSchema.parse(await readJson(request));
    return apiOk({ data: await archiveEmployeeDocument(context, employeeId, linkId, input) });
  });
}
