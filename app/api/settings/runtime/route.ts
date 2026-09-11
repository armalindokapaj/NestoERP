import { apiOk, withContext } from "@/lib/api/respond";
import { getCompanyRuntimeConfig } from "@/lib/config/company-config.service";

/**
 * GET /api/settings/runtime — the compact configuration the client needs
 * (PRD #24 §324-§326). Non-sensitive values only; authorisation still comes
 * from the user context, never from here (PRD #24 §140).
 */
export async function GET() {
  return withContext(async (context) =>
    apiOk({ data: await getCompanyRuntimeConfig(context.companyId) }),
  );
}
