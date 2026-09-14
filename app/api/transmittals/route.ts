import { apiOk, withContext } from "@/lib/api/respond";
import { transmittalListSchema } from "@/lib/modules/engineering/engineering.schema";
import { listTransmittals } from "@/lib/modules/engineering/engineering.transmittals";

/** GET — transmittals across the reader's projects (PRD #46 §221). */
export async function GET(request: Request) {
  return withContext(async (context) => {
    const query = transmittalListSchema.parse(Object.fromEntries(new URL(request.url).searchParams));
    return apiOk({ data: await listTransmittals(context, query) });
  });
}
