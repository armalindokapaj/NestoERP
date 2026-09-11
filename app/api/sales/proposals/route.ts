import { apiOk, readJson, withContext } from "@/lib/api/respond";
import { createProposalSchema } from "@/lib/modules/sales/proposals/proposal.schema";
import * as proposals from "@/lib/modules/sales/proposals/proposal.service";
import { parseProposalQuery } from "@/lib/modules/sales/sales.query";

/**
 * GET  /api/sales/proposals — scoped, filtered, paginated (PRD #17 §198).
 * POST /api/sales/proposals — draft a commercial offer.
 *
 * Totals are absent from the request: the server calculates them from the lines
 * (PRD #17 §224).
 */
export async function GET(request: Request) {
  return withContext(async (context) => {
    const url = new URL(request.url);
    return apiOk(await proposals.listProposals(context, parseProposalQuery(url.searchParams)));
  });
}

export async function POST(request: Request) {
  return withContext(async (context) => {
    const input = createProposalSchema.parse(await readJson(request));
    return apiOk({ data: await proposals.createProposal(context, input) }, { status: 201 });
  });
}
