import { apiError, apiOk, readJson, withContext } from "@/lib/api/respond";
import { checkRateLimit } from "@/lib/core/security/rate-limit";
import { removeContact, updateContact } from "@/lib/modules/contractors/contractor.contacts";
import { updateContactSchema } from "@/lib/modules/contractors/contractor.schema";

type Params = { params: Promise<{ contactId: string }> };

/** PATCH — edit a contact (PRD #46 §213). */
export async function PATCH(request: Request, { params }: Params) {
  const { contactId } = await params;
  return withContext(async (context) => {
    if (!checkRateLimit("WRITE", context.membershipId).allowed) return apiError("VALIDATION_ERROR", "Too many changes at once. Try again shortly.");
    const input = updateContactSchema.parse(await readJson(request));
    return apiOk({ data: await updateContact(context, contactId, input) });
  });
}

/** DELETE — remove a contact, or deactivate one an assignment still names (PRD #46 §213). */
export async function DELETE(_request: Request, { params }: Params) {
  const { contactId } = await params;
  return withContext(async (context) => {
    return apiOk({ data: await removeContact(context, contactId) });
  });
}
