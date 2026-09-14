import { apiError, apiOk, readJson, withContext } from "@/lib/api/respond";
import { checkRateLimit } from "@/lib/core/security/rate-limit";
import { createContact, listContacts } from "@/lib/modules/contractors/contractor.contacts";
import { contactSchema } from "@/lib/modules/contractors/contractor.schema";

type Params = { params: Promise<{ contractorId: string }> };

/** GET — the contractor's contacts — contact records, never logins (PRD #46 §20-§23, §213). */
export async function GET(_request: Request, { params }: Params) {
  const { contractorId } = await params;
  return withContext(async (context) => {
    return apiOk({ data: await listContacts(context, contractorId) });
  });
}

/** POST — add a contact (PRD #46 §213). */
export async function POST(request: Request, { params }: Params) {
  const { contractorId } = await params;
  return withContext(async (context) => {
    if (!checkRateLimit("WRITE", context.membershipId).allowed) return apiError("VALIDATION_ERROR", "Too many changes at once. Try again shortly.");
    const input = contactSchema.parse(await readJson(request));
    return apiOk({ data: await createContact(context, contractorId, input) }, { status: 201 });
  });
}
